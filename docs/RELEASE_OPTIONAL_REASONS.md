# Simpler controls and optional reasons — 2026-10-10

Overview no longer repeats sidebar navigation in a Quick actions panel. Secondary staff-visibility and refresh controls use a responsive More options disclosure on attendance and payroll; schedules, requests and daily reviews also expose disabled-staff visibility there. The dedicated reveal/hide button remains available, and an indicator shows when disabled staff are visible. Menus close on Escape or an outside pointer click. Pending request decision forms expand under Review request.

Reasons are optional in all shared form fields, administrative dialogs and API schemas, including request decisions, payroll adjustments, employee changes and schedule edits. Blank, omitted and short reasons are accepted; supplied notes retain their 1,000-character limit. Bad quality reviews also allow blank or omitted comments. Actor, timestamps, audit history, permissions, review revisions, financial approvals and payroll locks remain enforced.

Migration 0007 rebuilds only daily_uniform_confirmations to remove its minimum-note-length constraint. It preserves every existing row and restores all seven table triggers, including attendance/lock guards, immutable source archiving and payroll revisions. No view or existing source token changes. Empty request decision reasons are stored as NULL; their existing nullable column already supports this. No new secret or Cloudflare resource is needed.

Validation: all 182 tests and the TypeScript/Vite production build passed. Local migration, deployment dry run, mobile and desktop checks at five widths, seven-screen disabled-staff visibility checks, menu dismissal and real blank-reason form submissions passed using synthetic local data. A Bad review submitted successfully with neither comment nor reason. Device checks inside real Telegram and on the Samsung Tab A9 remain with the owner.

Private pre-release backup: backups/optional-reasons-20261010-095434/database.sql, 123389 bytes, SHA256 E499DF4F5BF0861B47729CD18536656E23381D947D68E6A00755AA6779CC03FF. Before migration: four uniform confirmations, four employees, four attendance sessions and seven uniform table triggers; foreign-key checks were clean.

Migration 0007 applied successfully to the existing production DB. After migration, all four uniform rows, four employee rows, four attendance rows and seven uniform triggers remain; foreign-key checks are clean and there are no pending migrations. The final mobile menu alignment was checked with open menus at both 320 and 390 pixels on all seven screens.

Final deployment: existing Worker staff-attendance-api, version dcc36b88-11ec-4517-8e37-176959ba62e7, frontend /assets/index-C5uMci2q.js, CSS /assets/index-DcbTB8pa.css. Live production and security checks passed against the final build. Production verification created no business records or Telegram messages. Close and reopen the Mini App to load the updated interface.
