# Telegram and Samsung Tab A9 checks

Status on 10 October 2026: the owner will test physical devices later. The following checks are **pending**, rather than claimed as passed. Chrome automation has verified reception pairing, offline recovery, revoked credentials and tablet layouts, but cannot establish native Telegram scanner or Android installation behavior.

## Existing Telegram bot setup

Bot: `@izamirtemurbot`. Mini App URL: `https://staff.eshtaylakov.uz`.

In `@BotFather`, select this bot under `/mybots`, open its Mini App settings and ensure the Main Mini App points to that HTTPS URL. The bot menu button should use the same URL; `/setmenubutton` is another supported configuration route. Preserve the existing bot and token. Telegram documents Main Mini Apps and menu-button launches in [its Mini App guide](https://core.telegram.org/bots/webapps#implementing-mini-apps).

The existing webhook is `/api/telegram/webhook`. Worker secrets are `TELEGRAM_BOT_TOKEN`, `BOOTSTRAP_TELEGRAM_ID` and `TELEGRAM_WEBHOOK_SECRET`; values belong only in encrypted Worker secrets. Webhook updates require Telegram's matching secret header. This release preserves the webhook and secrets. See [Telegram's webhook specification](https://core.telegram.org/bots/api#setwebhook).

After onboarding, each user sends `/start` to the bot to enable delivery. `/stop` disables delivery. The application preferences separately control upcoming-shift reminders. Do not send tokens or signed login data in test results.

## Samsung Tab A9 reception setup

1. Update Chrome and connect the tablet to the center's reliable Wi-Fi. Set a manager-controlled device lock and choose an appropriate screen timeout, brightness and orientation.
2. On the administrator's phone, open **Reception displays**, register a named display and copy the one-use pairing code. Codes expire after five minutes.
3. In tablet Chrome, open `https://staff.eshtaylakov.uz/reception/`. Enter the code and verify a live QR appears. Each QR lasts one minute and renews about 15 seconds before expiry. Temporary refresh failures preserve a still-valid code while automatic retries run. Offline or expired codes are hidden; reconnection resumes automatically. Keep the tablet as a reception display; administrator Telegram login is not needed there.
4. Install from Chrome's menu. Depending on Chrome version, the label may be **Install and create shortcut → Install**, **Install app**, or **Add to Home screen**. [Google's current installation instructions](https://support.google.com/chrome/answer/9658361?co=GENIE.Platform%3DAndroid&hl=en) describe the menu. Open the installed app and test the **Full screen** button.
5. For basic kiosk use, enable app pinning in **Settings → Security and privacy → More security settings → Allow apps to be pinned**. Open Recents, tap the app icon and select **Pin this app**. Menu wording can vary with One UI. Follow [Samsung's pinning instructions](https://www.samsung.com/us/support/answer/ANS10004865/), and enable authentication to unpin where available.
6. Keep the tablet powered and mounted where employees can scan it. App pinning is basic kiosk operation; this project does not configure managed-device enrollment or automatic startup after reboot.
7. Check the display every morning. Paired registrations remain valid until revoked, with rolling browser-cookie renewal during use; no monthly renewal is required. Revoke a lost tablet immediately. Clearing site data removes pairing.

## Acceptance checklist

Use a real shift and actual attendance times. Deliberate test attendance belongs in a separate test environment; do not finalize live payroll or enter artificial scans just to test.

| Check                              | Expected result                                                                         | Status  |
| ---------------------------------- | --------------------------------------------------------------------------------------- | ------- |
| Admin launches from Telegram       | Correct identity and authorized admin screens                                           | Pending |
| Registered employee launches       | Own attendance, discipline and salary; no admin payroll/team access                     | Pending |
| Switch accounts on the same device | No previous owner's data/permissions; reopen uses selected identity                     | Pending |
| Unregistered account launches      | Registration error without private data                                                 | Pending |
| Native QR scanner                  | Opens with permission, reads current code, receives server-confirmed check-in           | Pending |
| Camera fallback                    | Works when native scanner unavailable; denied permission gives a recoverable error      | Pending |
| Actual checkout                    | Requires a current QR scan, records departure and updates attendance once               | Pending |
| Tablet PWA installation            | Correct IELTS ZONE icon, standalone launch, usable portrait/landscape layout            | Pending |
| Wi-Fi off                          | QR disappears; offline screen shows no successful attendance claim                      | Pending |
| Wi-Fi returns                      | Fresh live QR returns without re-pairing                                                | Pending |
| Sleep/wake or reboot               | Reception can be reopened and obtains a fresh QR                                        | Pending |
| Revoked spare registration         | Stops issuing QR; pairing screen returns                                                | Pending |
| User-triggered notification        | A genuine request/decision arrives after `/start` within normal cron processing         | Pending |
| CSV in Telegram client             | Authorized finalized export downloads/opens; if unsupported, record client and behavior | Pending |

Record device model, Android/One UI/Chrome/Telegram versions, date, check and result. Report failures with the visible error and reproduction steps. No credentials are needed in the report.
