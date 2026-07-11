# Acceptance audit

## Verified

- Production deployment `1e95973a-ea16-42c5-9b2c-32c0c93afa31` receives 100% of `cdc-voucher-bot` traffic.
- Production `/health` returns `ok: true` for `cdc-voucher-wallet` version 1.
- APAC D1 migration is applied with user, source, balance, and idempotency tables.
- TypeScript compilation passes.
- Ten core tests pass: encryption context, user isolation, signed callbacks, URL validation, mixed-tranche classification, energy classification, exact and safe-lower selection, alias isolation, and PNG output.
- The Cloudflare dry-run bundle succeeds and the Worker starts under local `workerd`.
- The CDC Bank dashboard is delivered as a Telegram rich-text table with category totals and individual voucher tranches.
- Webhook security returns 404 for the wrong secret path, 401 for a missing Telegram secret header, and 400 for invalid JSON.
- Repeated Telegram update IDs are processed once in D1.
- A real `/start` update reached the production webhook and created one isolated user account.
- The live Add voucher button moved that account into `await_voucher`, proving the signed callback and onboarding flow work against Telegram’s production API.
- A Worker-runtime integration harness completed onboarding, clicked the signed Add voucher button, and ingested a real RedeemSG tranche through a fake Telegram transport.
- The integration run deleted the incoming message, stored one 133-character ciphertext with zero plaintext `redeem.gov.sg` occurrences, split the tranche into CDC and supermarket rows, and rendered an 83,933-byte dashboard PNG.
- Re-adding the same tranche produced the expected “already added” message and did not create a second source.
- `/supermarket 20` generated a 168,588-byte PNG with an exact $20 selection using one voucher.
- `/start` now registers exactly three Telegram menu commands: `/cdc`, `/supermarket`, and `/energy`.
- Telegram `getMyCommands` confirms those are the only three registered commands on the live bot.
- Successful intake immediately updates the persistent CDC Bank panel with the tranche’s per-category balances and total; it does not create a separate receipt message.
- Dashboard navigation, voucher management, amount selection, confirmations, and refresh feedback reuse the persistent Telegram panel through rich-text edits. Voucher links, amount entries, and slash commands are removed after processing to keep the chat clean. A scannable QR temporarily replaces that panel and is removed when returning to the dashboard.

## Awaiting one live voucher submission

- One real voucher should be added to verify incoming-message deletion, encrypted D1 persistence, mixed-category dashboard balances, and QR generation against Telegram’s production API.

The prior production version is `d8b0e53b-b22e-4c68-9b17-e6f4e2b4d91b` and remains available for rollback.
