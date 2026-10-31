# Custom domain release — 2026-10-11

Canonical application URL: https://staff.eshtaylakov.uz

Existing Worker `staff-attendance-api` and D1 `staff-attendance-db` remain in use. Wrangler now preserves the dashboard custom-domain attachment through an explicit `custom_domain` route and sets `APP_ORIGIN` to the new HTTPS origin. Other bindings, cron, logging and asset settings remain unchanged. No database migrations were required or applied.

Deployment version: `2d350069-9b80-4c64-b854-1c93c1bdb331`.

Validation: production build, release configuration validation, Wrangler dry run, live production verification and live security verification passed. The main Vercel website returned HTTP 200 before the deployment; its DNS records were not changed by this release.

Telegram's default chat menu was updated and verified at `https://staff.eshtaylakov.uz/`. Future `/start` workspace buttons use the new `APP_ORIGIN`. Existing messages retain their original buttons. The authenticated webhook remains at the existing workers.dev URL; that backend delivery path is independent of users' Wi-Fi, and Telegram reported zero pending updates. No webhook secret was changed and no messages were sent by the release checks.

If a separately configured Telegram profile Main Mini App still uses the old URL, its URL must be updated through BotFather. Browser cookies, saved sessions and reception tablet credentials are scoped to the domain, so users must launch the app through Telegram again and an existing tablet may require pairing on the new domain. Wi-Fi access to the custom domain still needs confirmation on the owner's network.
