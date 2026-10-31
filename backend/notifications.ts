import { Hono } from "hono";
import type { Bindings, AppEnv } from "./types";
import { now, body, type AppContext } from "./http";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { audit, mutate, replayMutation } from "./data";
import { getShiftsRange } from "./schedules";
import { localDate } from "../shared/domain";
import { openCheckoutTimings } from "./checkout";
import { shiftMessages } from "../shared/shift-messages";
import { automaticCheckout } from "./automatic-checkout";

// Enqueue in the business transaction. Delivery is independent of attendance success.
export function notify(
  db: D1Database,
  event: string,
  text: string,
  employeeId?: string,
  admins = false,
) {
  return db
    .prepare(
      `INSERT OR IGNORE INTO notification_outbox(id,event_key,user_id,text,next_attempt_at,created_at,audience)
    SELECT lower(hex(randomblob(16))),?,u.id,?,?,?,? FROM users u
    WHERE u.active=1 AND ${admins ? "u.access IN ('super_admin','admin')" : "EXISTS(SELECT 1 FROM employees WHERE user_id=u.id AND id=?)"}`,
    )
    .bind(
      event,
      text,
      now(),
      now(),
      admins ? "admin" : "employee",
      ...(admins ? [] : [employeeId!]),
    );
}
export function notifyAdminCheckIn(
  db: D1Database,
  sessionId: string,
  text: string,
) {
  return db
    .prepare(
      "INSERT OR IGNORE INTO notification_outbox(id,event_key,user_id,text,next_attempt_at,created_at,audience,notification_kind) SELECT lower(hex(randomblob(16))),?,u.id,?,?,?,'admin','admin_check_in' FROM users u WHERE u.active=1 AND u.access IN ('super_admin','admin')",
    )
    .bind(`admin-check-in:${sessionId}`, text, now(), now());
}
export const telegramPublic = new Hono<AppEnv>();
telegramPublic.post("/telegram/webhook", async (c) => {
  const secret = c.env.TELEGRAM_WEBHOOK_SECRET,
    supplied = c.req.header("X-Telegram-Bot-Api-Secret-Token");
  if (!secret || !supplied || supplied.length !== secret.length)
    return c.json({ error: "Invalid webhook secret." }, 403);
  let mismatch = 0;
  for (let i = 0; i < secret.length; i++)
    mismatch |= secret.charCodeAt(i) ^ supplied.charCodeAt(i);
  if (mismatch) return c.json({ error: "Invalid webhook secret." }, 403);
  let update: {
    update_id?: number;
    message?: {
      text?: string;
      chat?: { id?: number; type?: string };
      from?: { id?: number; is_bot?: boolean };
    };
  };
  try {
    update = JSON.parse(await c.req.text());
  } catch {
    return c.json({ error: "Invalid update." }, 400);
  }
  const m = update.message;
  if (
    !Number.isSafeInteger(update.update_id) ||
    !m ||
    m.chat?.type !== "private" ||
    m.from?.is_bot ||
    !Number.isSafeInteger(m.from?.id) ||
    m.from?.id !== m.chat.id
  )
    return c.json({ ok: true });
  const command = m.text?.split(/[ @]/)[0];
  if (command !== "/start" && command !== "/stop") return c.json({ ok: true });
  const user = await c.env.DB.prepare(
    "SELECT id FROM users WHERE telegram_id=? AND active=1",
  )
    .bind(String(m.from!.id))
    .first<{ id: string }>();
  if (!user) return c.json({ ok: true });
  const enabled = command === "/start" ? 1 : 0;
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO telegram_chats(user_id,chat_id,enabled,updated_at,last_update_id) VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET chat_id=excluded.chat_id,enabled=excluded.enabled,updated_at=excluded.updated_at,last_update_id=excluded.last_update_id WHERE excluded.last_update_id>telegram_chats.last_update_id",
    ).bind(user.id, String(m.chat.id), enabled, now(), update.update_id!),
    c.env.DB.prepare(
      "INSERT OR IGNORE INTO notification_outbox(id,event_key,user_id,text,markup_json,next_attempt_at,created_at) VALUES(?,?,?,?,?,?,?)",
    ).bind(
      crypto.randomUUID(),
      `webhook:${update.update_id}`,
      user.id,
      enabled
        ? "Welcome to IELTS ZONE! 👋 Notifications are on. Open your workspace below—you can choose shift reminders and encouragement in your notification settings 💜"
        : "Notifications are off 🌿 You can turn them back on anytime with /start.",
      enabled
        ? JSON.stringify({
            inline_keyboard: [
              [
                {
                  text: "Open staff workspace",
                  web_app: { url: c.env.APP_ORIGIN },
                },
              ],
            ],
          })
        : null,
      now(),
      now(),
    ),
  ]);
  return c.json({ ok: true });
});
export const notificationRoutes = new Hono<AppEnv>();
function requireMessagingAdmin(c: AppContext) {
  if (!["super_admin", "admin"].includes(c.get("identity").access))
    throw new HTTPException(403, {
      message: "Administrator access is required to send messages.",
    });
}
notificationRoutes.get("/notifications/messages/users", async (c) => {
  requireMessagingAdmin(c);
  const users = (
    await c.env.DB.prepare(
      "SELECT u.id,u.full_name,u.access,CASE WHEN t.enabled=1 AND t.chat_id=u.telegram_id THEN 1 ELSE 0 END AS ready FROM users u LEFT JOIN telegram_chats t ON t.user_id=u.id WHERE u.active=1 ORDER BY u.full_name,u.id",
    ).all()
  ).results;
  return c.json({ users });
});
notificationRoutes.get("/notifications/messages", async (c) => {
  requireMessagingAdmin(c);
  const messages = (
    await c.env.DB.prepare(
      "SELECT o.id,u.full_name,o.text,o.status,o.created_at,o.error_code FROM notification_outbox o JOIN audit_logs a ON a.entity_id=o.id AND a.action='telegram.message.send' JOIN users u ON u.id=o.user_id WHERE a.actor_id=? ORDER BY o.created_at DESC,o.id DESC LIMIT 30",
    )
      .bind(c.get("identity").id)
      .all()
  ).results;
  return c.json({ messages });
});
notificationRoutes.post("/notifications/messages", async (c) => {
  requireMessagingAdmin(c);
  const replay = await replayMutation(c);
  if (replay) return replay;
  const userIdSchema = z.string().min(1).max(100),
    messageSchema = z.string().trim().min(1).max(3000);
  const input = await body(
    c,
    z.union([
      z.object({ userId: userIdSchema, message: messageSchema }).strict(),
      z
        .object({
          userIds: z.array(userIdSchema).min(1).max(500),
          message: messageSchema,
        })
        .strict(),
    ]),
  );
  const userIds = [
    ...new Set("userIds" in input ? input.userIds : [input.userId]),
  ];
  const recipients = (
    await c.env.DB.prepare(
      "SELECT u.id,u.full_name,u.telegram_id,t.enabled,t.chat_id FROM users u LEFT JOIN telegram_chats t ON t.user_id=u.id WHERE u.id IN (SELECT value FROM json_each(?)) AND u.active=1",
    )
      .bind(JSON.stringify(userIds))
      .all<{
        id: string;
        full_name: string;
        telegram_id: string;
        enabled: number | null;
        chat_id: string | null;
      }>()
  ).results;
  if (recipients.length !== userIds.length)
    throw new HTTPException(404, {
      message:
        "One or more selected users are unavailable. Refresh the recipient list.",
    });
  const unavailable = recipients.filter(
    (r) => !r.enabled || r.chat_id !== r.telegram_id,
  );
  if (unavailable.length)
    throw new HTTPException(409, {
      message: `${unavailable.length} selected user(s) cannot receive bot messages. Refresh the list and deselect unavailable users. No messages were queued.`,
    });
  const batchId = crypto.randomUUID(),
    timestamp = now();
  const rows = JSON.stringify(
    recipients.map((r) => ({
      id: crypto.randomUUID(),
      userId: r.id,
      recipientName: r.full_name,
      telegramId: r.telegram_id,
    })),
  );
  const text = `\u{1F4AC} Message from ${c.get("identity").fullName}\n\n${input.message}`;
  return mutate(
    c,
    [
      c.env.DB.prepare(
        "INSERT INTO notification_outbox(id,event_key,user_id,text,next_attempt_at,created_at,notification_kind) SELECT json_extract(r.value,'$.id'),'admin-message:'||json_extract(r.value,'$.id'),CASE WHEN EXISTS(SELECT 1 FROM users u JOIN telegram_chats t ON t.user_id=u.id WHERE u.id=json_extract(r.value,'$.userId') AND u.active=1 AND u.telegram_id=json_extract(r.value,'$.telegramId') AND t.chat_id=u.telegram_id AND t.enabled=1) THEN json_extract(r.value,'$.userId') ELSE NULL END,?,?,?,'admin_message' FROM json_each(?) r",
      ).bind(text, timestamp, timestamp, rows),
      c.env.DB.prepare(
        "INSERT INTO audit_logs(id,actor_id,action,entity_id,before_json,after_json,reason,created_at) SELECT lower(hex(randomblob(16))),?,'telegram.message.send',json_extract(r.value,'$.id'),NULL,json_object('userId',json_extract(r.value,'$.userId'),'recipientName',json_extract(r.value,'$.recipientName'),'telegramId',json_extract(r.value,'$.telegramId'),'message',?,'batchId',?), '',? FROM json_each(?) r",
      ).bind(c.get("identity").id, input.message, batchId, timestamp, rows),
    ],
    {
      id: JSON.parse(rows)[0].id,
      batchId,
      recipientCount: recipients.length,
      status: "pending",
    },
    201,
  );
});
notificationRoutes.get("/notifications/preferences", async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT enabled,reminders,encouragement FROM telegram_chats WHERE user_id=?",
  )
    .bind(c.get("identity").id)
    .first();
  return c.json(row ?? { enabled: 0, reminders: 0, encouragement: 1 });
});
notificationRoutes.post("/notifications/preferences", async (c) => {
  const i = await body(
    c,
    z
      .object({
        enabled: z.boolean(),
        reminders: z.boolean(),
        encouragement: z.boolean().optional(),
      })
      .strict(),
  );
  const id = c.get("identity").id;
  return mutate(
    c,
    [
      c.env.DB.prepare(
        "INSERT INTO telegram_chats(user_id,chat_id,enabled,reminders,encouragement,updated_at) VALUES(?,?,?,?,COALESCE(?,1),?) ON CONFLICT(user_id) DO UPDATE SET chat_id=excluded.chat_id,enabled=excluded.enabled,reminders=excluded.reminders,encouragement=COALESCE(?,telegram_chats.encouragement),updated_at=excluded.updated_at",
      ).bind(
        id,
        c.get("identity").telegramId,
        Number(i.enabled),
        Number(i.reminders),
        i.encouragement === undefined ? null : Number(i.encouragement),
        now(),
        i.encouragement === undefined ? null : Number(i.encouragement),
      ),
      audit(c, "notifications.preferences", id, null, i),
    ],
    { ok: true },
  );
});

