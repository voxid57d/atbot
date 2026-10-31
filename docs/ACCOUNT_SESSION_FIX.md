# Telegram account session isolation fix

Status: deployed on 10 October 2026 after explicit owner approval. No database migration or secret changes were required.

## Problem

The frontend previously fetched `/api/me` using an existing HttpOnly session cookie on startup, before authenticating the Telegram account that opened the Mini App. A Telegram client/browser sharing cookies between accounts could therefore show the previous owner's authenticated workspace. The backend authorized the cookie identity and did not compare it with the current Telegram launch.

## Change

- A production Mini App launch authenticates current signed Telegram `initData` before fetching the workspace. With no Telegram launch data, the frontend shows sign-in instructions instead of restoring a browser cookie.
- Each authenticated API read/write carries current `X-Telegram-Init-Data`. The server verifies its HMAC, timestamp and Telegram ID and requires it to match the cookie account. Cookie-only production requests and mismatched/tampered identities are rejected.
- Logging in as a different account revokes the previous cookie session. An unregistered account receives the registration error and cannot fall back to the owner's workspace. Successful switching installs one replacement session cookie.
- A matching, valid session can resume the same signed launch on reload without consuming the login twice. New login still requires five-minute freshness and replay protection. Existing-session identity proofs remain usable for at most the twelve-hour session lifetime; they cannot establish a new session after the five-minute limit.
- Account state is cleared before login and on authentication denial. Fake local initData stays in memory and is excluded from production; production never trusts unsigned user IDs or `initDataUnsafe`.
- The reception tablet's separate pairing/QR authorization is unchanged.

## Validation

Regression coverage includes owner-cookie/other-account reads and writes, unregistered switching, employee switching without owner permissions, same-account reload, older launch resumption versus new login, tampered launch identity, and mandatory production identity proof. Frontend API tests cover current account headers on reads/writes, SDK account switching, and exclusion of development credentials from production.

`npm run check` passed all **102 tests**, TypeScript checking, and the production frontend build. Previous-account responses received after an in-flight account switch are also discarded. Production deployment succeeded after approval; no employee, wage, attendance or permission records, migrations or secrets were changed.

The fix requires a Worker/frontend deployment only. Existing employee data, role grants, wages, migrations and encrypted secrets are preserved. After approval/deployment, fully close the old Mini App and reopen it from each Telegram account. An unregistered account must be added by an administrator before it can use the employee workspace.

Signed launch verification follows [Telegram's Mini App validation specification](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app). Real Telegram account-switching verification remains a device check; local regression tests do not impersonate production users.

## Production release

- Existing Worker: `staff-attendance-api`.
- URL: https://staff-attendance-api.voxid-mr.workers.dev
- Version: `dde2081d-05fd-4dee-9027-ec8b71e45bb5`.
- Deployed the tested Worker and updated frontend assets; existing D1 bindings and Wrangler settings were preserved.
- Live checks passed for the current compiled frontend (including Telegram identity binding), private API protection, Phase 2 D1 health, PWA files, security headers, and invalid login rejection. Both existing Worker secret names were confirmed present.
- Verification created no production user/session or attendance records. Its deliberately invalid login increments the normal authentication rate-limit counter only.

Fully close any old Mini App window and reopen from the second Telegram account to verify the intended client behavior. An unregistered account receives the registration message; onboard it through **Employees** before expecting employee access.
