# Closed checkout correction - 11 October 2026

Application: https://staff.eshtaylakov.uz.
Version: `950ebd5e-f859-451a-94c5-1446ac184cbb`.
App bundle: `index-lE-Dadda.js`.

The salary review guide previously sent invalid closed attendance sessions to Requests even when no employee request existed. It now opens Live attendance on the employee's original workday and opens the relevant correction editor automatically. Open sessions continue to use Close session.

Administrators with attendance management permission can select Correct checkout beside a closed scanned session. The editor displays the original workday and full recorded checkout date/time, and requires a confirmed actual departure in Tashkent time. Reasons remain optional. Original scan data and the administrator's correction are retained. Salary figures and remaining review tasks refresh after saving.

The new endpoint uses the existing approved correction transaction and triggers to check expected timestamps, payroll locks and overlapping attendance atomically. Corrections must stay within the original workday and 18-hour limit, and cannot be in the future. Repeated submissions with the same idempotency key return the recorded result. Administrator corrections are identified in request history and receive readable audit wording. No database migration was needed.

## Verification

51 targeted tests passed across requests, payroll, task routing and audit summaries. Type checking, production build and Wrangler dry run passed. Headless local browser reproduction of the next-day checkout passed: automatic editor routing, blank optional reason, corrected timestamp refresh, guide advancement, salary recalculation and no horizontal overflow at 320, 390, 768 and 1280 pixels. The fixture and correction were synthetic local records only. [Mobile editor screenshot](previews/checkout-correction-mobile.png).

Live production availability and security scripts passed. The affected real employee's timestamps were inspected read-only; no real attendance correction or test message was made. An administrator must confirm and enter the actual departure time through the deployed form.

Private backup: `backups/checkout-correction-20261011-154159/database.sql`, 245605 bytes. SHA-256: `3DFA6EEEC27A605ECFE0D1984B558CEDAD479172706FC86F2D5421AB2AB4F030`.
