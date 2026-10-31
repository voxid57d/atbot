# Reception QR reliability — 2026-10-10

QR tokens now last 300 seconds from issuance instead of expiring at the next 30-second boundary. Existing 30-second tokens remain valid only through their original expiry during the rollout. Signature verification, expiry enforcement and registered-display checks still run on check-in; no database migration is required.

The display renews about 15 seconds before expiry instead of waiting for expiration. Successful operation fetches approximately once every 285 seconds. A temporary failure retains the last signed code until its original expiry. Failed GETs retry after 5, 10, 20 and then 30 seconds; a request is aborted after 12 seconds. Requests never overlap. Returning online or waking the display checks whether renewal is due rather than unnecessarily refetching a still-valid code. Offline/expired codes remain hidden. Invalid registration stops background polling until pairing. Error text explains automatic retry rather than exposing the browser's generic fetch error.

QR requests explicitly bypass browser caching. The reception service-worker cache version is bumped to v5 for the updated shell; API responses and QR data are never cached. Existing tablets retain their pairing credentials.

Private pre-release backup: `backups/qr-reliability-20261010-075050/database.sql`, 121647 bytes, SHA256 `BA660A5188DBEDC518EDD5171226FC838F0EB98EA2C562AA2DBE50CD670C9A37`.

`npm run check` passed all 180 tests and the TypeScript/Vite build. Signing tests verify a full 300-second lifetime, exact expiry, tampering rejection and the original expiry of legacy codes. Chrome checks passed against isolated local D1 for real pairing, low polling, reconnect reuse, valid-code retention during failed renewal, hiding expired codes, request timeout, automatic recovery and stopping polling on invalid registration. The test browser blocked service workers while injecting network failures; service-worker changes were checked separately in the build/live asset checks. No browser exceptions or horizontal overflow were observed. Wrangler dry run passed and there are no pending database migrations.

Deployed to the existing Worker at `https://staff-attendance-api.voxid-mr.workers.dev`, version `75c9b42c-70ef-4f9c-9a87-308fe25b5572`, frontend bundle `/assets/index-DUD76Voi.js`. Live production and security checks passed, including the current bundle, assets, D1 health, access boundaries, reception PWA and rejected invalid requests. No synthetic production attendance, display pairing or notification messages were created for verification. Existing secrets, database schema, cron and bot setup are preserved.

Refresh/reopen the reception display to load this release. Real Wi-Fi/router and Android behavior must still be assessed on the reception tablet; the exact cause of the owner's intermittent browser fetch errors is not established from local reproduction alone.