export async function prepareReminders(env: Bindings, time = now()) {
  const today = localDate(time * 1000);
  await getShiftsRange(env.DB, null, today, localDate((time + 86400) * 1000));
  const checkoutMessages: D1PreparedStatement[] = [];
  const retryStaleCheckout = " ON CONFLICT(event_key,user_id) DO UPDATE SET status='pending',error_code=NULL,attempts=0,next_attempt_at=excluded.next_attempt_at,created_at=excluded.created_at,text=excluded.text,notification_kind='checkout' WHERE notification_outbox.status='failed' AND notification_outbox.error_code='stale_checkout'";
  const checkoutTimings = await openCheckoutTimings(env.DB, time);
  for (const item of checkoutTimings) {
    if (item.state === "working") continue;
    const { session, state } = item;
    // Enqueue only the current stage, avoiding a burst after downtime.
    const prefix = state === "review" ? "forgotten:" : state === "overdue" ? "checkout-overdue:" : "checkout-end:";
    const text = state === "review"
      ? "Checkout is still unresolved. If you are working, check out when you leave. If you already left, request a correction."
      : state === "overdue"
        ? "Checkout is overdue. If you are still working, check out when you leave. If you already left, request a correction."
        : "Your expected work time has ended. Remember to scan the reception QR to check out when you leave.";
    checkoutMessages.push(env.DB.prepare(
      "INSERT OR IGNORE INTO notification_outbox(id,event_key,user_id,text,next_attempt_at,created_at,notification_kind) SELECT lower(hex(randomblob(16))),?,e.user_id,?,?,?,'checkout' FROM employees e JOIN users u ON u.id=e.user_id WHERE e.id=? AND u.active=1 AND NOT EXISTS(SELECT 1 FROM telegram_chats t WHERE t.user_id=u.id AND t.reminders=0) AND EXISTS(SELECT 1 FROM attendance_sessions WHERE id=? AND check_out IS NULL)" + retryStaleCheckout
    ).bind(prefix + session.id, text, time, time, session.employee_id, session.id));
    if (state === "review") checkoutMessages.push(env.DB.prepare(
      "INSERT OR IGNORE INTO notification_outbox(id,event_key,user_id,text,next_attempt_at,created_at,audience,notification_kind) SELECT lower(hex(randomblob(16))),?,u.id,'An employee has an unresolved checkout after the grace period. Review live attendance.',?,?,'admin','checkout' FROM users u WHERE u.active=1 AND u.access IN ('super_admin','admin') AND EXISTS(SELECT 1 FROM attendance_sessions WHERE id=? AND check_out IS NULL)" + retryStaleCheckout
    ).bind("forgotten-admin:" + session.id, time, time, session.id));
  }
  if (checkoutMessages.length) await env.DB.batch(checkoutMessages);
  // One daily admin reminder, only when completed historical workdays need reviews.
  await env.DB.prepare(
    "INSERT OR IGNORE INTO notification_outbox(id,event_key,user_id,text,next_attempt_at,created_at,audience) SELECT lower(hex(randomblob(16))),?,u.id,'Daily work-quality or uniform reviews are pending. Open Review inbox.',?,?,'admin' FROM users u WHERE u.active=1 AND u.access IN ('super_admin','admin') AND EXISTS(SELECT 1 FROM discipline_workdays w LEFT JOIN daily_work_reviews q ON q.employee_id=w.employee_id AND q.work_date=w.work_date LEFT JOIN daily_uniform_confirmations f ON f.employee_id=w.employee_id AND f.work_date=w.work_date WHERE w.work_date<? AND (q.employee_id IS NULL OR q.attendance_snapshot!=w.attendance_snapshot OR f.employee_id IS NULL OR f.status='pending'))",
  )
    .bind(`daily-review:${today}`, time, time, today)
    .run();
  const shifts = (
    await env.DB.prepare(
      "SELECT s.*,e.user_id,u.full_name,t.reminders,t.encouragement,EXISTS(SELECT 1 FROM attendance_sessions a WHERE a.employee_id=e.id AND a.work_date=s.work_date AND a.check_out IS NULL AND a.check_in<=?) AS checked_in FROM scheduled_shifts s JOIN employees e ON e.id=s.employee_id JOIN users u ON u.id=e.user_id JOIN telegram_chats t ON t.user_id=u.id WHERE s.status='scheduled' AND s.start_at<=? AND s.end_at>? AND u.active=1 AND e.activation_date<=s.work_date AND (e.deactivation_date IS NULL OR e.deactivation_date>s.work_date) AND t.enabled=1 AND NOT EXISTS(SELECT 1 FROM employee_requests r WHERE r.employee_id=e.id AND r.work_date=s.work_date AND r.kind='absence' AND r.status='approved')",
    )
      .bind(time, time + 1800, time)
      .all<{
        id: string;
        start_at: number;
        end_at: number;
        user_id: string;
        full_name: string;
        reminders: number;
        encouragement: number;
        checked_in: number;
      }>()
  ).results;
  const pending: D1PreparedStatement[] = [];
  for (const shift of shifts)
    for (const message of shiftMessages(shift, shift.full_name)) {
      if (message.kind === "end" && checkoutTimings.some((item) =>
        item.session.shift_id === shift.id && item.expectedEnd > shift.end_at)) continue;
      if (
        time < message.due ||
        time >= message.due + 120 ||
        time >= message.expires
      )
        continue;
      if (
        message.kind === "encouragement"
          ? !shift.encouragement || !shift.checked_in
          : !shift.reminders || (message.kind === "end" && !shift.checked_in)
      )
        continue;
      const key =
        message.kind === "encouragement"
          ? `shift-message:${shift.id}:encouragement:${message.slot}`
          : `shift-message:${shift.id}:${message.kind}:${shift.start_at}:${shift.end_at}`;
      pending.push(
        env.DB.prepare(
          "INSERT OR IGNORE INTO notification_outbox(id,event_key,user_id,text,next_attempt_at,created_at,shift_id,shift_start_at,shift_end_at,notification_kind,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        ).bind(
          crypto.randomUUID(),
          key,
          shift.user_id,
          message.text,
          time,
          time,
          shift.id,
          shift.start_at,
          shift.end_at,
          message.kind,
          message.expires,
        ),
      );
    }
  if (pending.length) await env.DB.batch(pending);
}

