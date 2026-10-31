import { getCurrentUser } from "@/lib/auth";
import { fetchDestinations, getRajaOngkirApiKey, RajaOngkirError } from "@/lib/rajaongkir";

/** Search RajaOngkir domestic destinations. Admins may pass an unsaved key to test it. */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { q?: unknown; key?: unknown; limit?: unknown };
  const query = typeof body.q === "string" ? body.q.trim() : "";
  const limit = typeof body.limit === "number" ? body.limit : 10;

  const storedKey = await getRajaOngkirApiKey();
  const typedKey = typeof body.key === "string" ? body.key.trim() : "";
  const apiKey = storedKey || (user.role.name === "Admin" ? typedKey : "");
  if (!apiKey) {
    return Response.json(
      { error: "API key RajaOngkir belum diisi. Simpan API key dulu di Integrasi." },
      { status: 503 },
    );
  }

  try {
    const data = await fetchDestinations(apiKey, query, { limit });
    return Response.json({ data });
  } catch (e) {
    if (e instanceof RajaOngkirError) {
      return Response.json({ error: e.message }, { status: e.status >= 400 && e.status < 600 ? e.status : 502 });
    }
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
