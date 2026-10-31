// Single source of truth for the Developer API documentation and OpenAPI spec.
import { SCOPES } from "./scopes";
import { WEBHOOK_EVENTS } from "../webhooks/events";

export type ApiMethod = "GET" | "POST" | "PATCH" | "DELETE";

export type ApiEndpointDoc = {
  method: ApiMethod;
  path: string;
  scope?: string;
  summary: string;
  description?: string;
  request?: unknown;
  response?: unknown;
};

export type ApiGroupDoc = {
  key: string;
  title: string;
  description: string;
  endpoints: ApiEndpointDoc[];
};

export const API_BASE_PATH = "/api/v1";

export const API_GROUPS: ApiGroupDoc[] = [
  {
    key: "auth",
    title: "Authentication",
    description: "Every request carries a personal access token as a bearer token.",
    endpoints: [
      { method: "GET", path: "/me", summary: "Return the user the token belongs to." },
      { method: "GET", path: "/tokens", scope: "*", summary: "List personal access tokens." },
      {
        method: "POST",
        path: "/tokens",
        scope: "*",
        summary: "Create a personal access token.",
        request: { name: "Zapier", scopes: ["contacts:read"], expires_at: "2027-01-01T00:00:00.000Z" },
        response: { data: { id: 3, name: "Zapier", prefix: "a1b2c3d4", scopes: "contacts:read", token: "gro_a1b2c3d4_…" } },
      },
      { method: "DELETE", path: "/tokens/{tokenId}", scope: "*", summary: "Revoke a personal access token." },
    ],
  },
  {
    key: "contacts",
    title: "Contacts",
    description: "Create, read, update and delete the contacts in the workspace.",
    endpoints: [
      { method: "GET", path: "/contacts", scope: "contacts:read", summary: "List contacts, newest first." },
      {
        method: "POST",
        path: "/contacts",
        scope: "contacts:write",
        summary: "Create a contact.",
        request: {
          phone_e164: "+6281234567890",
          first_name: "Ibu Sari",
          email: "sari@example.com",
          opt_in_whatsapp: true,
        },
        response: {
          data: {
            id: 42,
            phone: "+6281234567890",
            name: "Ibu Sari",
            email: "sari@example.com",
            opt_in_whatsapp: true,
            labels: [],
          },
        },
      },
      { method: "GET", path: "/contacts/{id}", scope: "contacts:read", summary: "Retrieve a contact." },
      { method: "PATCH", path: "/contacts/{id}", scope: "contacts:write", summary: "Update a contact." },
      { method: "DELETE", path: "/contacts/{id}", scope: "contacts:write", summary: "Delete a contact and its conversation." },
    ],
  },
  {
    key: "segments",
    title: "Segments",
    description: "Group contacts into static lists (audiences) for campaigns.",
    endpoints: [
      { method: "GET", path: "/segments", scope: "contacts:read", summary: "List segments, newest first." },
      {
        method: "POST",
        path: "/segments",
        scope: "contacts:write",
        summary: "Create a static segment.",
        request: { name: "Pelanggan Bandung", contact_ids: [42, 43] },
        response: { data: { id: 7, name: "Pelanggan Bandung", contact_count: 2 } },
      },
      { method: "GET", path: "/segments/{id}/contacts", scope: "contacts:read", summary: "List the contacts in a segment." },
    ],
  },
  {
    key: "campaigns",
    title: "Campaigns",
    description: "Create broadcast campaigns, launch or pause them, and read delivery results.",
    endpoints: [
      { method: "GET", path: "/campaigns", scope: "campaigns:read", summary: "List campaigns, newest first." },
      {
        method: "POST",
        path: "/campaigns",
        scope: "campaigns:write",
        summary: "Create a draft campaign.",
        request: { name: "Promo Oktober", device_id: 1, audience_id: 7, template_ids: [3], type: "Single" },
        response: {
          data: {
            id: 12,
            name: "Promo Oktober",
            status: "Draft",
            template_ids: [3],
            audience_id: 7,
            sent_count: 0,
          },
        },
      },
      { method: "GET", path: "/campaigns/{id}", scope: "campaigns:read", summary: "Retrieve a campaign with delivery stats." },
      { method: "PATCH", path: "/campaigns/{id}", scope: "campaigns:write", summary: "Update a draft campaign." },
      { method: "POST", path: "/campaigns/{id}/launch", scope: "campaigns:write", summary: "Launch a draft or paused campaign." },
      { method: "POST", path: "/campaigns/{id}/pause", scope: "campaigns:write", summary: "Pause a campaign that is sending." },
      { method: "GET", path: "/campaigns/{id}/recipients", scope: "campaigns:read", summary: "List a campaign's recipients and statuses." },
    ],
  },
  {
    key: "messages",
    title: "Messages",
    description: "Send a one-off WhatsApp message to a contact you already have.",
    endpoints: [
      {
        method: "POST",
        path: "/messages/send",
        scope: "messages:write",
        summary: "Send a message to a contact.",
        request: { contact_id: 42, channel: "whatsapp", body: "Halo dari API!" },
        response: { data: { id: 901, direction: "out", sender: "staff", body: "Halo dari API!", status: "simulated" } },
      },
    ],
  },
  {
    key: "conversations",
    title: "Conversations",
    description: "Read inbox conversations and the messages inside them.",
    endpoints: [
      { method: "GET", path: "/conversations", scope: "conversations:read", summary: "List conversations, most recent activity first." },
      { method: "GET", path: "/conversations/{id}/messages", scope: "conversations:read", summary: "List the messages in a conversation, oldest first." },
    ],
  },
  {
    key: "webhooks",
    title: "Outbound Webhooks",
    description: "Register HTTPS endpoints that receive signed event notifications.",
    endpoints: [
      { method: "GET", path: "/webhooks", scope: "webhooks:write", summary: "List your webhook endpoints." },
      {
        method: "POST",
        path: "/webhooks",
        scope: "webhooks:write",
        summary: "Register a webhook endpoint. The secret is returned once.",
        request: { name: "CRM sync", url: "https://example.com/webhooks", events: ["contact.created"] },
        response: { data: { id: 2, name: "CRM sync", url: "https://example.com/webhooks", secret: "whsec_…" } },
      },
      { method: "DELETE", path: "/webhooks/{id}", scope: "webhooks:write", summary: "Remove a webhook endpoint." },
    ],
  },
  {
    key: "ai",
    title: "AI — Chatbots",
    description: "List your chatbots and ask one a question from your own app.",
    endpoints: [
      { method: "GET", path: "/ai/chatbots", scope: "ai:read", summary: "List chatbots." },
      {
        method: "POST",
        path: "/ai/chatbots/{id}/chat",
        scope: "ai:write",
        summary: "Send a message to a chatbot and get its reply.",
        request: { message: "Apakah produk ini ada stok?", history: [] },
        response: { data: { reply: "Boleh saya cek dulu ke tim?" } },
      },
    ],
  },
  {
    key: "wallet",
    title: "Wallet",
    description: "Read the workspace coin balance and its ledger.",
    endpoints: [
      { method: "GET", path: "/wallet", scope: "wallet:read", summary: "Get the wallet balance." },
      { method: "GET", path: "/wallet/transactions", scope: "wallet:read", summary: "List wallet transactions, newest first." },
    ],
  },
  {
    key: "analytics",
    title: "Analytics",
    description: "Read aggregate counts for the workspace.",
    endpoints: [
      { method: "GET", path: "/analytics/summary", scope: "analytics:read", summary: "Return contact, conversation, message and campaign counts." },
    ],
  },
];

