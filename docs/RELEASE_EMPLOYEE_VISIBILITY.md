# Disabled employee visibility

Released on 10 October 2026 to the existing Worker under the owner's standing deployment authorization.

Active version: `4c1e673b-2b27-44fd-a546-40c1bcbd93a0`. Frontend: `/assets/index-lDDWe69Z.js`.

Disabled employees are hidden by default in live attendance, employee management, requests/coverage, daily reviews/history, schedules/selectors, admin access and payroll detail lists. **Show disabled employees** reveals the records; **Hide disabled employees** returns to the normal view. The button includes the disabled count when available. Search, summary counts and related selectors follow the visibility filter. Hiding resets a selected disabled employee or inactive attendance filter.

Records are preserved and can still be reactivated/reviewed through existing authorized actions. This is a display filter, not an authorization change or data deletion. Payroll totals, exports, stored versions and required finalization warnings still include earnings/reviews for disabled employees; the UI explains hidden outstanding reviews. Audit history remains intact.

The backend adds current active status to discipline people and a disabled-employee ID list to payroll preview responses. It does not alter payroll calculations or stored snapshots. No migration, secret change or production business-data mutation was needed.

Validation: TypeScript/Vite build, Worker dry run and release-configuration check passed. All 28 relevant payroll/discipline integration tests passed. Browser checks against the actual built local frontend/Worker/D1 passed on all seven screens, including explicit reveal/hide, selectors, mobile overflow, inactive-filter reset, and unchanged payroll entries/totals. Synthetic local records and fake credentials were used. Live production and security verification passed after deployment.

Private pre-release backup: `backups/employee-visibility-20261010-034209/database.sql`, 71,046 bytes, owner-only ACL. Folder timestamp is UTC. SHA-256: `1ED6A34FE06C2992806C24BDE2337562435BFFB3DB5453CA7C6C4B40ABAD3D70`.

Close and reopen the Telegram Mini App to load the update. See [the administrator guide](ADMIN_GUIDE.md).
