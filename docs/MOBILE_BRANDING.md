# IELTS ZONE mobile layout and branding

Deployed with owner approval on 10 October 2026 to the existing `staff-attendance-api` Worker. Production version: `b9f5d1df-9ebe-42ad-8858-bb9a94ab28f0`.

The supplied `ielts-zone-logo-no-bg.svg` uses one color, deep purple `#320A3E`. The original vector is preserved at `public/brand/ielts-zone-logo.svg`. White/lavender backgrounds, purple navigation and actions, matching favicon and reception icon support that color. App copy, browser titles, reception instructions and the PWA install name use **IELTS ZONE**.

Phone layouts now use a compact sticky header and expandable menu, smaller headings/cards/gaps, two-column attendance metrics, single-column forms, safe-area padding and 44-pixel primary controls. Inputs retain a 16-pixel font to avoid focus zoom on iOS. Request forms, coverage configuration, absence policy and notification settings expand when needed. Attendance history uses expandable daily cards on phones and keeps the table on larger screens. Staff/admin tables scroll inside their own container rather than widening the whole page.

The Requests screen also now reads the employee-list API's `{ employees: [...] }` response correctly, fixing the coverage employee selector's runtime error.

## Validation

- Final TypeScript check and Vite production build passed.
- Worker deployment dry run passed against the existing Worker and D1 configuration.
- Local Chrome checks passed at widths 320, 390, 430, 768 and 1280: employee attendance, absence/correction forms, staff list, employee dialog, request management and profile. None produced page-wide horizontal overflow. Navigation closes after choosing a screen; the absence action opens its form; only one employee request composer opens at a time.
- The actual built reception PWA passed online/offline checks: its branded logo and public shell loaded from cache, no private API responses were cached, no stale QR appeared offline, and its phone viewport did not overflow.
- Screenshots were inspected for the phone, desktop, request management and login views. Preview data is synthetic and never written to a database. No real Telegram messages or production requests were used for visual QA.
- The in-app browser connection was unavailable, so visual checks used temporary Playwright tooling with the installed local Chrome browser. No application dependency was added.

The reception service-worker cache is versioned for the new logo and removes old reception caches on activation. It caches the public logo/shell/assets only; private API responses and QR data remain uncached.

## Previews

- [Employee view on a phone](previews/ielts-zone-mobile.png)
- [Requests on a phone](previews/ielts-zone-requests-mobile.png)
- [Desktop view](previews/ielts-zone-desktop.png)
- [Login on a phone](previews/ielts-zone-login-mobile.png)

## Release

The owner approved deployment, and the tested build was published to https://staff-attendance-api.voxid-mr.workers.dev. Live verification passed for the current frontend/assets, API health, access protection, reception PWA files and invalid Telegram login rejection. No database migration was run. Notification configuration and existing Worker secrets remain as configured for Phase 3. Native Telegram keyboard/scanner and actual-device checks remain separate from browser-width verification.
