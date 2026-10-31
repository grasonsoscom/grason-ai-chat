# GrasOn AI Chat

(Previously "Centris CRM"; `prd.md` and `CLAUDE.md` still use the old name.)

Full-stack implementation of the PRD in `prd.md`: Next.js 15 (App Router, Server Actions), Tailwind CSS 4, Prisma 6 + SQLite.

## Getting started

```bash
npm install
cp .env.example .env   # fill AUTH_SECRET, INCOMING_WEBHOOK_SECRET
npm run setup          # create database + seed sample data
npm run dev
```

Open http://localhost:3000 and sign in with email + password (test logins in `prisma/seed.ts`).

### Google sign-in

- Set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (Google Cloud Console → APIs & Services → Credentials → OAuth client, type Web application). Authorized redirect URI: `<APP_URL>/api/auth/google/callback`.
- There is no self sign-up: an admin adds the staff email in **Staff** (password optional). Signing in with a Google account whose verified email matches links it to that staff account; other Google accounts are refused.
- Changing a staff email in Staff unlinks the previous Google account.

### WhatsApp Hub (QR-linked numbers)

- **WhatsApp → WhatsApp Hub → + Scan QR WhatsApp** links a number as a device (`apiType` "WhatsApp Hub"), via [Baileys](https://github.com/WhiskeySockets/Baileys), an **unofficial** WhatsApp Web client that can break when WhatsApp changes its protocol. The session stays connected: inbound text messages go through `recordInbound` (AI agent included) and staff/AI/broadcast replies go out through that number (`src/lib/channel.ts`).
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

### Ongkir J&T (Excel)

- Import the J&T rate workbook in **Integrasi → Ekspedisi → Ongkir J&T**, or `npm run ongkir:import -- "path/to/file.xlsx"`. Importing replaces all stored rates.
- Sheet "J&T REG": kab/kota, kecamatan, then one flat per-package price column per warehouse (header row 2). Sheet "J&T CARGO": kab/kota, then per warehouse `0-10 KG` (flat up to 10 kg), per-kg tiers, and SLA (header rows 2–3). Excel turns SLA like "7-9" into dates; the importer reads them back.
- `src/lib/shipping.ts` scans the customer's latest messages for kecamatan / kab/kota names when they ask about shipping, and adds the matching rates to the AI prompt. Per destination the cheapest warehouse is used. Only J&T REG is offered; CARGO rates are imported but not given to the AI.
- COD pricing (`src/lib/promo.ts`): COD fee 3% of (package price + shipping); shipping subsidy (NC: Jawa up to 25.000, outside Jawa 25.000 if shipping >= 50.000 else 50%; RO: Jawa up to 30.000, outside Jawa up to 50.000; none for resellers) and a 5.000 COD admin subsidy apply only to COD orders whose package price + shipping reaches the minimum (120.000, resellers 200.000). The breakdown per package is computed in code and added to the AI prompt. Customer type is set in Pelanggan, or automatic: RO if the customer first chatted more than 7 days ago. Jawa vs outside Jawa comes from the province in the address.
- Short kecamatan names that are everyday words ("Baru", "Kamu") only match after "kec"/"kecamatan".

### OMS GRASON (leads, orders, verification, stock, prices)

Contract: **`docs/oms/cs-ai.v2.yaml`** (active, `/api/v2`); `docs/oms/cs-ai.v1.yaml` is kept as
reference and `docs/oms/V2-NOTES.md` records the delta. Every call goes through
`src/lib/oms/client.ts`; no other module calls the OMS API or touches its database.

- **Config**: `OMS_BASE_URL` (including `/api/v2`), `OMS_API_KEY`, `OMS_WEBHOOK_SECRET`. One key per
  environment; staging and production keys are different.
- **v2 totals**: `POST /orders` sends `total` plus `subsidi_ongkir`, `biaya_cod`,
  `subsidi_admin_cod`, and `segmen`. OMS re-checks the total against its active `/prices`; a mismatch
  returns `422 total_tidak_cocok`. The checkout form shows the same breakdown before submitting.
- **Lead lifecycle**: the first inbound message enqueues `POST /leads` with
  `external_id = conv_<conversationId>`. The first outgoing AI/staff/template message PATCHes
  `respon_pertama_at` + `direspon`; auto-follow-ups PATCH `follow_up`; switching a conversation to
  staff/escalation (or an RTS order) PATCHes `handover`. `closing` is never sent via PATCH — OMS fills
  it automatically when an order is created.
- **Catalog**: prices and stock come from `GET /prices` and `GET /stock`, cached for at most 5 minutes.
  AI prompts never contain a permanent SKU/price list; local product prices are omitted when OMS is on.
- **Checkout (staff-assisted)**: in **Pesan**, open a conversation → **Buat Order OMS**. Items use the
  OMS catalog and one `POST /orders` is sent. A mixed SSR/FHI checkout produces two orders; the buyer
  summary lists every order number and COD amount. Network failures keep the checkout in
  `OmsOutbox` and retry with the same `external_id`.
- **Verification**: **Verifikasi order** sends `POST /orders/{id}/verifikasi` with the exact OMS
  `nilai_cod` (0 for transfer). An RTS customer gets `422 perlu_verifikasi_manusia`; the conversation
  is escalated and handed over to staff.
- **Status updates**: `POST /api/webhooks/oms` verifies `X-Oms-Signature` (HMAC-SHA256 over
  `<X-Oms-Timestamp>.<raw body>`), dedupes `event_id`, and acknowledges immediately. Until OMS
  activates the webhook, `/api/cron/oms` polls open orders at most every 30 minutes.
- **Cron**: `GET /api/cron/oms` (Vercel Cron with `CRON_SECRET`) or `POST` with
  `x-webhook-secret`. It drains the outbox, retries unprocessed webhook events, and polls orders.
  For 15-minute polling, use an external scheduler.
- **Tests**: `npm test` (Vitest) covers request shapes, retries, error mapping, phone normalization,
  and webhook signatures using an OMS mock derived from the OpenAPI contract.
- **Manual smoke**: start `node scripts/oms-mock-server.mjs`, then run `scripts/oms-smoke.ts`
  (lead → mixed checkout → verification). `scripts/oms-webhook-smoke.ts` sends a signed
  `order.status_changed` event to a running app and checks the status update and customer follow-up.
- **Staging**: OMS currently holds dummy data. Do not send real customer phone numbers or addresses.

### RajaOngkir (cek ongkir)

Live domestic shipping costs from the RajaOngkir (Komerce) Shipping Cost API.

- **Config**: **Integrasi → Cek Ongkir RajaOngkir**. Paste the Shipping Cost API key, search and pick the
  warehouse origin (subdistrict), choose a default courier code (`jne`, `jnt`, `sicepat`, …), and set the
  default package weight in grams. The key is stored encrypted (same AES-256-GCM box as the AI key).
  `RAJAONGKIR_*` environment variables are only a fallback.
- **Cek Ongkir page** (`/ongkir`): search a destination by kecamatan/kota/kode pos, enter weight and courier,
  and see every service with cost and ETD.
- **Checkout**: in **Pesan → Buat Order OMS**, the Ongkir field has **Cek ongkir (RajaOngkir)**. It pre-fills
  the destination from the address fields; picking a service fills `ongkir`, which then feeds the COD quote
  and the OMS `total`.
- **API**: `POST /api/rajaongkir/destinations` (session required) and `POST /api/rajaongkir/cost`.
  The AI Agent still answers from the J&T Excel rates; RajaOngkir is used by staff-facing screens.
- **Docs**: <https://rajaongkir.com/docs/shipping-cost/getting_started/endpoint>.

### AI order automation

**AI Agent → Perilaku AI → Order Otomatis** lets the agent run the whole order flow:

1. Extract products, recipient, address, and payment method from the conversation. Product names are
   mapped to the live OMS catalog SKUs.
2. Quote shipping with RajaOngkir (J&T Excel as fallback) and calculate the COD breakdown with the same
   `orderQuote` rules as the staff checkout.
3. Ask the customer to confirm the exact total. An order is created only after an explicit yes following
   a message that contains the total, so a stray "ok" cannot create an order.
4. Create the OMS checkout with `createdByAi`, send the buyer summary, and optionally auto-verify the COD
   with `POST /orders/{id}/verifikasi`. Orders flagged `perlu_verifikasi_manusia` are never auto-verified.
5. A second identical confirmation within 10 minutes is treated as a retry, not a new order. Stock and
   price are re-checked against OMS before sending.

Requirements: OMS configured, AI provider configured, and either RajaOngkir configured or J&T rates
imported. Auto-order is off by default per agent; auto-verify is an additional separate toggle.
Use these toggles on staging first: auto-verify removes the staff confirmation step.

- **Smoke test**: `scripts/ai-order-smoke.ts` runs three turns (product → address → "ya") against the OMS
  mock and a scripted OpenAI-compatible mock (`scripts/ai-mock-server.mjs`), then asserts that the order was
  created and auto-verified.

## Developer API (REST v1)

- **Tokens**: Admin → **Developer → API Tokens**. Plaintext tokens are shown once and stored only as
  SHA-256 hashes. Format: `gro_<prefix>_<secret>`; send
  `Authorization: Bearer <token>` (or `X-Api-Key`).
- **Base URL**: `<APP_URL>/api/v1` (set `APP_URL` in production; docs fall back to localhost).
- **Scopes**: `*`, `contacts:read/write`, `conversations:read`, `messages:write`,
  `campaigns:read/write`, `webhooks:write`, `ai:read/write`, `analytics:read`, `wallet:read`.
- **Endpoints**: `/me`, `/tokens`, `/contacts`, `/segments`, `/campaigns`, `/messages/send`,
  `/conversations`, `/webhooks`, `/ai/chatbots`, `/wallet`, `/analytics/summary`. Lists use
  `?page=` and return `meta.current_page/last_page/total` plus `links.next`.
- **Rate limits**: 60 requests/minute per token, in-memory per server instance. HTTP 429 includes
  `Retry-After`.
- **Campaigns** map to the existing Broadcast module. A campaign stores `template_ids` (not free
  text); launch is synchronous and supports pause between recipients. Contacts with
  `opt_in_whatsapp = false` are skipped.
- **Outbound webhooks**: **Developer → Webhooks**. Each delivery is a JSON POST with
  `X-Webhook-Event` and `X-Webhook-Signature: t=<unix>,v1=<hmac>` (HMAC-SHA256 of
  `t + "." + raw body` with the endpoint secret). Deliveries are logged on the page; automatic
  retries are not implemented yet.
- **Docs**: `/developer/api-docs` (all staff) and `/api/v1/openapi.json` (public).
- **Not available yet**: social publishing, automations, mobile agent endpoints, rule-based
  segments, and a media library. The workspace is single-tenant: every token sees the same data.

## Deploying to Vercel

Local dev stays on SQLite; Vercel uses PostgreSQL. `npm run vercel-build` (set in `vercel.json`) writes `prisma/postgres.prisma` from `schema.prisma` with a `postgresql` datasource, runs `prisma db push` and the seed, then `next build`.

- **Database**: add Neon (Storage / Marketplace) to the project; it sets `DATABASE_URL` and `DATABASE_URL_UNPOOLED`. `db push` refuses destructive changes, so a schema change that drops data fails the build instead of deleting it.
- **Images**: connect a Vercel Blob store (`BLOB_READ_WRITE_TOKEN`). Product images are stored there as public URLs; uploads are refused on Vercel without it.
- **Seed**: the first build creates the sample data and `admin@centris.test` with `SEED_ADMIN_PASSWORD` (required on Vercel). The demo account is not created on Vercel.
- **WhatsApp Hub is off on Vercel** (`src/lib/runtime.ts`): they need a long-running process. Use the Cloud API; webhook URL `https://<domain>/api/webhooks/whatsapp`.
- **Follow-ups**: Vercel Cron calls `GET /api/cron/followup` once a day (Hobby limit) with `CRON_SECRET`. For every 15 minutes, use an external scheduler with `POST` + `x-webhook-secret`.
- **Ongkir**: upload the J&T Excel again in Integrasi after the first deploy.
- Search in Pesan/Pelanggan is case-sensitive on PostgreSQL.

## Optional configuration (`.env`)

| Variable | Purpose |
|---|---|
| `AI_PROVIDER`, `OPENAI_BASE_URL`, `OPENAI_MODEL`, `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | Fallback AI configuration. The same values can be set in **Integrasi → AI / LLM**; settings saved there win over `.env` and the API key is stored encrypted (AES-256-GCM keyed by `AUTH_SECRET`). |
| `ANTHROPIC_API_KEY` | Fallback Claude key for AI Agent replies and AI Response Test (model `claude-opus-5-5`). Without a key in `.env` or Integrasi, AI shows a "belum dikonfigurasi" note. |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp Cloud API sending. Without them, outgoing messages are stored as `simulated`. |
| `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET` | Cloud API webhook verification and signature check. Without the app secret, the webhook rejects every POST. |
| `INCOMING_WEBHOOK_SECRET` | Required header `x-webhook-secret` for `POST /api/webhooks/incoming` and `POST /api/cron/followup`. |
| `OMS_BASE_URL`, `OMS_API_KEY` | OMS GRASON API base URL (including `/api/v2`) and API key. Without them, OMS features show as not configured. |
| `OMS_WEBHOOK_SECRET` | Verifies `X-Oms-Signature` on `POST /api/webhooks/oms`. |
| `RAJAONGKIR_API_KEY`, `RAJAONGKIR_ORIGIN_ID`, `RAJAONGKIR_ORIGIN_LABEL`, `RAJAONGKIR_COURIER`, `RAJAONGKIR_WEIGHT` | Fallback RajaOngkir settings. Configure them in **Integrasi → Cek Ongkir RajaOngkir** instead; web settings override env. |
| `COIN_COST_AI_REPLY`, `COIN_COST_BROADCAST_MESSAGE` | Coin cost per action. **TBD**, default 0. Balance is checked before the action runs whenever cost > 0. |

## Structure

- `prisma/schema.prisma`: data model (account and coins, staff/roles/groups, devices/templates, customers/conversations/messages, products, funnels/labels, audiences, broadcasts, AI agents, calendar).
- `src/lib/`: domain logic (`messaging.ts` inbound/AI/24h window/follow-up, `ai.ts` Claude prompt, `coins.ts`, `funnel.ts` renumbering, `whatsapp.ts`, `webhook.ts`, `uploads.ts`).
- `src/lib/oms/`: OMS client, catalog cache, lead lifecycle, durable outbox, checkout/verification, and webhook processing.
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
