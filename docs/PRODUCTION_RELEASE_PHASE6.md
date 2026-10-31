# Phase 6 production release

Released on 10 October 2026 under the owner's standing deployment authorization. Automated/software verification is complete; physical Telegram and Samsung Tab A9 checks remain pending because the owner will test devices later.

- Existing Worker: `staff-attendance-api`
- App: https://staff-attendance-api.voxid-mr.workers.dev
- Existing D1: `staff-attendance-db`, binding `DB`, ID `0d6fc486-37ad-4639-a199-00f92e765778`
- Active version: `3760c239-8a50-4594-831b-750af0915367`
- Frontend bundle: `/assets/index-CkisfTo_.js`
- Previous Phase 5 version: `dec71a7e-045e-4b75-ac22-bba6e137a112`
- Existing one-minute cron, production origin, logging, bot/webhook and all three encrypted secrets preserved.

## Validation

`npm run check` passed all **172 tests in ten files**, TypeScript and the Vite production build. Seven added integration tests cover private error headers and full-schema readiness/failure. Worker dry-run bundling passed at 968.86 KiB uncompressed / 163.90 KiB gzip, with 15 static files.

The final bundled app passed real local Worker/D1 Chrome verification of reception pairing, mobile/tablet orientations, QR display, service-worker cache boundaries, Android PNG install icons, offline QR removal/reload, online recovery and revoked display pairing. The production build renders no local-development login form. Screenshots were visually inspected. Fake credentials and synthetic local records were used with notifications disabled.

Both complete and runtime-only npm advisory audits returned zero known vulnerabilities. The release-config helper verified existing resource IDs, HTTPS production vars, cron/assets/logging, absence of configured plaintext credentials and absence of bot credentials/fake tokens in public source/build.

Live `verify-production.mjs` passed current frontend/assets, full-schema Phase 6 health, CSP/HSTS, private-route authentication boundaries, reception PWA assets/install icons and invalid login rejection. `verify-security.mjs` passed forged cookies, missing/cross-origin writes, content type/body limits, wrong webhook secret, preflight isolation and private HTTPS/no-cache error headers. Deliberately invalid requests created no account, financial record or message.

No new migration was needed: all five existing migrations remain applied. Production counts after deployment remained two users, one employee, one rate, one attendance record and one request. Payroll snapshots, adjustments and fine decisions remained empty. Foreign-key checks returned no errors. No synthetic production attendance or payroll finalization was created.

## Backup and restore rehearsal

Private backup: `backups/phase6-20261010-031735/database.sql`, 63,996 bytes. The timestamp in this folder name is UTC. Owner-only Windows ACLs and ignored source-control paths protect both the export and rehearsal directory.

SHA-256: `80DD5B82F070F44C4D894BFE9F78E1FD17887B03BF03DF6C36ECF07EFF7E3835`.

The actual export was restored only to newly created private local storage at `backups/restore-rehearsal-20261010-031754/state`. It preserved production aggregate counts, applied current migrations and passed foreign-key checks. Restored local authentication sessions were revoked. No local Worker/cron was started on restored production data. No production restore occurred.

Read-only notification inspection found five `sent` records and two enabled chats, without pending/failed/uncertain rows at that time. This proves recorded Bot API acceptance, not physical device receipt. Tooling sent no direct test message.

## Remaining owner checks

Follow [the pending device checklist](DEVICE_CHECKS.md) when devices are available: selected-account isolation in native Telegram, native scanner/camera permissions, Android installation/pinning and sleep/reboot recovery, notification receipt and CSV client handling. These results have not been inferred from Chrome automation.

Use [the administrator guide](ADMIN_GUIDE.md) for daily and month-end workflows and [the release runbook](RELEASE_RUNBOOK.md) for deployment, private backups and restore rehearsal. Agree a backup schedule, retention and private off-machine storage; no external transfer or automation was added.
