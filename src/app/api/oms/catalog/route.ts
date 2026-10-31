import { getCurrentUser } from "@/lib/auth";
import { getOmsCatalog } from "@/lib/oms/catalog";
import { omsConfigured } from "@/lib/oms/client";
import { canAccess } from "@/lib/permissions";

/** Current OMS prices + stock for the checkout form. Cached for at most 5 minutes. */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  // Only the Pesan checkout form uses the OMS catalog.
  if (!canAccess(user.role, "pesan")) return Response.json({ error: "Forbidden" }, { status: 403 });
  if (!omsConfigured()) return Response.json({ configured: false, prices: [], stock: [] });

  const force = new URL(req.url).searchParams.get("force") === "1";
  const catalog = await getOmsCatalog({ force });
  if (!catalog) {
    return Response.json({ configured: true, error: "Katalog OMS tidak tersedia." }, { status: 503 });
  }
  return Response.json({
    configured: true,
    prices: catalog.prices,
    stock: catalog.stock,
    fetchedAt: catalog.fetchedAt,
  });
}
