import { authenticateApiToken } from "@/lib/api/auth";
import {
  created,
  handleApi,
  ok,
  optionalBoolean,
  optionalString,
  readJson,
  requiredString,
  validationError,
} from "@/lib/api/http";
import { webhookJson } from "@/lib/api/serializers";
import { db } from "@/lib/db";
import { WEBHOOK_EVENTS } from "@/lib/webhooks/events";
import { generateWebhookSecret } from "@/lib/webhooks/signature";
import { assertSafeWebhookUrl, UnsafeWebhookUrlError } from "@/lib/webhooks/url-guard";

const SUBSCRIBABLE = new Set(
  WEBHOOK_EVENTS.filter((event) => event.subscribable).map((event) => event.key),
);

async function validateUrl(raw: string): Promise<string> {
  try {
    return await assertSafeWebhookUrl(raw);
  } catch (e) {
    if (e instanceof UnsafeWebhookUrlError) throw validationError({ url: [e.message] });
    throw e;
  }
}

export async function GET(req: Request) {
  return handleApi(async () => {
    await authenticateApiToken(req, "webhooks:write");
    const endpoints = await db.webhookEndpoint.findMany({ orderBy: { createdAt: "desc" } });
    return ok(endpoints.map((endpoint) => webhookJson(endpoint)));
  });
}

export async function POST(req: Request) {
  return handleApi(async () => {
    const auth = await authenticateApiToken(req, "webhooks:write");
    const body = await readJson<Record<string, unknown>>(req);
    const name = requiredString(body.name, "name");
    const url = await validateUrl(requiredString(body.url, "url"));
    const description = optionalString(body.description) ?? "";
    const enabled = optionalBoolean(body.enabled, "enabled") ?? true;

    if (body.events !== undefined && !Array.isArray(body.events)) {
      throw validationError({ events: ["events harus berupa array."] });
    }
    const events = Array.isArray(body.events)
      ? [...new Set(body.events.map(String).filter((event) => SUBSCRIBABLE.has(event)))]
      : [];

    const endpoint = await db.webhookEndpoint.create({
      data: {
        name,
        url,
        description,
        enabled,
        events: events.join(","),
        secret: generateWebhookSecret(),
        createdById: auth.user.id,
      },
    });

    return created(webhookJson(endpoint, true));
  });
}
