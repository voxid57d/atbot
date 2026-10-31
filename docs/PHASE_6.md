# Phase 6: release verification and operations

Automated and operational verification performed on 10 October 2026. The owner chose to test physical devices later. Native Telegram and Samsung Tab A9 acceptance remain explicitly pending in [the device checklist](DEVICE_CHECKS.md).

## Work completed

- Reviewed the original six-phase plan and the existing business/security tests.
- Added private HTTPS/no-cache headers before request body limits, so rejected oversized requests receive the same protection as ordinary private errors.
- Made health readiness check discipline and payroll storage as well as the earlier schema; missing payroll snapshot storage fails safely. Health and authenticated app metadata identify Phase 6.
- Added standard 192/512 PNG installation icons rendered from the existing IELTS ZONE vector logo, and updated reception cache version/assets. Offline reception suppresses the raw fetch error in favor of its clear connection state.
- Added repeatable local release-configuration and live security checks covering forged cookies, cross-origin/missing-origin writes, JSON/body limits, invalid webhook secrets, preflight isolation and private error headers.
- Added owner-only Windows backup and local restore-rehearsal helpers. Rehearsed the actual production export into new private local D1 storage; restored authentication sessions were revoked, and no Worker/cron was started.
- Added administrator workflow, Telegram bot/Samsung kiosk setup and deployment/recovery guides. They preserve the existing Cloudflare resources, encrypted secrets and owner-selected manual paid-leave policy.

## Evidence

All **172 tests in ten files**, TypeScript/Vite build, Worker dry run, release-configuration checks and post-deployment production/security checks passed. The software update is live on the existing Worker. Details are recorded in [the Phase 6 release record](PRODUCTION_RELEASE_PHASE6.md). Seven added release-protection tests extend the prior 165-test suite.

`npm audit` and `npm audit --omit=dev` both reported zero known vulnerabilities at verification time. This is a point-in-time advisory check, not a guarantee against undiscovered issues.

The actual bundled reception frontend and local Worker/D1 passed Chrome checks for pairing, live QR, 390px mobile and 800×1280/1280×800 tablet layouts, shell/hashed asset/install-icon caching, exclusion of all API requests from cache, immediate offline QR removal, offline page reload, online recovery and revocation. No browser page errors or horizontal overflow occurred. Fake credentials, synthetic local registrations and disabled notifications were used.

The private production export was 63,996 bytes with SHA-256 `80DD5B82F070F44C4D894BFE9F78E1FD17887B03BF03DF6C36ECF07EFF7E3835`. Restore rehearsal preserved two users, one employee, one rate, one attendance record and one request. There were zero payroll snapshots and zero foreign-key errors. Local restored sessions were removed. Production was never restored or populated with synthetic test data.

Read-only production inspection confirmed all three required secret names and no pending migrations. The notification outbox contained five `sent` records and two enabled chats, with no failed/uncertain queue entries at inspection. This verifies recorded delivery acceptance; receipt on physical devices remains pending. No direct test message was sent by tooling.

## Guides and previews

- [Administrator operating guide](ADMIN_GUIDE.md)
- [Telegram and Tab A9 setup / pending device checks](DEVICE_CHECKS.md)
- [Deployment, backup and recovery runbook](RELEASE_RUNBOOK.md)
- [Reception online](previews/phase6-reception-online.png)
- [Reception offline](previews/phase6-reception-offline.png)

## Remaining acceptance

The software checks and operational documentation can be completed independently of device availability. Physical Telegram account switching, native scanner/camera permission behavior, Android PWA installation/pinning/sleep recovery, notification receipt and CSV handling need the owner's devices. Do not mark those rows passed until actually tested.

Basic app pinning does not provide managed-device kiosk enrollment or startup on boot. QR screenshots within the short validity window do not prove physical presence. No off-machine backup destination or automatic backup schedule was configured; the owner must choose their storage/retention policy. This release creates no automatic live payroll decisions, bank transfers, new Worker/database or new secret.
