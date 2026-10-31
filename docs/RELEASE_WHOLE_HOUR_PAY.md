# Whole-hour salary calculation

Approved policy: combine an employee's credited regular time and approved overtime per workday, then round down to completed hours. Partial hours never carry into another day or month. Exact attendance and eligible intervals remain available for reviews.

The calculation keeps payable intervals in chronological order and drops the final remainder. Gaps, open attendance and unapproved overtime do not earn salary. Existing scheduled late-arrival credit rules remain in effect. Historical hourly rates and daily extended-hours replacement rates still apply in chronological order. For example, at a threshold of eight hours, 9h 30m eligible time earns eight normal hours and one replacement-rate hour.

Admin monthly cards, employee monthly estimates and CSV exports expose paid time separately from eligible regular/overtime time. Open months recalculate with calculationVersion 3. Existing finalized snapshots remain immutable, including their original calculation and totals; reopening a month explicitly recalculates it under the current policy.

No schema migration or attendance mutation is required. Private production backup obtained before deployment. Automated tests cover whole-hour boundaries, multiple visits, gaps, overlapping approvals, daily and month resets, historical rates, cashier thresholds and matching employee/admin API amounts.

Released Worker version: `cba40e01-f023-4a9e-92e9-d45d1b37a617`. Validation: 118 tests passed across targeted suites, production build and Wrangler dry run passed, synthetic browser checks passed at 320/390/768/1280 widths, and live production/security checks passed after deployment propagation. The initial broad runner stalled and was stopped; affected suites were run separately. No real staff attendance, approvals or finalized snapshots were edited during verification.
