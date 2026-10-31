# Monthly salaries UI release - 11 October 2026

Deployed to the existing `staff-attendance-api` Worker at https://staff.eshtaylakov.uz.

Version: `2234a4d7-dcad-42c3-84ad-405b513cf2a8`.
Assets: `index-DcPMhEFh.js` and `index-C6dpqZc8.css`.

## Behavior

- Monthly salaries navigation, month selection and a labeled total calculated salary.
- Separate employee cards with individual salary, worked time, salary-counted time and review status.
- Collapsed Salary breakdown and Review tasks sections; plain dated task labels.
- Review next task follows permission checks and guides the administrator through remaining decisions for the selected employee. Successful saves refresh the guide; sidebar navigation exits it.
- Disabled employees remain hidden by default, with an explicit reveal button. Their earnings and unresolved tasks still count toward the month total and finalization requirements.
- Finalize month explains its purpose and blockers. Existing calculation, locking, approval, optional-reason and export rules are preserved.

## Verification

Production build and Wrangler dry run passed. Targeted payroll, calculation and API regression tests: 64 passed across three files.

Headless local browser checks used synthetic records only in isolated local storage. Verified separate salaries, aggregate totals including disabled staff, collapsed details, daily shift breakdown, independent calendar months, future-month finalization blocking and no horizontal overflow at 320, 390, 768 and 1280 pixels. The guided sequence completed work-quality review, uniform review and adjustment approval, then returned to the updated employee salary. No browser page errors occurred.

Live production and security verification scripts passed after deployment. They created no business records or Telegram messages. No production migration was required or applied.

Screenshots: [desktop](previews/monthly-salaries-desktop.png), [mobile](previews/monthly-salaries-mobile.png), [reviewed employee](previews/monthly-salaries-reviewed.png). Actual staff device testing remains distinct from these browser checks.

## Backup

Private owner-restricted production export before deployment: `backups/monthly-salaries-ui-20261011-143703/database.sql`, 218189 bytes.

SHA-256: `ADC54EF815297C69B2642747DDDE89773F9421E1F98AA57DB34607BDDD33E1F8`.

No restore was performed. Existing Worker, D1 database, secrets, custom domain, cron and bot integration were retained.
