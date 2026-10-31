import { authenticateApiToken } from "@/lib/api/auth";
import {
  ApiError,
  created,
  handleApi,
  notFound,
  readJson,
  requiredInteger,
  requiredString,
  validationError,
} from "@/lib/api/http";
import { messageJson } from "@/lib/api/serializers";
import { db } from "@/lib/db";
import { deliver } from "@/lib/outbound";
import { insideServiceWindow } from "@/lib/whatsapp";

export async function POST(req: Request) {
  return handleApi(async () => {
    await authenticateApiToken(req, "messages:write");
    const body = await readJson<Record<string, unknown>>(req);

    const contactId = requiredInteger(body.contact_id, "contact_id");
    const channel = requiredString(body.channel, "channel");
    if (channel !== "whatsapp") {
      throw validationError({ channel: ["Channel yang didukung hanya \"whatsapp\"."] });
    }
    const text = requiredString(body.body, "body");
    if (text.length > 4096) throw validationError({ body: ["Pesan maksimal 4096 karakter."] });

    const customer = await db.customer.findUnique({
      where: { id: contactId },
      include: { conversation: true },
    });
    if (!customer) throw notFound("Contact not found.");
    if (!customer.conversation) {
      throw new ApiError(422, {
        message: "Contact belum punya percakapan. Pesan hanya bisa dikirim setelah ada pesan masuk.",
      });
    }

    const conversation = customer.conversation;
    if (!insideServiceWindow(conversation.lastInboundAt)) {
      throw new ApiError(422, {
        message: "Di luar jendela 24 jam. Gunakan campaign/template untuk memulai ulang percakapan.",
      });
    }

    const result = await deliver(conversation.id, text, "staff");
    if (result.status === "failed") {
      throw new ApiError(502, { error: result.error ?? "Gagal mengirim pesan." });
    }

    const message = result.messageId
      ? await db.message.findUnique({ where: { id: result.messageId } })
      : null;

    return created(
      message
        ? messageJson(message)
        : {
            direction: "out",
            sender: "staff",
            body: text,
            status: result.status,
            external_id: result.externalId ?? null,
          },
    );
  });
}
