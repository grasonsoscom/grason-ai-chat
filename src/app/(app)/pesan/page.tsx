import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { ActionButton, ActionForm, Modal, SubmitButton } from "@/components/forms";
import { OmsOrderPanel } from "@/components/oms-order-panel";
import { Badge, Field } from "@/components/ui";
import { db } from "@/lib/db";
import { omsConfigured } from "@/lib/oms/client";
import { getRajaOngkirStatus } from "@/lib/rajaongkir";
import { customerSegment } from "@/lib/promo";
import { formatTime, timeAgo } from "@/lib/format";
import { HUB_API_TYPE, insideServiceWindow, isConfigured } from "@/lib/whatsapp";
import { mediaUrl } from "@/lib/media";
import { requestAiReply, sendMediaMessage, sendMessage, simulateInbound, updateConversation } from "./actions";
import { AiToggle } from "./ai-toggle";
import { KotakTulis, PesanLangsung } from "./langsung";
import { requirePageAccess } from "@/lib/auth";
import { isAdminRole } from "@/lib/permissions";

type SP = Promise<{ view?: string; tab?: string; q?: string; c?: string }>;

const MODE_BADGE = {
  ai: <Badge tone="green">AI</Badge>,
  staf: <Badge tone="slate">Staf</Badge>,
  eskalasi: <Badge tone="amber">Eskalasi</Badge>,
} as Record<string, React.ReactNode>;

/** Who handles the conversation, in words (colour is never the only signal). */
const MODE_LABEL: Record<string, string> = { ai: "AI", staf: "Staf", eskalasi: "Eskalasi" };
const AVATAR: Record<string, string> = {
  ai: "bg-green-100 text-green-800",
  staf: "bg-slate-200 text-slate-800",
  eskalasi: "bg-kunyit-soft text-kunyit-ink",
};

