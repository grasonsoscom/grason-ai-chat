import { afterEach, describe, expect, it, vi } from "vitest";
import { checkMedia, mediaPrompt, sniffMedia, splitMediaTags } from "@/lib/media";
import { sendMedia } from "@/lib/whatsapp";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const mp4 = (brand: string) => Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from(`ftyp${brand}`, "latin1"), Buffer.alloc(8)]);
const ukuran = (buf: Buffer, size: number) => Buffer.concat([buf, Buffer.alloc(size - buf.length)]);

describe("testimonial media files", () => {
  it("recognises JPEG, PNG and MP4 from content, not the name", () => {
    expect(sniffMedia(JPEG)).toEqual({ mimeType: "image/jpeg", kind: "image" });
    expect(sniffMedia(PNG)).toEqual({ mimeType: "image/png", kind: "image" });
    expect(sniffMedia(mp4("isom"))).toEqual({ mimeType: "video/mp4", kind: "video" });
    expect(sniffMedia(mp4("qt  "))).toBeNull(); // QuickTime .mov is not accepted by WhatsApp
    expect(sniffMedia(Buffer.from("GIF89a....."))).toBeNull();
  });

  it("enforces 2 MB for photos and 16 MB for videos", () => {
    expect(() => checkMedia("a.jpg", ukuran(JPEG, 2 * 1024 * 1024))).not.toThrow();
    expect(() => checkMedia("a.jpg", ukuran(JPEG, 2 * 1024 * 1024 + 1))).toThrow("2 MB");
    expect(() => checkMedia("v.mp4", ukuran(mp4("mp42"), 16 * 1024 * 1024))).not.toThrow();
    expect(() => checkMedia("v.mp4", ukuran(mp4("mp42"), 16 * 1024 * 1024 + 1))).toThrow("16 MB");
    expect(() => checkMedia("x.pdf", Buffer.from("%PDF-1.7"))).toThrow("bukan foto JPEG/PNG atau video MP4");
  });
});

describe("media tags in AI replies", () => {
  it("removes every tag, keeps allowed ids once, at most two", () => {
    const r = splitMediaTags("Ini testimoninya kak 😊\n[[media:3]] [[ media : 5 ]]\n[[media:3]] [[media:9]] [[media:7]]", [3, 5, 7]);
    expect(r).toEqual({ text: "Ini testimoninya kak 😊", ids: [3, 5] });
  });

  it("drops unknown or inactive media without leaving the code in the text", () => {
    expect(splitMediaTags("Cek ya kak [[media:42]]", [1])).toEqual({ text: "Cek ya kak", ids: [] });
    expect(splitMediaTags("[[media:1]]", [1])).toEqual({ text: "", ids: [1] });
    expect(splitMediaTags("Halo kak, ada yang bisa dibantu?", [1])).toEqual({ text: "Halo kak, ada yang bisa dibantu?", ids: [] });
  });

  it("lists available media for the AI, or nothing when there is none", () => {
    expect(mediaPrompt([])).toBeNull();
    const p = mediaPrompt([
      { id: 4, title: "Testimoni Bio Serea", kind: "image", usage: "tanya hasil pemakaian", product: "Bio Serea" },
      { id: 6, title: "Unboxing", kind: "video", usage: "" },
    ])!;
    expect(p).toContain('- [[media:4]] Foto "Testimoni Bio Serea" (produk: Bio Serea) – kirim bila: tanya hasil pemakaian');
    expect(p).toContain('- [[media:6]] Video "Unboxing"');
    expect(p).toContain("Paling banyak 2 media per balasan");
    expect(p).toContain("Jangan mengarang testimoni");
  });
});

describe("sending media over the Cloud API", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("uploads the file to Meta, then sends it by media id with the caption", async () => {
    vi.stubEnv("WHATSAPP_TOKEN", "token-uji");
    const calls: { url: string; body: unknown }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, body: init.body });
      if (url.endsWith("/media")) return new Response(JSON.stringify({ id: "MEDIA-1" }), { status: 200 });
      return new Response(JSON.stringify({ messages: [{ id: "wamid.X" }] }), { status: 200 });
    });
    const r = await sendMedia("62 811-0000-0000", { kind: "video", data: mp4("isom"), mimeType: "video/mp4", fileName: "video.mp4", caption: " Hasil 2 minggu " }, "PNID");
    expect(r).toEqual({ status: "sent", externalId: "wamid.X" });
    expect(calls[0]!.url).toContain("/PNID/media");
    expect(calls[0]!.body).toBeInstanceOf(FormData);
    expect(JSON.parse(calls[1]!.body as string)).toEqual({
      messaging_product: "whatsapp",
      to: "6281100000000",
      type: "video",
      video: { id: "MEDIA-1", caption: "Hasil 2 minggu" },
    });
  });

  it("reports a failed upload and is simulated without a token", async () => {
    vi.stubEnv("WHATSAPP_TOKEN", "token-uji");
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: { message: "file too large", code: 131053 } }), { status: 400 }));
    const gagal = await sendMedia("628110000", { kind: "image", data: JPEG, mimeType: "image/jpeg", fileName: "foto.jpg" }, "PNID");
    expect(gagal.status).toBe("failed");
    expect(gagal.error).toContain("file too large");

    vi.stubEnv("WHATSAPP_TOKEN", "");
    expect(await sendMedia("628110000", { kind: "image", data: JPEG, mimeType: "image/jpeg", fileName: "foto.jpg" }, "PNID")).toEqual({ status: "simulated" });
  });
});
