# CDC Voucher Bot

A private Telegram quality-of-life bot for managing CDC, supermarket, and energy vouchers. Add a voucher once, see live balances at a glance, and create checkout QR codes in seconds.

> Unofficial community tool. It is not affiliated with, endorsed by, or operated by any government agency.

## What it does

- Shows a rich Telegram dashboard with CDC / Heartland, Supermarket, and Energy balances.
- Keeps voucher links private: incoming links are deleted after receipt and encrypted before storage.
- Detects duplicate voucher tranches without exposing the link.
- Creates QR codes for a chosen amount.
- Splits a payment across up to two voucher tranches when that produces a better exact amount.
- When an exact amount is unavailable, uses the largest safe voucher amount and tells the user how much cash to top up.

## Commands

| Command | Purpose |
| --- | --- |
| `/start` | Open a fresh CDC dashboard |
| `/dashboard` | Open a fresh CDC dashboard |
| `/cdc` | Create a CDC / Heartland QR |
| `/supermarket` | Create a Supermarket QR |
| `/energy` | Create an Energy QR |

## Privacy model

- Telegram IDs are HMAC-derived before persistence; raw IDs are not stored in D1.
- Voucher URLs and voucher-group IDs are AES-GCM encrypted at rest.
- Duplicate detection uses an HMAC fingerprint, not a raw identifier.
- Voucher links never appear in bot messages, inline-button payloads, or logs.
- Every database operation is scoped to the current Telegram user.

## Local development

```sh
npm install
cp .dev.vars.example .dev.vars
npx wrangler d1 migrations apply cdc-voucher-wallet --local
npm run dev
```

Generate a local master key with:

```sh
openssl rand -base64 32
```

Required local secrets in `.dev.vars`:

```text
TELEGRAM_BOT_TOKEN=
TELEGRAM_SECRET_TOKEN=
WEBHOOK_SECRET=
MASTER_ENCRYPTION_KEY=
```

## Checks and deployment

```sh
npm run typecheck
npm test
npx wrangler deploy
```

Cloudflare bindings and the production D1 database are defined in `wrangler.jsonc`. Never commit secrets or a populated `.dev.vars` file.
