# Payroll review remainders

An approved interval ending at 21:00 with actual checkout at 21:01 left one unapproved minute. Payroll used any nonzero unapproved time as a blocker even though daily whole-hour pay could not increase.

The payroll extra-time task now appears only when approving the remaining time could add a completed paid hour. This compares whole hours from credited regular time plus approved overtime against the same total including remaining closed unapproved time. Remainders combine: 2h59m approved plus 2m pending still requires review. 2h12m approved plus 1m pending does not. Employee estimate pending status uses the same rule. Exact attendance and unapproved time remain available; salary amounts, approvals and finalized snapshots are not mutated by this release.

No database migration required. Regression coverage includes the reproduced one-minute approval gap, a remaining interval that adds another hour, daily remainders and existing payroll permission/finalization checks.

Deployed version: `bb972f72-edb4-428c-b8ef-fa6ea9e51b2f`. Validation: 42 tests passed across the regression run and corrected-fixture rerun; build and deploy dry run passed. The initial new fixture attempted to change a recorded schedule directly and was correctly rejected by database guards; it was corrected to use an outside-schedule session. A private production backup was obtained. Production attendance and approval timestamps were inspected read-only; no real business records were edited.