export default async function PesanPage({ searchParams }: { searchParams: SP }) {
  const me = await requirePageAccess("pesan");
  const isAdmin = isAdminRole(me.role);
  const sp = await searchParams;
  const view = sp.view === "kanban" ? "kanban" : "daftar";
  const tab = ["staf", "eskalasi"].includes(sp.tab ?? "") ? sp.tab! : "semua";
  const q = (sp.q ?? "").trim();
  if (Number(sp.c) > 0) await db.conversation.updateMany({ where: { id: Number(sp.c), unread: { gt: 0 } }, data: { unread: 0 } });

  const where: Prisma.ConversationWhereInput = {};
  if (tab !== "semua") where.mode = tab;
  if (q) where.customer = { OR: [{ name: { contains: q } }, { phone: { contains: q } }] };

  const semuaPercakapan = await db.conversation.findMany({
    where,
    orderBy: { lastMessageAt: "desc" },
    include: { customer: { include: { stage: true } }, messages: { where: { sender: { not: "system" } }, orderBy: { createdAt: "desc" }, take: 1 } },
  });
  // Conversations waiting for a human come first; then newest activity.
  const convs = [...semuaPercakapan].sort((a, b) => Number(b.mode === "eskalasi") - Number(a.mode === "eskalasi"));
  const counts = await db.conversation.groupBy({ by: ["mode"], _count: true });
  const countOf = (m: string) => counts.find((c) => c.mode === m)?._count ?? 0;

  const link = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { view, tab, q: q || undefined, c: sp.c, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    return `/pesan?${p}`;
  };

  const devices = await db.device.findMany({ select: { id: true, label: true } });

  return (
    <div>
      <PesanLangsung c={sp.c} />
      <div className={`mb-3 flex flex-wrap items-center justify-between gap-2 ${sp.c && view === "daftar" ? "hidden md:flex" : ""}`}>
        <div className="flex items-baseline gap-3">
          <h1 className="text-xl font-bold tracking-tight">Pesan</h1>
          <p className="text-sm text-slate-600">
            {countOf("eskalasi") > 0 ? (
              <span className="font-semibold text-kunyit-ink">{countOf("eskalasi")} menunggu staf</span>
            ) : (
              "Tidak ada yang menunggu staf"
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <div className="flex rounded-md border border-slate-300 bg-white p-0.5 text-sm font-semibold" role="group" aria-label="Tampilan">
            <Link href={link({ view: "daftar" })} aria-current={view === "daftar" ? "page" : undefined} className={`rounded px-3 py-1.5 ${view === "daftar" ? "bg-tinta text-white" : "text-slate-600 hover:text-slate-900"}`}>Daftar</Link>
            <Link href={link({ view: "kanban" })} aria-current={view === "kanban" ? "page" : undefined} className={`rounded px-3 py-1.5 ${view === "kanban" ? "bg-tinta text-white" : "text-slate-600 hover:text-slate-900"}`}>Kanban</Link>
          </div>
          <Modal trigger="Simulasi Pesan Masuk" title="Simulasi Pesan Masuk" triggerClass="btn btn-secondary">
            <p className="mb-3 text-xs text-slate-500">Untuk pengujian tanpa WhatsApp asli. Pesan diproses seperti pesan dari pelanggan, termasuk balasan AI.</p>
            <ActionForm action={simulateInbound}>
              <Field label="Nomor pelanggan"><input name="phone" required className="input" placeholder="+62800..." /></Field>
              <Field label="Nama (opsional)"><input name="name" className="input" /></Field>
              <Field label="Perangkat">
                <select name="deviceId" className="input">{devices.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}</select>
              </Field>
              <Field label="Pesan"><textarea name="text" required rows={3} className="input" /></Field>
              <SubmitButton>Kirim</SubmitButton>
            </ActionForm>
          </Modal>
        </div>
      </div>

      {view === "kanban" ? (
        <Kanban convs={convs} link={link} />
      ) : (
        <div className="grid h-[calc(100dvh-12rem)] min-h-[520px] grid-cols-1 overflow-hidden rounded-lg border border-slate-200 bg-white md:grid-cols-[340px_1fr]">
          <div className={`min-h-0 flex-col border-r border-slate-200 ${sp.c ? "hidden md:flex" : "flex"}`}>
      <div className="space-y-2 border-b border-slate-200 p-3">
        <nav className="-mx-1 flex max-w-full gap-1 overflow-x-auto px-1 text-sm font-semibold" aria-label="Saring percakapan">
          {[["semua", "Semua", semuaPercakapan.length && tab === "semua" ? semuaPercakapan.length : undefined], ["staf", "Ditangani staf", countOf("staf")], ["eskalasi", "Eskalasi", countOf("eskalasi")]].map(([k, label, n]) => (
            <Link
              key={k as string}
              href={link({ tab: k as string, c: undefined })}
              aria-current={tab === k ? "page" : undefined}
              className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 ${tab === k ? "bg-white text-slate-900 ring-1 ring-slate-300" : "text-slate-600 hover:text-slate-900"}`}
            >
              {label}
              {n ? (
                <span className={`rounded px-1.5 text-xs ${k === "eskalasi" ? "bg-kunyit text-tinta" : "bg-slate-200 text-slate-700"}`}>{n}</span>
              ) : null}
            </Link>
          ))}
        </nav>
        <form action="/pesan" className="flex gap-2" role="search">
          <input type="hidden" name="view" value={view} />
          <input type="hidden" name="tab" value={tab} />
          <input name="q" defaultValue={q} placeholder="Cari nama atau nomor" aria-label="Cari percakapan" className="input py-1.5" />
          <button className="btn btn-secondary py-1.5">Cari</button>
        </form>
      </div>
          <ul className="min-h-0 flex-1 overflow-y-auto" aria-label="Daftar percakapan">
            {convs.length === 0 && (
              <li className="p-6 text-sm text-slate-600">
                {q ? `Tidak ada percakapan yang cocok dengan "${q}".` : "Belum ada percakapan. Pesan WhatsApp yang masuk akan muncul di sini."}
              </li>
            )}
            {convs.map((c) => {
              const last = c.messages[0];
              const dipilih = String(c.id) === sp.c;
              const eskalasi = c.mode === "eskalasi";
              return (
                <li key={c.id}>
                  <Link
                    href={link({ c: String(c.id) })}
                    aria-current={dipilih ? "true" : undefined}
                    className={`relative flex gap-3 border-b border-slate-100 px-4 py-3 ${dipilih ? "bg-green-50" : "hover:bg-slate-50"}`}
                  >
                    {(eskalasi || dipilih) && (
                      <span aria-hidden className={`absolute inset-y-0 left-0 w-1 ${eskalasi ? "bg-kunyit" : "bg-green-600"}`} />
                    )}
                    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold ${AVATAR[c.mode] ?? AVATAR.staf}`} aria-hidden>
                      {c.customer.name.charAt(0).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className={`truncate ${c.unread > 0 ? "font-bold text-slate-900" : "font-semibold text-slate-800"}`}>{c.customer.name}</span>
                        <span className="shrink-0 text-xs text-slate-500">{formatTime(c.lastMessageAt)}</span>
                      </span>
                      <span className="mt-0.5 flex items-center gap-2 text-sm text-slate-600">
                        {last?.direction === "out" && (
                          <span className={`shrink-0 text-xs ${last.status === "read" ? "text-green-600" : "text-slate-400"}`} aria-label={last.status === "read" ? "Dibaca" : "Terkirim"}>✓✓</span>
                        )}
                        <span className="truncate">{last?.text ?? ""}</span>
                      </span>
                      <span className="mt-1 flex items-center gap-2 text-xs">
                        <span className={eskalasi ? "font-semibold text-kunyit-ink" : "text-slate-500"}>{MODE_LABEL[c.mode] ?? c.mode}</span>
                        {c.customer.stage && <span className="truncate text-slate-400">{c.customer.stage.name}</span>}
                        {c.unread > 0 && (
                          <span className="ml-auto rounded bg-kunyit px-1.5 font-bold text-tinta" aria-label={`${c.unread} belum dibaca`}>{c.unread}</span>
                        )}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          </div>
          <section className={`min-h-0 flex-col ${sp.c ? "flex" : "hidden md:flex"}`}>
            {sp.c ? <ConversationPanel id={Number(sp.c)} isAdmin={isAdmin} kembali={link({ c: undefined })} /> : (
              <div className="latar-kawung flex flex-1 items-center justify-center p-6">
                <p className="max-w-xs rounded-md bg-white/90 px-4 py-3 text-sm text-slate-600">Pilih percakapan di sebelah kiri untuk membaca dan membalas.</p>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

type ConvRow = Prisma.ConversationGetPayload<{ include: { customer: { include: { stage: true } }; messages: true } }>;

async function Kanban({ convs, link }: { convs: ConvRow[]; link: (p: Record<string, string | undefined>) => string }) {
  const stages = await db.funnelStage.findMany({ orderBy: { number: "asc" } });
  const columns = [...stages.map((s) => ({ id: s.id as number | null, name: `${s.number}. ${s.name}` })), { id: null, name: "Tanpa Tahapan" }];
  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {columns.map((col) => {
        const items = convs.filter((c) => c.customer.stageId === col.id);
        return (
          <div key={col.name} className="w-72 shrink-0 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="mb-3 flex items-center justify-between text-sm font-semibold">{col.name}<span className="font-medium text-slate-500">{items.length}</span></div>
            <div className="space-y-2">
              {items.map((c) => (
                <Link key={c.id} href={link({ view: "daftar", c: String(c.id) })} className={`block rounded-md border bg-white p-3 text-sm hover:border-slate-400 ${c.mode === "eskalasi" ? "border-l-4 border-slate-200 border-l-kunyit" : "border-slate-200"}`}>
                  <div className="flex items-center justify-between"><span className="font-medium">{c.customer.name}</span>{MODE_BADGE[c.mode]}</div>
                  <p className="mt-1 truncate text-slate-500">{c.messages[0]?.text}</p>
                  <p className="mt-1 text-xs text-slate-400">{timeAgo(c.lastMessageAt)}</p>
                </Link>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

async function ConversationPanel({ id, isAdmin, kembali }: { id: number; isAdmin: boolean; kembali: string }) {
  const conv = await db.conversation.findUnique({
    where: { id },
    include: {
      customer: true,
      device: { include: { templates: true } },
      messages: { orderBy: { createdAt: "asc" }, include: { mediaAsset: { select: { id: true, kind: true } } } },
    },
  });
  if (!conv) return <div className="p-6 text-sm text-slate-500">Percakapan tidak ditemukan.</div>;
  const [staff, stages, omsOrders, failedCheckouts, mediaList] = await Promise.all([
    db.user.findMany({ where: { status: "active" }, select: { id: true, name: true } }),
    db.funnelStage.findMany({ orderBy: { number: "asc" } }),
    db.omsOrder.findMany({ where: { conversationId: id }, orderBy: { createdAt: "desc" }, take: 20 }),
    db.omsCheckout.findMany({
      where: { conversationId: id, status: "failed" },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, createdAt: true, lastError: true, createdByAi: true },
    }),
    db.mediaAsset.findMany({ where: { active: true }, select: { id: true, title: true, kind: true }, orderBy: { title: "asc" } }),
  ]);
  const inWindow = insideServiceWindow(conv.lastInboundAt);
  const defaultSegment = await customerSegment(conv.customerId);
  const raja = await getRajaOngkirStatus();

  return (
    <>
      <div className="border-b border-slate-200 px-4 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Link href={kembali} className="-ml-1 rounded-md px-1.5 py-1 text-lg text-slate-600 hover:bg-slate-100 md:hidden" aria-label="Kembali ke daftar percakapan">
              ←
            </Link>
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-base font-bold">
                <span className="truncate">{conv.customer.name}</span>
                {MODE_BADGE[conv.mode]}
              </p>
              <p className="truncate text-sm text-slate-600">{conv.customer.phone}<span className="text-slate-400"> lewat </span>{conv.device?.label ?? "tanpa perangkat"}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-start gap-2">
            <ActionButton action={requestAiReply} fields={{ conversationId: id }} className="btn btn-secondary px-2.5 text-xs sm:px-4">
              <span aria-hidden>🤖</span>
              <span className="sr-only sm:not-sr-only">Minta balasan AI</span>
            </ActionButton>
            <AiToggle conversationId={id} on={conv.mode === "ai"}
              changed={conv.modeChangedAt ? `Terakhir diubah ${timeAgo(conv.modeChangedAt)}` : conv.mode === "ai" ? "Aktif sejak awal" : ""} />
          </div>
        </div>
        <details className="group mt-1.5">
          <summary className="cursor-pointer list-none text-sm font-semibold text-slate-600 hover:text-slate-900">
            <span className="inline-block transition-transform group-open:rotate-90">›</span> Kelola percakapan
            <span className="ml-1 font-normal text-slate-500">
              · {staff.find((s) => s.id === conv.assignedToId)?.name ?? "belum ditugaskan"}
              {omsOrders.length > 0 && ` · ${omsOrders.length} pesanan OMS`}
              {failedCheckouts.length > 0 && <span className="font-semibold text-red-700"> · {failedCheckouts.length} order gagal</span>}
            </span>
          </summary>
        {/* key: remount so the selects pick up a mode changed by the Agen AI switch */}
        <ActionForm key={conv.mode} action={updateConversation} className="mt-2 flex flex-wrap items-center gap-1.5 text-sm" showOk={false}>
          <input type="hidden" name="conversationId" value={id} />
          <select name="mode" defaultValue={conv.mode} className="input w-auto py-1 text-[13px]" aria-label="Ditangani oleh">
            <option value="ai">Ditangani AI</option>
            <option value="staf">Ditangani Staf</option>
            <option value="eskalasi">Eskalasi</option>
          </select>
          <select name="assignedToId" defaultValue={conv.assignedToId ?? ""} className="input w-auto py-1 text-[13px]" aria-label="Staf">
            <option value="">Belum ditugaskan</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select name="stageId" defaultValue={conv.customer.stageId ?? ""} className="input w-auto py-1 text-[13px]" aria-label="Tahapan">
            <option value="">Tanpa tahapan</option>
            {stages.map((s) => <option key={s.id} value={s.id}>{s.number}. {s.name}</option>)}
          </select>
          <SubmitButton variant="secondary" className="py-1 text-[13px]">Simpan</SubmitButton>
        </ActionForm>

        <OmsOrderPanel
          conversationId={id}
          isAdmin={isAdmin}
          customerName={conv.customer.name}
          customerPhone={conv.customer.phone}
          defaultSegment={defaultSegment}
          rajaOngkir={{ enabled: raja.configured, originLabel: raja.originLabel, courier: raja.courier, weight: raja.weight }}
          configured={omsConfigured()}
          hasLead={Boolean(conv.omsLeadId)}
          leadStatus={conv.omsLeadStatus}
          handover={Boolean(conv.omsHandoverAt)}
          failedCheckouts={failedCheckouts.map((c) => ({
            id: c.id,
            createdAt: c.createdAt.toISOString(),
            lastError: c.lastError,
            createdByAi: c.createdByAi,
          }))}
          orders={omsOrders.map((order) => ({
            id: order.id,
            nomor: order.nomor,
            status: order.status,
            metodeBayar: order.metodeBayar,
            entitas: order.entitas,
            subtotal: order.subtotal,
            diskon: order.diskon,
            ongkir: order.ongkir,
            subsidiOngkir: order.subsidiOngkir,
            biayaCod: order.biayaCod,
            subsidiAdminCod: order.subsidiAdminCod,
            total: order.total,
            nilaiCod: order.nilaiCod,
            segmen: order.segmen,
            perluVerifikasiManusia: order.perluVerifikasiManusia,
            createdAt: order.createdAt.toISOString(),
          }))}
        />
        </details>
      </div>

      <div className="latar-kawung flex min-h-0 flex-1 flex-col-reverse overflow-y-auto px-4 py-5 md:px-8">
        <div className="space-y-2.5">
          {conv.messages.map((m) =>
            m.sender === "system" ? (
              <p key={m.id} className="mx-auto w-fit max-w-[85%] rounded-md bg-white/85 px-3 py-1 text-center text-xs text-slate-600">{m.text}</p>
            ) : (
              <div key={m.id} className={`flex ${m.direction === "out" ? "justify-end" : ""}`}>
                <div
                  className={`max-w-[85%] rounded-lg px-3.5 py-2 text-[15px] leading-relaxed md:max-w-[70%] ${
                    m.direction === "in"
                      ? "rounded-tl-sm border border-slate-200 bg-white text-slate-900"
                      : m.sender === "ai"
                        ? "rounded-tr-sm border border-green-200 bg-green-100 text-slate-900"
                        : "rounded-tr-sm bg-green-600 text-white"
                  }`}
                >
                  {m.mediaAsset &&
                    (m.mediaAsset.kind === "video" ? (
                      <video src={mediaUrl(m.mediaAsset.id)} controls preload="metadata" className="mb-1 max-h-64 rounded-lg bg-black" />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={mediaUrl(m.mediaAsset.id)} alt="" className="mb-1 max-h-64 rounded-lg" />
                    ))}
                  <p className="whitespace-pre-wrap">{m.text}</p>
                  <p className={`mt-1 text-right text-[11px] ${m.direction === "out" && m.sender !== "ai" ? "text-green-100" : "text-slate-500"}`}>
                    {m.sender === "ai" && <span className="mr-1 font-bold text-green-800">AI</span>}{formatTime(m.createdAt)}
                    {m.direction === "out" && (m.status === "simulated" ? " · simulasi" : m.status === "failed" ? " · gagal" : " ✓✓")}
                  </p>
                </div>
              </div>
            ),
          )}
        </div>
      </div>

      <div className="border-t border-slate-200 bg-white p-3">
        {conv.device?.apiType !== HUB_API_TYPE && !isConfigured(conv.device?.phoneNumberId) && <p className="mb-2 text-xs text-amber-700">WhatsApp API belum dikonfigurasi. Pesan disimpan sebagai simulasi.</p>}
        {conv.mode === "ai" ? (
          <p className="rounded-md bg-green-100 px-3 py-2 text-sm text-green-900">Agen AI sedang membalas percakapan ini. Matikan <span className="font-semibold">Agen AI</span> di atas untuk membalas sendiri.</p>
        ) : inWindow ? (
          <div className="space-y-2">
            <ActionForm action={sendMessage} resetOnSuccess showOk={false} className="flex items-end gap-2">
              <input type="hidden" name="conversationId" value={id} />
              <KotakTulis />
              <SubmitButton className="h-[52px] px-5">Kirim</SubmitButton>
            </ActionForm>
            {mediaList.length > 0 && (
              <ActionForm action={sendMediaMessage} showOk={false} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="conversationId" value={id} />
                <select name="mediaId" required defaultValue="" className="input w-auto max-w-full text-xs" aria-label="Media testimoni">
                  <option value="" disabled>Pilih media testimoni…</option>
                  {mediaList.map((m) => (
                    <option key={m.id} value={m.id}>{m.kind === "video" ? "🎬" : "🖼️"} {m.title}</option>
                  ))}
                </select>
                <SubmitButton variant="secondary">Kirim media</SubmitButton>
              </ActionForm>
            )}
          </div>
        ) : (
          <ActionForm action={sendMessage} showOk={false} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="conversationId" value={id} />
            <span className="text-xs text-slate-500">Di luar jendela 24 jam. Kirim template:</span>
            {conv.device?.templates.length ? (
              <>
                <select name="templateId" className="input w-auto">{conv.device.templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
                <SubmitButton>Kirim Template</SubmitButton>
              </>
            ) : (
              <Link href="/whatsapp" className="text-xs text-green-700 underline">Belum ada template. Atur Template Pesan</Link>
            )}
          </ActionForm>
        )}
      </div>
    </>
  );
}
