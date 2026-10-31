# Release, backup and recovery

Use only the existing Worker `staff-attendance-api` and D1 `staff-attendance-db` (`DB`). The owner authorized future deployments and necessary migrations without repeated approval. Live payroll corrections still use the application approval/reopening workflow.

## Release commands

From the project directory in PowerShell:

```powershell
npm ci
npm run check
npx wrangler deploy --dry-run --outdir .wrangler/release-dry-run
npx wrangler d1 migrations list DB --remote
powershell -NoProfile -File scripts/backup-production.ps1 -Label release
# Inspect the pending migration files, then apply only if needed:
npx wrangler d1 migrations apply DB --remote
npx wrangler deploy
node scripts/verify-production.mjs
node scripts/verify-security.mjs
npx wrangler d1 migrations list DB --remote
npx wrangler d1 execute DB --remote --command "PRAGMA foreign_key_check;" --json
```

Wrangler login requires Workers and D1 access. `npx wrangler whoami` verifies login; use `npx wrangler login` if necessary. Never upload `.dev.vars`: it contains fake local credentials. Preserve the HTTPS origin, assets binding, D1 binding, observability and existing one-minute notification cron. Phase 6 needs no new migration or secret.

Record the deployed version, backup checksum, test/build results, pending-migration result and integrity checks. A dry run bundles locally; `deploy` changes the live Worker/assets. Local migration commands use `--local` and do not modify production.

## Private backups

```powershell
powershell -NoProfile -File scripts/backup-production.ps1 -Label scheduled
```

The helper creates a new ignored backup directory with owner-only Windows ACLs, exports existing D1, verifies nontrivial size and writes a SHA-256 metadata file. Raw export output is withheld because it can include signed download URLs. Folder timestamps are UTC. Backups include private payroll, Telegram IDs, audits and session hashes.

The helper is manual; agree an operational schedule and retention with the owner. Store protected copies off the workstation using an owner-chosen private destination. A local disk alone is not disaster recovery. No external transfer or scheduled task has been configured.

## Safe restore rehearsal

Use the actual path printed by the backup command:

```powershell
powershell -NoProfile -File scripts/rehearse-restore.ps1 -BackupFile backups/<backup-folder>/database.sql
```

This creates a **new private local D1 persistence directory**, imports the export, applies any later migrations, revokes restored local sessions and checks aggregate counts and foreign keys. Every Wrangler operation is explicitly `--local`; no Worker/cron is started. Existing production and local working databases are untouched. Inspect the report and compare counts with the source; a checksum alone does not prove restorability.

Cloudflare describes SQL import/export in [its D1 guide](https://developers.cloudflare.com/d1/best-practices/import-export-data/). The Phase 6 rehearsal restored the production export, preserved users/employees/rates/attendance/requests and found no foreign-key errors. Restored local sessions were removed.

## Production recovery

1. Identify the incident and affected data. Record current Worker version and take a fresh private export before recovery where possible. Coordinate a maintenance window and prevent writes during recovery.
2. For a code-only regression, restore the recorded compatible Worker version through Cloudflare deployments. Do not undo forward schema migrations just to match old code; verify schema compatibility first.
3. For data loss, inspect D1 Time Travel bookmarks and available recovery window in Cloudflare. Choose and review the target timestamp carefully; restoring a past point also removes legitimate later changes. [Cloudflare's Time Travel documentation](https://developers.cloudflare.com/d1/reference/time-travel/) describes the available recovery operations and limits.
4. Rehearse a SQL export locally before selecting SQL import recovery. Never blindly import over a populated live database. A replacement production binding or destructive restore needs a concrete incident-specific plan; neither is performed by these scripts.
5. After a production data restore, invalidate restored authentication sessions, verify tablet registrations and account mappings, inspect notification outbox state to avoid duplicate historical delivery, and reconcile later attendance/payroll changes against audited records.
6. Verify schema/migration bookkeeping, row counts, foreign keys, rates, saved payroll versions and the live verification scripts before reopening writes.

No production restore has been performed. Preserve exports and audit history throughout recovery.
