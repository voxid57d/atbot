export type ShiftMessage = {
  kind: "start" | "end" | "encouragement";
  slot: number;
  due: number;
  expires: number;
  text: string;
};
const encouragements = [
  "Small things make a big difference ✨ A warm welcome or a little extra help could make someone's day. Thanks for being part of IELTS ZONE 💜",
  "One step at a time 🌱 Your care and effort help our students move closer to their goals. You've got this! 💜",
  "A little kindness goes a long way ☀️ Thank you for bringing yours to IELTS ZONE today!",
  "Teamwork makes busy days brighter 🤝 Thanks for supporting your teammates and our students today 💜",
  "Every helpful moment counts ✨ You don't need a perfect day to make a positive difference. Keep going at your own pace 🌿",
  "Here's a little boost for your day 🚀 Your work helps keep IELTS ZONE welcoming and running smoothly. Thank you! 💜",
];
const clock = (timestamp: number) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tashkent",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp * 1000);
export function shiftMessages(
  shift: { id: string; start_at: number; end_at: number },
  name: string,
): ShiftMessage[] {
  const duration = shift.end_at - shift.start_at;
  const messages: ShiftMessage[] = [
    {
      kind: "start",
      slot: 0,
      due: shift.start_at - 1800,
      expires: shift.start_at,
      text: `Hey ${name}! 👋 Your shift starts at ${clock(shift.start_at)}. See you soon at IELTS ZONE—let's make it a good day! 💜`,
    },
    {
      kind: "end",
      slot: 0,
      due: shift.end_at - 600,
      expires: shift.end_at,
      text: `Almost wrap-up time, ${name}! 🙌 Your shift ends at ${clock(shift.end_at)}. Finish your essentials, then remember to scan the reception QR when you leave 📱`,
    },
  ];
  // Short shifts get reminders only. Encouragement is well away from start/end.
  if (duration >= 2 * 3600) {
    const count = duration >= 6 * 3600 ? 2 : 1;
    let seed = 0;
    for (const char of shift.id) seed = (seed * 31 + char.charCodeAt(0)) >>> 0;
    for (let n = 1; n <= count; n++) {
      const due = shift.start_at + Math.floor((duration * n) / (count + 1));
      messages.push({
        kind: "encouragement",
        slot: n,
        due,
        expires: Math.min(due + 300, shift.end_at - 600),
        text: encouragements[(seed + n) % encouragements.length],
      });
    }
  }
  return messages.filter((m) => m.kind !== "end" || m.due > shift.start_at);
}
