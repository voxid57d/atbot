# Availability and hosting assessment — 29 October 2026

## Reported symptom and scope

The owner reports that pages still open, but loading or saving stalls after a few minutes and later recovers. This investigation read application code, live health responses, query performance statistics and a short sanitized runtime sample. It changed no production settings, billing, records or hosting.

## Evidence

- Three public health requests returned HTTP 200, taking approximately 1,039 ms, 1,082 ms and 548 ms end to end. This tests a lightweight endpoint, not the authenticated payroll workflow or the reported incident.
- A 55-second live runtime sample observed one invocation and no errors. The sample is too small to exclude intermittent failures.
- The top 100 D1 query patterns over a rolling 24 hours accounted for 4,079,184 rows read, 2,055 rows written and 58,571 query executions. These are the returned query shapes, not a complete account-wide UTC-day quota measurement.
- The minute notification cleanup query scanned 1,546,825 rows over 1,325 executions while writing/deleting zero rows. Its average SQL execution time was about 1.27 ms. This is inefficient repeated scanning and quota consumption, not proof that this query itself caused a long wait.
- Other frequent scans include shift reminders, discipline views, weekly schedules and materialized shifts. The minute cron and browser polling contribute steady work even when the owner is not saving changes.
- Historical Worker failure/CPU analytics could not be retrieved because Cloudflare's analytics API returned “Rate limiter budget depleted.” That response applies to the analytics API request and is not evidence that the app's own API exceeded a limit.
- The client API wrapper has no default request timeout. A fetch that remains pending can leave a save form busy. Polling also starts another reload without cancelling an older request. These behaviors can amplify a slow backend or network interruption.
- Application writes are independently limited to 100 requests per IP per minute; authentication uses 20. A paid hosting plan does not change these application rules.

## Current provider limits and costs

Checked the providers' official documentation on the assessment date:

- [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/): Free has 10 ms of CPU per invocation and 100,000 daily requests. CPU excludes database/network waiting. CPU-limit failures return error 1102; daily-request exhaustion can return 1027.
- [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/): Free includes 5 million rows read and 100,000 rows written per day. These limits reset at 00:00 UTC (05:00 Tashkent). Hitting a daily quota normally does not explain recovery only a few minutes later, except around reset time.
- [D1 limits](https://developers.cloudflare.com/d1/platform/limits/): Free has 50 D1 calls per Worker invocation; Paid has 1,000. A batch counts as one call for this limit, although row usage still counts. The application already uses batches extensively.
- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/): Workers Paid has a minimum $5/month account charge with included usage and additional usage charges. D1 Paid includes 25 billion monthly reads and 50 million monthly writes. The observed database usage is far below those included monthly quantities. This is not a guarantee of the final account-wide bill.
- [Vercel Hobby](https://vercel.com/docs/plans/hobby): restricted to personal, noncommercial use. [Vercel pricing](https://vercel.com/pricing) lists Pro from $20/month. [Vercel cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing) allow Hobby jobs only once daily; Pro supports minute scheduling. An alternative migration could put the schedule in Supabase Cron instead.
- [Supabase pricing](https://supabase.com/pricing): Free includes a 500 MB database and can pause after one inactive week; Pro starts at $25/month. Vercel Pro plus Supabase Pro therefore starts around $45/month before additional usage and applicable taxes. Existing plans or another architecture can change that comparison.

## Recommendation

For this existing business attendance/payroll application, keeping Cloudflare and moving to Workers Paid is the lower-cost, lower-change option. It preserves the existing database and deployment architecture and gives substantially more CPU/database headroom. However, paying is not a proven cure for an unidentified stall. Query scans, heavy repeated previews, request timeouts and observable error reporting should also be improved.

The immediate diagnostic target remains an affected request's HTTP status/error and Worker outcome at the time of the stall. Check for CPU-limit errors, D1 quota/overload errors, application 429 responses, slow requests and network failures. No root cause was conclusively captured in this short investigation.

## Migration feasibility

Business data can be preserved in a Vercel/Supabase migration, but it requires a staged application/database port. D1 uses SQLite; Supabase uses PostgreSQL. The SQL functions, views, triggers, transactional batches, database bindings and minute background jobs need equivalent implementations and verification. The React interface and much of the pure business calculation code can be reused.

The migration must preserve stable employee/Telegram IDs, historical rates and role assignments, schedules, original/corrected attendance, leave and overtime requests, uniform and quality reviews, fine decisions, policies, audit logs, immutable finalized payroll snapshots, locks and notification delivery/idempotency state. Historical snapshot JSON and integer UZS totals should be verified exactly. Authentication sessions may intentionally be invalidated, requiring sign-in; tablet registrations/pairing must be deliberately handled.

A safe sequence is: approved fresh private backup; PostgreSQL schema/logic conversion; isolated import; row/key/checksum and payroll-total validation; API and Telegram/job rehearsal; a short write freeze and final synchronization; domain/webhook/scheduler cutover; verification; and retention of the old deployment/database for rollback. Only one scheduler/delivery path should be active during cutover to prevent duplicate notifications. Never overwrite or remove the only good source copy before validation.

Migration has not been started, and no subscription has been purchased or changed.
