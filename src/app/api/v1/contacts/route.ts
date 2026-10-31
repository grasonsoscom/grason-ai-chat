import type { Prisma } from "@prisma/client";
import { authenticateApiToken } from "@/lib/api/auth";
import {
  created,
  handleApi,
  ok,
  optionalBoolean,
  optionalInteger,
  optionalString,
  readJson,
  requiredString,
  validationError,
} from "@/lib/api/http";
import { buildLinks, buildMeta, parsePagination } from "@/lib/api/pagination";
import { toE164 } from "@/lib/api/phone";
import { contactJson } from "@/lib/api/serializers";
import { db } from "@/lib/db";
import { emitWebhook } from "@/lib/webhook";

const contactInclude = { labels: true, stage: true } satisfies Prisma.CustomerInclude;

export async function GET(req: Request) {
  return handleApi(async () => {
    await authenticateApiToken(req, "contacts:read");
    const url = new URL(req.url);
    const pagination = parsePagination(url.searchParams, 25);
    const q = (url.searchParams.get("q") ?? "").trim();
    const where: Prisma.CustomerWhereInput = q
      ? {
          OR: [
            { name: { contains: q } },
            { phone: { contains: q } },
            { email: { contains: q } },
          ],
        }
      : {};

    const [total, contacts] = await Promise.all([
      db.customer.count({ where }),
      db.customer.findMany({
        where,
        include: contactInclude,
        orderBy: { createdAt: "desc" },
        skip: pagination.skip,
        take: pagination.take,
      }),
    ]);

    return ok(
      contacts.map(contactJson),
      buildMeta(total, pagination),
      buildLinks(req, pagination, total),
    );
  });
}

export async function POST(req: Request) {
  return handleApi(async () => {
    await authenticateApiToken(req, "contacts:write");
    const body = await readJson<Record<string, unknown>>(req);

    const phone = toE164(requiredString(body.phone_e164 ?? body.phone, "phone_e164"));
    const rawName = body.first_name ?? body.name;
    const name = typeof rawName === "string" && rawName.trim() ? rawName.trim() : phone;
    const email = optionalString(body.email) ?? "";
    const notes = optionalString(body.notes) ?? "";
    const optInWhatsapp = optionalBoolean(body.opt_in_whatsapp, "opt_in_whatsapp") ?? true;
    const stageId = optionalInteger(body.stage_id, "stage_id") ?? null;
    const labelIds = Array.isArray(body.label_ids)
      ? [...new Set(body.label_ids.map(Number).filter((id) => Number.isInteger(id) && id > 0))]
      : [];

    const existing = await db.customer.findUnique({ where: { phone }, select: { id: true } });
    if (existing) {
      throw validationError({ phone_e164: ["Nomor sudah terdaftar."] }, "Contact already exists.");
    }

    const contact = await db.customer.create({
      data: {
        name,
        phone,
        email,
        notes,
        optInWhatsapp,
        ...(stageId ? { stage: { connect: { id: stageId } } } : {}),
        ...(labelIds.length ? { labels: { connect: labelIds.map((id) => ({ id })) } } : {}),
      },
      include: contactInclude,
    });

    await emitWebhook("contact.created", {
      contact: { id: contact.id, name: contact.name, phone: contact.phone, email: contact.email },
    });

    return created(contactJson(contact));
  });
}