// Recheck queued shift messages at delivery: a later absence, schedule edit,
// checkout or preference change must not produce a stale reminder.
const validShiftMessage = `(o.shift_id IS NULL OR EXISTS(SELECT 1 FROM scheduled_shifts s JOIN employees e ON e.id=s.employee_id JOIN telegram_chats p ON p.user_id=e.user_id WHERE s.id=o.shift_id AND e.user_id=o.user_id AND s.status='scheduled' AND s.start_at=o.shift_start_at AND s.end_at=o.shift_end_at AND e.activation_date<=s.work_date AND (e.deactivation_date IS NULL OR e.deactivation_date>s.work_date) AND NOT EXISTS(SELECT 1 FROM employee_requests r WHERE r.employee_id=e.id AND r.work_date=s.work_date AND r.kind='absence' AND r.status='approved') AND (CASE WHEN o.notification_kind='encouragement' THEN p.encouragement ELSE p.reminders END)=1 AND (o.notification_kind='start' OR EXISTS(SELECT 1 FROM attendance_sessions a WHERE a.employee_id=e.id AND a.work_date=s.work_date AND a.check_out IS NULL))))`;
const checkoutEvent = `(o.event_key LIKE 'forgotten:%' OR o.event_key LIKE 'forgotten-admin:%' OR o.event_key LIKE 'checkout-end:%' OR o.event_key LIKE 'checkout-overdue:%')`;
const validCheckoutMessage = `(NOT ${checkoutEvent} OR EXISTS(SELECT 1 FROM attendance_sessions a WHERE a.id=substr(o.event_key,instr(o.event_key,':')+1) AND a.check_out IS NULL AND (o.audience='admin' OR NOT EXISTS(SELECT 1 FROM telegram_chats p WHERE p.user_id=o.user_id AND p.reminders=0))))`;
const validRecipient = `EXISTS(SELECT 1 FROM users u JOIN telegram_chats t ON t.user_id=u.id WHERE u.id=o.user_id AND u.active=1 AND t.enabled=1 AND t.chat_id=u.telegram_id AND (o.audience!='admin' OR u.access IN ('super_admin','admin')) AND (COALESCE(o.notification_kind,'')!='admin_message' OR EXISTS(SELECT 1 FROM audit_logs a JOIN users sender ON sender.id=a.actor_id WHERE a.entity_id=o.id AND a.action='telegram.message.send' AND sender.active=1 AND sender.access IN ('super_admin','admin') AND json_extract(a.after_json,'$.telegramId')=u.telegram_id)))`;