export const QUICKSTART = [
  {
    title: "1. Authenticate",
    curl: `curl -H "Authorization: Bearer <your_token>" \\\n     -H "Accept: application/json" \\\n     {base_url}/me`,
  },
  {
    title: "2. Create a contact",
    curl: `curl -X POST \\\n     -H "Authorization: Bearer <your_token>" \\\n     -H "Accept: application/json" \\\n     -H "Content-Type: application/json" \\\n     -d '{"phone_e164":"+6281234567890","first_name":"Ibu Sari","opt_in_whatsapp":true}' \\\n     {base_url}/contacts`,
  },
  {
    title: "3. Send a message",
    curl: `curl -X POST \\\n     -H "Authorization: Bearer <your_token>" \\\n     -H "Accept: application/json" \\\n     -H "Content-Type: application/json" \\\n     -d '{"contact_id":42,"channel":"whatsapp","body":"Halo dari API!"}' \\\n     {base_url}/messages/send`,
  },
  {
    title: "4. Subscribe to a webhook",
    curl: `curl -X POST \\\n     -H "Authorization: Bearer <your_token>" \\\n     -H "Accept: application/json" \\\n     -H "Content-Type: application/json" \\\n     -d '{"name":"CRM sync","url":"https://yourapp.com/webhook","events":["contact.created","campaign.completed"]}' \\\n     {base_url}/webhooks`,
  },
];

export const ERROR_REFERENCE = [
  { status: 401, meaning: "Token missing, revoked or expired.", body: { message: "Unauthenticated." } },
  { status: 403, meaning: "Token lacks the required scope.", body: { error: "Forbidden. This token does not have the required scope.", required_scope: "contacts:write" } },
  { status: 404, meaning: "Resource not found in the workspace.", body: { error: "Contact not found." } },
  { status: 422, meaning: "Validation failed.", body: { message: "The given data was invalid.", errors: { phone_e164: ["Format nomor tidak valid."] } } },
  { status: 429, meaning: "Rate limit exceeded (60 requests/minute).", body: { message: "Too Many Attempts." } },
];

export function apiBaseUrl(): string {
  const configured = process.env.APP_URL?.trim().replace(/\/+$/, "");
  return `${configured || "http://localhost:3000"}${API_BASE_PATH}`;
}

export function openApiDocument(baseUrl: string) {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const group of API_GROUPS) {
    for (const endpoint of group.endpoints) {
      const path = endpoint.path;
      paths[path] ??= {};
      const operation: Record<string, unknown> = {
        tags: [group.title],
        summary: endpoint.summary,
        description: endpoint.description ?? endpoint.summary,
        security: [{ bearerAuth: [] }],
        responses: {
          "200": { description: "Successful response" },
          "401": { description: "Unauthenticated" },
          "403": { description: "Missing scope" },
          "422": { description: "Validation failed" },
          "429": { description: "Too Many Attempts" },
        },
        ...(endpoint.scope
          ? { "x-required-scope": endpoint.scope }
          : {}),
        ...(endpoint.request
          ? {
              requestBody: {
                required: true,
                content: {
                  "application/json": {
                    schema: { type: "object" },
                    example: endpoint.request,
                  },
                },
              },
            }
          : {}),
      };
      paths[path][endpoint.method.toLowerCase()] = operation;
    }
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "GrasOn AI Chat REST API",
      version: "1.0.0",
      description:
        "Personal access token API for contacts, segments, campaigns, messages, conversations, webhooks, AI chatbots, wallet and analytics.",
    },
    servers: [{ url: baseUrl }],
    security: [{ bearerAuth: [] }],
    tags: API_GROUPS.map((group) => ({ name: group.title, description: group.description })),
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer" },
      },
    },
  };
}

export const API_SCOPE_REFERENCE = SCOPES;
export const API_EVENT_REFERENCE = WEBHOOK_EVENTS;
