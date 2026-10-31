"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { required, run, str, type ActionState } from "@/lib/action";
import { WEBHOOK_EVENT_KEYS } from "@/lib/webhooks/events";
import { sendTestWebhook } from "@/lib/webhooks/dispatch";
import { generateWebhookSecret } from "@/lib/webhooks/signature";
import { assertSafeWebhookUrl } from "@/lib/webhooks/url-guard";

const SUBSCRIBABLE = new Set(WEBHOOK_EVENT_KEYS.filter((event) => event !== "test.ping"));

// Throws a user-facing message for invalid or internal (SSRF) URLs.
const parseUrl = assertSafeWebhookUrl;

function parseEvents(fd: FormData): string[] {
  return [...new Set(fd.getAll("events").map(String).filter((event) => SUBSCRIBABLE.has(event)))];
}

export async function createWebhook(_: ActionState, fd: FormData) {
  return run(async () => {
    const user = await requireAdmin();
    const name = required(fd, "name", "Nama webhook");
    const url = await parseUrl(required(fd, "url", "URL webhook"));
    const description = str(fd, "description");
    const events = parseEvents(fd);
    const enabled = fd.get("enabled") === "on";
    const secret = generateWebhookSecret();

    await db.webhookEndpoint.create({
      data: {
        name,
        url,
        secret,
        events: events.join(","),
        description,
        enabled,
        createdById: user.id,
      },
    });
    revalidatePath("/developer/webhooks");
    // Returned once; the UI shows a copy panel.
    return secret;
  });
}

export async function updateWebhook(_: ActionState, fd: FormData) {
  return run(async () => {
    await requireAdmin();
    const id = Number(fd.get("id"));
    const existing = await db.webhookEndpoint.findUnique({ where: { id } });
    if (!existing) throw new Error("Webhook tidak ditemukan.");
    const name = required(fd, "name", "Nama webhook");
    const url = await parseUrl(required(fd, "url", "URL webhook"));
    const description = str(fd, "description");
    const events = parseEvents(fd);
    const enabled = fd.get("enabled") === "on";

    await db.webhookEndpoint.update({
      where: { id },
      data: { name, url, description, events: events.join(","), enabled },
    });
    revalidatePath("/developer/webhooks");
    return "Webhook diperbarui.";
  });
}

export async function toggleWebhook(_: ActionState, fd: FormData) {
  return run(async () => {
    await requireAdmin();
    const id = Number(fd.get("id"));
    const endpoint = await db.webhookEndpoint.findUnique({ where: { id } });
    if (!endpoint) throw new Error("Webhook tidak ditemukan.");
    await db.webhookEndpoint.update({ where: { id }, data: { enabled: !endpoint.enabled } });
    revalidatePath("/developer/webhooks");
    return endpoint.enabled ? "Webhook dinonaktifkan." : "Webhook diaktifkan.";
  });
}

export async function deleteWebhook(_: ActionState, fd: FormData) {
  return run(async () => {
    await requireAdmin();
    await db.webhookEndpoint.delete({ where: { id: Number(fd.get("id")) } });
    revalidatePath("/developer/webhooks");
    return "Webhook dihapus.";
  });
}

export async function testWebhook(_: ActionState, fd: FormData) {
  return run(async () => {
    await requireAdmin();
    const result = await sendTestWebhook(Number(fd.get("id")));
    revalidatePath("/developer/webhooks");
    return result.success
      ? `Tes terkirim (HTTP ${result.statusCode ?? "-"}).`
      : `Tes gagal: ${result.error ?? "tidak diketahui"}.`;
  });
}
