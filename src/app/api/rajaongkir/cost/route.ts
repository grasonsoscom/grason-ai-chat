import { getCurrentUser } from "@/lib/auth";
import { calculateDomesticCost, getRajaOngkirConfig, RajaOngkirError } from "@/lib/rajaongkir";

/** Calculate domestic shipping cost from the saved RajaOngkir settings. */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    destinationId?: unknown;
    weight?: unknown;
    courier?: unknown;
  };
  const destinationId = Number(body.destinationId);
  const weight = body.weight === undefined ? undefined : Number(body.weight);
  const courier = typeof body.courier === "string" && body.courier.trim() ? body.courier.trim() : undefined;

  if (!Number.isInteger(destinationId) || destinationId <= 0) {
    return Response.json({ error: "Pilih daerah tujuan dulu." }, { status: 400 });
  }

  try {
    const config = await getRajaOngkirConfig();
    if (!config) {
      return Response.json(
        { error: "RajaOngkir belum dikonfigurasi. Isi API key dan kota asal di Integrasi." },
        { status: 503 },
      );
    }
    const data = await calculateDomesticCost({ destinationId, weight, courier });
    return Response.json({
      data,
      origin: { id: config.originId, label: config.originLabel },
      weight: weight ?? config.weight,
      courier: courier ?? config.courier,
    });
  } catch (e) {
    if (e instanceof RajaOngkirError) {
      return Response.json({ error: e.message }, { status: e.status >= 400 && e.status < 600 ? e.status : 502 });
    }
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
