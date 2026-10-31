import { useRef, useState, type FormEvent } from "react";
import { api } from "./api";
import { t } from "./text";
import { useResource, ErrorNotice, clock, day, HowItWorks } from "./ui";
import { localDate } from "../shared/domain";
type Recipient = {
  id: string;
  full_name: string;
  access: "employee" | "admin" | "super_admin";
  ready: number;
};
type Message = {
  id: string;
  full_name: string;
  text: string;
  status: string;
  created_at: number;
  error_code: string | null;
};
const labels: Record<string, string> = {
  pending: "Queued",
  sending: "Sending",
  sent: "Sent to Telegram",
  failed: "Delivery failed",
  uncertain: "Delivery unconfirmed",
};
export function TelegramMessages() {
  const users = useResource<{ users: Recipient[] }>(
      "/notifications/messages/users",
    ),
    history = useResource<{ messages: Message[] }>(
      "/notifications/messages",
      15,
    );
  const [selectedIds, setSelectedIds] = useState<string[]>([]),
    [search, setSearch] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const attempt = useRef<{ signature: string; key: string } | null>(null);
  const available = users.data?.users.filter((u) => !!u.ready) ?? [];
  const recipients = available.filter((u) => selectedIds.includes(u.id));
  const unavailableCount = (users.data?.users.length ?? 0) - available.length;
  function toggle(id: string) {
    setSelectedIds((ids) =>
      ids.includes(id) ? ids.filter((v) => v !== id) : [...ids, id],
    );
    setNotice("");
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !recipients.length || !message.trim()) return;
    const payload = {
        userIds: recipients.map((u) => u.id).sort(),
        message: message.trim(),
      },
      signature = JSON.stringify(payload);
    if (attempt.current?.signature !== signature)
      attempt.current = { signature, key: crypto.randomUUID() };
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api<{ recipientCount: number }>(
        "/notifications/messages",
        "POST",
        payload,
        attempt.current.key,
      );
      attempt.current = null;
      setMessage("");
      setNotice(
        `Message queued for ${result.recipientCount} ${result.recipientCount === 1 ? "user" : "users"}. Delivery status appears below.`,
      );
      await history.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="attendance-stack">
      <section className="panel attendance-panel">
        <h2>Send a message</h2>
        <p>
          Your message is delivered privately by the IELTS ZONE Telegram bot,
          with your name as the sender.
        </p>
        <ErrorNotice error={users.error || error} />
        {notice && (
          <p role="status" className="success">
            {notice}
          </p>
        )}
        <form className="telegram-message-form" onSubmit={submit}>
          <fieldset
            className="telegram-recipients"
            disabled={busy || users.loading}
          >
            <legend>Recipients · {recipients.length} selected</legend>
            <div className="attendance-toolbar">
              <button
                type="button"
                className="secondary compact"
                disabled={!available.length}
                onClick={() => {
                  setSelectedIds(available.map((u) => u.id));
                  setNotice("");
                }}
              >
                Choose everybody
              </button>
              <button
                type="button"
                className="text-button"
                disabled={!selectedIds.length}
                onClick={() => {
                  setSelectedIds([]);
                  setNotice("");
                }}
              >
                Clear selection
              </button>
            </div>
            <label>
              Find a user
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name"
              />
            </label>
            <div className="telegram-recipient-list">
              {users.data?.users
                .filter((u) =>
                  u.full_name
                    .toLowerCase()
                    .includes(search.trim().toLowerCase()),
                )
                .map((u) => (
                  <label
                    className="telegram-recipient"
                    key={u.id}
                    data-recipient-id={u.id}
                  >
                    <input
                      type="checkbox"
                      checked={!!u.ready && selectedIds.includes(u.id)}
                      disabled={!u.ready}
                      onChange={() => toggle(u.id)}
                    />
                    <span>
                      {u.full_name}
                      <small>
                        {t(u.access)}
                        {!u.ready ? ` · ${t("botNotStarted")}` : ""}
                      </small>
                    </span>
                  </label>
                ))}
            </div>
            {users.data && !users.data.users.length && (
              <p>No active users available.</p>
            )}
          </fieldset>
          <HowItWorks>
            <p>
              Choose everybody selects all users who can receive bot messages,
              including those outside your search results. Each receives a
              private copy.
            </p>
          </HowItWorks>
          {unavailableCount > 0 && (
            <p>
              {unavailableCount}{" "}
              {unavailableCount === 1 ? "user needs" : "users need"} to start
              the bot and enable notifications before they can be selected.{" "}
              <button
                type="button"
                className="text-button"
                onClick={() => void users.reload()}
              >
                Check again
              </button>
            </p>
          )}
          <label>
            Message
            <textarea
              rows={6}
              maxLength={3000}
              required
              value={message}
              disabled={busy}
              onChange={(e) => {
                setMessage(e.target.value);
                setNotice("");
              }}
              placeholder="Write your message…"
            />
          </label>
          <small>{message.length}/3000 characters</small>
          <button
            className="primary"
            disabled={busy || !recipients.length || !message.trim()}
          >
            {busy
              ? "Sending…"
              : `Send to ${recipients.length} ${recipients.length === 1 ? "user" : "users"}`}
          </button>
        </form>
      </section>
      <section className="panel attendance-panel">
        <div className="attendance-toolbar">
          <h2>Your recent messages</h2>
          <button className="secondary" onClick={() => void history.reload()}>
            Refresh status
          </button>
        </div>
        <HowItWorks>
          <p>
            “Sent to Telegram” confirms bot delivery acceptance, not that the
            person has read the message. Larger groups may take several minutes.
            Unconfirmed messages are not automatically resent.
          </p>
        </HowItWorks>
        <ErrorNotice error={history.error} />
        {history.loading && !history.data && <p>Loading messages…</p>}
        {history.data && !history.data.messages.length && (
          <p>No messages sent yet.</p>
        )}
        {history.data?.messages.map((m) => (
          <article className="employee-card" key={m.id}>
            <header className="employee-card-heading">
              <strong>{m.full_name}</strong>
              <span className="badge">{labels[m.status] ?? m.status}</span>
            </header>
            <small>
              {day(localDate(m.created_at * 1000))} · {clock(m.created_at)}{" "}
              (Tashkent)
            </small>
            <p className="telegram-message-text">{m.text}</p>
          </article>
        ))}
      </section>
    </div>
  );
}
