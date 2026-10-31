import type { Prisma } from "@prisma/client";
import { authenticateApiToken } from "@/lib/api/auth";
import {
  handleApi,
  noContent,
  notFound,
  ok,
  optionalBoolean,
  pathId,
  readJson,
  requiredInteger,
  requiredString,
  validationError,
} from "@/lib/api/http";
import { toE164 } from "@/lib/api/phone";
import { contactJson } from "@/lib/api/serializers";
import { db } from "@/lib/db";
import { emitWebhook } from "@/lib/webhook";

const contactInclude = { labels: true, stage: true } satisfies Prisma.CustomerInclude;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleApi(async () => {
    await authenticateApiToken(req, "contacts:read");
    const id = pathId((await params).id);
    const contact = await db.customer.findUnique({ where: { id }, include: contactInclude });
    if (!contact) throw notFound("Contact not found.");
    return ok(contactJson(contact));
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleApi(async () => {
    await authenticateApiToken(req, "contacts:write");
    const id = pathId((await params).id);
    const existing = await db.customer.findUnique({ where: { id } });
    if (!existing) throw notFound("Contact not found.");

    const body = await readJson<Record<string, unknown>>(req);
    const data: Prisma.CustomerUpdateInput = {};

    if (body.first_name !== undefined || body.name !== undefined) {
      data.name = requiredString(body.first_name ?? body.name, "name");
    }
    if (body.phone_e164 !== undefined || body.phone !== undefined) {
      data.phone = toE164(requiredString(body.phone_e164 ?? body.phone, "phone_e164"));
    }
    if (body.email !== undefined) {
      data.email = typeof body.email === "string" ? body.email.trim() : "";
    }
    if (body.notes !== undefined) {
      data.notes = typeof body.notes === "string" ? body.notes.trim() : "";
    }
    if (body.opt_in_whatsapp !== undefined) {
      data.optInWhatsapp = optionalBoolean(body.opt_in_whatsapp, "opt_in_whatsapp") ?? existing.optInWhatsapp;
    }
    if (body.stage_id !== undefined) {
      data.stage =
        body.stage_id === null
          ? { disconnect: true }
          : { connect: { id: requiredInteger(body.stage_id, "stage_id") } };
    }
    if (body.label_ids !== undefined) {
      if (!Array.isArray(body.label_ids)) throw validationError({ label_ids: ["label_ids harus array."] });
      const ids = [...new Set(body.label_ids.map(Number).filter((value) => Number.isInteger(value) && value > 0))];
      data.labels = { set: ids.map((labelId) => ({ id: labelId })) };
    }

    const contact = await db.customer.update({ where: { id }, data, include: contactInclude });
    await emitWebhook("contact.updated", {
      contact: { id: contact.id, name: contact.name, phone: contact.phone, email: contact.email },
    });
    return ok(contactJson(contact));
  });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleApi(async () => {
    await authenticateApiToken(req, "contacts:write");
    const id = pathId((await params).id);
    const contact = await db.customer.findUnique({ where: { id }, select: { id: true } });
    if (!contact) throw notFound("Contact not found.");
    await db.customer.delete({ where: { id } });
    return noContent();
  });
}
