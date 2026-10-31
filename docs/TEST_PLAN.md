# Business test coverage by phase

Phases 1 and 2 now have 91 passing tests. The foundation suite remains intact; Phase 2 adds interval/earnings and isolated-D1 attendance tests. The matrix below retains later-phase review/payroll requirements. See [the Phase 2 validation record](PHASE_2.md).

| Required scenarios                                                                             | Implementation/testing phase                         |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Scheduled start, 1/35/59 minutes late, exactly one hour late, 08:30 anchored hourly blocks     | 2                                                    |
| Early departure by 30 minutes, multiple sessions, unpaid gaps, overlapping intervals           | 2, then review workflow in 3–4                       |
| Approved/unapproved overtime and forgotten checkout                                            | 2 calculation rules, 3 approvals/reminders           |
| Repeated QR attempts, expired QR, disabled employee check-in                                   | 2                                                    |
| Excused lateness, bad rating, missing/rejected uniform                                         | 4                                                    |
| Multiple daily violations, warning/second/third/fourth progression, configurable later actions | 4                                                    |
| Reversals/fine recalculation and payroll-month reset                                           | 4–5                                                  |
| Corrections, absence approval, replacement coverage                                            | 3                                                    |
| Mid-month historical rate changes and interval splitting                                       | 5; Phase 1 tests immutable dated rate storage/lookup |
| Payroll locks and audited post-lock corrections                                                | 5                                                    |
| Unauthorized employee/admin access and repeated mutation idempotency                           | 1, extended in every later phase                     |

Phase 2 implements and tests pure interval/pay calculations, including every supplied 12,000 UZS example. Actual attendance seconds, regular credited union, and approved actual overtime union must be separately asserted. Monetary calculations should use integer/rational arithmetic and one documented final rounding rule. No automatic fines or legal policy assumptions are introduced in Phase 1.
