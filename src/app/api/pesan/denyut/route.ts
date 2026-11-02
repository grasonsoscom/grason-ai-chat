import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canAccess } from "@/lib/permissions";

/**
 * Cheap change marker for the Pesan inbox: the page polls this and refreshes only when
 * the marker changes (new message, unread count, delivery status, mode of the open
 * conversation). Session-protected by middleware; also checks the module.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || !canAccess(user.role, "pesan")) return new Response("Unauthorized", { status: 401 });

  const c = Number(new URL(req.url).searchParams.get("c"));
  const [semua, terbuka] = await Promise.all([
    db.conversation.aggregate({ _max: { lastMessageAt: true }, _sum: { unread: true }, _count: true }),
    c > 0
      ? db.conversation.findUnique({
          where: { id: c },
          select: {
            mode: true,
            assignedToId: true,
            messages: { orderBy: { id: "desc" }, take: 8, select: { id: true, status: true } },
          },
        })
      : null,
  ]);
  const versi = [
    semua._max.lastMessageAt?.getTime() ?? 0,
    semua._sum.unread ?? 0,
    semua._count,
    terbuka ? `${terbuka.mode}:${terbuka.assignedToId ?? ""}:${terbuka.messages.map((m) => `${m.id}${m.status[0]}`).join(".")}` : "",
  ].join("|");
  return Response.json(
    { versi, belumDibaca: semua._sum.unread ?? 0 },
    { headers: { "Cache-Control": "no-store" } },
  );
}
