# GrasOn AI Chat

(Previously "Centris CRM"; `prd.md` and `CLAUDE.md` still use the old name.)

Full-stack implementation of the PRD in `prd.md`: Next.js 15 (App Router, Server Actions), Tailwind CSS 4, Prisma 6 + SQLite.

## Getting started

```bash
npm install
cp .env.example .env   # fill AUTH_SECRET, INCOMING_WEBHOOK_SECRET, SEED_ADMIN_PHONE
npm run setup          # create database + seed sample data
npm run dev
```

Open http://localhost:3000 and scan the QR with WhatsApp (**Perangkat tertaut → Tautkan perangkat**). The scanner's number must match a staff phone; `SEED_ADMIN_PHONE` sets the admin's. Run `npm run db:seed` again after changing it.

### WhatsApp QR login

- Uses [Baileys](https://github.com/WhiskeySockets/Baileys), an **unofficial** WhatsApp Web client. It can break when WhatsApp changes its protocol, and its use may conflict with WhatsApp's terms. Email + password login stays available on the same page as a fallback (test logins in `prisma/seed.ts`).
- The linked device is only used to read the scanner's own number and is logged out immediately; the temporary auth files are deleted.
- Attempts are kept in memory, so it needs a single long-running Node process (not serverless).

### WhatsApp Hub (QR-linked numbers)

- **WhatsApp → WhatsApp Hub → + Scan QR WhatsApp** links a number as a device (`apiType` "WhatsApp Hub"), also via Baileys. The session stays connected: inbound text messages go through `recordInbound` (AI agent included) and staff/AI/broadcast replies go out through that number (`src/lib/channel.ts`).
- Session credentials are stored in `WA_HUB_DIR` (default `.wa-hub/`, git-ignored). They give full access to the linked WhatsApp account: keep that folder private and out of backups you share.
- Sessions are restored on server start (`src/instrumentation.ts`). Being logged out from the phone marks the device "Terputus"; use **Scan Ulang**.
- No Meta templates on Hub: a template's body is sent as plain text. The 24h window rule in Pesan is unchanged.
- Only text messages (and media captions) are received; groups, status and LID-only contacts are ignored.
- Bulk sending over an unofficial client can get the number banned by WhatsApp.

### WhatsApp Cloud API (official gateway)

- **Outbound**: `src/lib/whatsapp.ts` sends via Graph API using the device's `phoneNumberId` (fallback `WHATSAPP_PHONE_NUMBER_ID`) and stores the returned wamid on the message.
- **Inbound**: `GET/POST /api/webhooks/whatsapp` (`src/lib/wa-cloud.ts`). GET answers Meta's verify challenge (`WHATSAPP_VERIFY_TOKEN`); POST checks `X-Hub-Signature-256` with `WHATSAPP_APP_SECRET`, replies 200 immediately and processes after the response (`after()`).
  - Messages are routed to the device by `metadata.phone_number_id`, deduped by wamid, marked read, then go through `recordInbound` (AI agent included). Media is not downloaded yet; it shows as a label like `[Gambar]` plus caption.
  - Status receipts update `sent → delivered → read` (never backwards); `failed` adds a system note with Meta's error.
- **Setup**: WhatsApp Business page → "Pengaturan Webhook WhatsApp Cloud API" shows what's configured and the callback URL. Meta requires a public HTTPS URL (use a tunnel such as ngrok for local testing). Subscribe the app to the `messages` webhook field.

## Optional configuration (`.env`)

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | AI Agent replies and AI Response Test (model `claude-opus-5-5`). Without it, AI shows a "belum dikonfigurasi" note. |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp Cloud API sending. Without them, outgoing messages are stored as `simulated`. |
| `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET` | Cloud API webhook verification and signature check. Without the app secret, the webhook rejects every POST. |
| `INCOMING_WEBHOOK_SECRET` | Required header `x-webhook-secret` for `POST /api/webhooks/incoming` and `POST /api/cron/followup`. |
| `COIN_COST_AI_REPLY`, `COIN_COST_BROADCAST_MESSAGE` | Coin cost per action. **TBD**, default 0. Balance is checked before the action runs whenever cost > 0. |

## Structure

- `prisma/schema.prisma`: data model (account and coins, staff/roles/groups, devices/templates, customers/conversations/messages, products, funnels/labels, audiences, broadcasts, AI agents, calendar).
- `src/lib/`: domain logic (`messaging.ts` inbound/AI/24h window/follow-up, `ai.ts` Claude prompt, `coins.ts`, `funnel.ts` renumbering, `whatsapp.ts`, `webhook.ts`, `uploads.ts`).
- `src/app/(app)/<module>/`: one page + `actions.ts` per module.
- `src/app/api/`: incoming webhook, follow-up cron, uploaded images, sample CSV.

## Known gaps / assumptions

- Coin pricing, top-up, and upgrade packages are not implemented (PRD open question 1).
- Escalation is keyword-based and configured per agent; criteria/SLA/notifications are still open (PRD question 3).
- Role module permissions are stored but only Admin-only actions are enforced.
- Stage reordering uses ← / → buttons and the "Tingkat" select instead of drag & drop.
- Audiences are built by picking customers or importing CSV; label-based audiences are open (PRD question 6).
- COMING SOON integrations (Messenger, TikTok, Instagram, Telegram, Berdu, Order Online) are display-only.
- Receiving messages directly from Meta's WhatsApp webhook is not wired yet; use `/api/webhooks/incoming` or "Simulasi Pesan Masuk".
