// Minimal OpenAI-compatible mock for local AI-order smoke tests.
// Returns a scripted reply/extraction so the whole flow can run without an LLM key.
// Run: node scripts/ai-mock-server.mjs  (default port 4020)
import { createServer } from "node:http";

const PORT = Number(process.env.AI_MOCK_PORT ?? 4020);

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function lastCustomerLine(transcript) {
  const lines = String(transcript).split(/\r?\n/).map((line) => line.trim());
  return [...lines].reverse().find((line) => line.startsWith("Pelanggan:"))?.slice("Pelanggan:".length).trim() ?? "";
}

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") return send(res, 200, { ok: true });
  if (req.method !== "POST" || !req.url?.endsWith("/chat/completions")) {
    return send(res, 404, { error: { message: "not found" } });
  }

  const body = await readBody(req);
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const system = messages.find((m) => m.role === "system")?.content ?? "";
  const userTurns = messages.filter((m) => m.role === "user").map((m) => String(m.content ?? ""));
  const transcript = userTurns.join("\n");
  const last = lastCustomerLine(transcript) || userTurns.at(-1) || "";
  const full = /Budi/i.test(transcript) && /Jl\. Melati/i.test(transcript) && /Bandung/i.test(transcript);
  const confirmed = full && /\b(ya|iya|oke|ok)\b/i.test(last);
  let content;

  if (/mesin ekstraksi data pesanan/i.test(system)) {
    content = JSON.stringify({
      intent: confirmed ? "confirm" : "order",
      items: [{ sku: "BSR-01", qty: 1 }],
      nama: full ? "Budi" : "",
      no_wa: "",
      alamat: full ? "Jl. Melati No. 2 RT 03 RW 05" : "",
      kelurahan: full ? "Sukajadi" : "",
      kecamatan: full ? "Sukajadi" : "",
      kota: full ? "Bandung" : "",
      provinsi: full ? "Jawa Barat" : "",
      kode_pos: full ? "40162" : "",
      metode_bayar: full ? "cod" : "",
      catatan: "",
      confirmed,
    });
  } else if (confirmed) {
    content = "Siap kak, pesanan sedang dibuat oleh sistem. Nomor pesanan akan dikirim setelah selesai.";
  } else if (full) {
    content = "Data sudah lengkap. Total pesanan sudah dihitung sistem. Balas YA untuk membuat pesanan.";
  } else {
    content = "Baik kak, mau pesan Bio Serea berapa? Mohon lengkapi nama penerima, alamat, kecamatan, kota, provinsi, dan metode bayar (COD/transfer).";
  }

  send(res, 200, {
    id: "chatcmpl-mock",
    object: "chat.completion",
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`AI mock listening on http://127.0.0.1:${PORT}/v1`);
});