export async function deliverNotifications(
  env: Bindings,
  send: typeof fetch = fetch,
) {
  if (env.NOTIFICATIONS_ENABLED !== "true") return;
  const time = now();
  const timings = new Map((await openCheckoutTimings(env.DB, time)).map((item) => [item.session.id, item]));
  const queued = (await env.DB.prepare(`SELECT o.id,o.event_key FROM notification_outbox o WHERE o.status='pending' AND ${checkoutEvent}`).all<{ id: string; event_key: string }>()).results;
  const stale: D1PreparedStatement[] = [];
  for (const row of queued) {
    const split = row.event_key.indexOf(":");
    const timing = timings.get(row.event_key.slice(split + 1));
    const prefix = row.event_key.slice(0, split);
    const expected = prefix === "checkout-end" ? "reminder" : prefix === "checkout-overdue" ? "overdue" : "review";
    if (!timing || timing.state !== expected)
      stale.push(env.DB.prepare("UPDATE notification_outbox SET status='failed',error_code='stale_checkout' WHERE id=? AND status='pending'").bind(row.id));
  }
  const queuedEnds = (await env.DB.prepare("SELECT id,shift_id,shift_end_at FROM notification_outbox WHERE status='pending' AND notification_kind='end'").all<{ id: string; shift_id: string; shift_end_at: number }>()).results;
  for (const row of queuedEnds)
    if ([...timings.values()].some((item) => item.session.shift_id === row.shift_id && item.expectedEnd > row.shift_end_at))
      stale.push(env.DB.prepare("UPDATE notification_outbox SET status='failed',error_code='stale_shift' WHERE id=? AND status='pending'").bind(row.id));
  if (stale.length) await env.DB.batch(stale);
  await env.DB.prepare(
    `UPDATE notification_outbox AS o SET status='failed',error_code='stale_shift' WHERE status='pending' AND shift_id IS NOT NULL AND (expires_at<=? OR NOT ${validShiftMessage})`,
  )
    .bind(time)
    .run();
  // Telegram offers no delivery idempotency. Never resend after an ambiguous timeout.
  await env.DB.prepare(
    "UPDATE notification_outbox SET status='uncertain',error_code='interrupted' WHERE status='sending' AND next_attempt_at<?",
  )
    .bind(time - 120)
    .run();
  await env.DB.prepare(
    "UPDATE notification_outbox SET status='failed',error_code='expired' WHERE status='pending' AND created_at<?",
  )
    .bind(time - 86400)
    .run();
  const rows = (
    await env.DB.prepare(
      `SELECT o.id,t.chat_id,o.text,o.markup_json,o.attempts FROM notification_outbox o JOIN telegram_chats t ON t.user_id=o.user_id WHERE o.status='pending' AND o.next_attempt_at<=? AND (o.expires_at IS NULL OR o.expires_at>?) AND ${validShiftMessage} AND ${validCheckoutMessage} AND ${validRecipient} ORDER BY COALESCE(o.expires_at,9223372036854775807),o.created_at LIMIT 10`,
    )
      .bind(time, time)
      .all<{
        id: string;
        chat_id: string;
        text: string;
        markup_json: string | null;
        attempts: number;
      }>()
  ).results;
  for (const row of rows) {
    const claim = await env.DB.prepare(
      `UPDATE notification_outbox AS o SET status='sending',attempts=attempts+1,next_attempt_at=? WHERE id=? AND status='pending' AND (expires_at IS NULL OR expires_at>?) AND ${validShiftMessage} AND ${validCheckoutMessage} AND ${validRecipient} RETURNING id`,
    )
      .bind(now(), row.id, now())
      .first();
    if (!claim) continue;
    let status = "uncertain",
      code = "network",
      next = now() + 60;
    try {
      const response = await send(
        `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: row.chat_id,
            text: row.text,
            ...(row.markup_json
              ? { reply_markup: JSON.parse(row.markup_json) }
              : {}),
          }),
          signal: AbortSignal.timeout(8000),
        },
      );
      const result = (await response.json()) as {
        ok?: boolean;
        error_code?: number;
        parameters?: { retry_after?: number };
      };
      if (result.ok === true) {
        status = "sent";
        code = "";
      } else if (result.ok === false) {
        code = String(result.error_code ?? response.status);
        status =
          (result.error_code === 429 || (result.error_code ?? 0) >= 500) &&
          row.attempts < 4
            ? "pending"
            : "failed";
        next =
          now() +
          Math.max(
            60,
            Math.min(
              86400,
              result.parameters?.retry_after ?? 60 * 2 ** row.attempts,
            ),
          );
      }
    } catch {
      /* Do not log requests, bot tokens or Telegram response bodies. */
    }
    await env.DB.prepare(
      "UPDATE notification_outbox SET status=?,error_code=?,next_attempt_at=?,sent_at=? WHERE id=? AND status='sending'",
    )
      .bind(
        status,
        code || null,
        next,
        status === "sent" ? now() : null,
        row.id,
      )
      .run();
  }
}
export async function scheduledNotifications(env: Bindings) {
  // Attendance closure runs even when Telegram delivery is disabled.
  await automaticCheckout(env.DB);
  // Hourly housekeeping: retries reuse an idempotency key within seconds, and Telegram
  // stops redelivering an update long before 30 days, so older rows only add storage.
  if (now() % 3600 < 60)
    await env.DB.batch([
      env.DB.prepare("DELETE FROM idempotency_keys WHERE created_at<?").bind(
        now() - 7 * 86400,
      ),
      env.DB.prepare(
        "DELETE FROM notification_outbox WHERE created_at<? AND status IN ('sent','failed','uncertain') AND event_key LIKE 'webhook:%'",
      ).bind(now() - 30 * 86400),
    ]);
  if (env.NOTIFICATIONS_ENABLED !== "true") return;
  await env.DB.prepare(
    "DELETE FROM notification_outbox WHERE created_at<? AND status IN ('sent','failed','uncertain') AND event_key NOT LIKE 'forgotten%' AND event_key NOT LIKE 'webhook:%'",
  )
    .bind(now() - 30 * 86400)
    .run();
  await prepareReminders(env);
  await deliverNotifications(env);
}
