# Multi-recipient Telegram messages

Admins and super admins can select multiple users in **Team → Telegram messages**, search by name, choose everybody, clear the selection or deselect individual users. Choose everybody includes all active users with a linked enabled bot chat, regardless of the current search filter. Users who cannot receive bot messages are listed with disabled checkboxes and an explanation.

One submission queues an identical private copy for each selected recipient. The send button shows the recipient count. Recipient IDs are deduplicated server-side. Recipient validation, queue rows, individual audit events and idempotency response form one transaction; unavailable selections reject the whole send instead of partly queueing. Retrying the same request does not duplicate any recipient's message. Existing single-recipient clients remain compatible. Delivery status remains per recipient and larger groups may take several minutes through the existing notification job.

No schema migration required. Testing uses isolated D1 and mocked Telegram delivery, plus a local browser with notifications disabled. No real test messages were sent. A private production backup was taken before release.

Released version: `3d34cbbb-c2e8-4e34-9f62-22bc032d8bb8`. Validation: five targeted messaging/delivery regressions passed, then the three affected messaging tests passed again after strengthening the transactional recipient guard. Build passed. Local browser verified multi-select, Choose everybody across a search filter, clearing selection, unavailable users, two queue rows, form reset and responsive layout at 320/390/768/1280 widths.
