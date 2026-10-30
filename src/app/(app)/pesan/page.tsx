import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { ActionButton, ActionForm, Modal, SubmitButton } from "@/components/forms";
import { Badge, Field } from "@/components/ui";
import { db } from "@/lib/db";
import { formatTime, timeAgo } from "@/lib/format";
import { HUB_API_TYPE, insideServiceWindow, isConfigured } from "@/lib/whatsapp";
import { requestAiReply, sendMessage, simulateInbound, updateConversation } from "./actions";
import { AiToggle } from "./ai-toggle";

type SP = Promise<{ view?: string; tab?: string; q?: string; c?: string }>;

const MODE_BADGE = {
  ai: <Badge tone="purple">AI</Badge>,
  staf: <Badge tone="blue">Staf</Badge>,
  eskalasi: <Badge tone="red">Eskalasi</Badge>,
} as Record<string, React.ReactNode>;

export default async function PesanPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const view = sp.view === "kanban" ? "kanban" : "daftar";
  const tab = ["staf", "eskalasi"].includes(sp.tab ?? "") ? sp.tab! : "semua";
  const q = (sp.q ?? "").trim();
  if (Number(sp.c) > 0) await db.conversation.updateMany({ where: { id: Number(sp.c), unread: { gt: 0 } }, data: { unread: 0 } });

  const where: Prisma.ConversationWhereInput = {};
  if (tab !== "semua") where.mode = tab;
  if (q) where.customer = { OR: [{ name: { contains: q } }, { phone: { contains: q } }] };

  const convs = await db.conversation.findMany({
    where,
    orderBy: { lastMessageAt: "desc" },
    include: { customer: { include: { stage: true } }, messages: { where: { sender: { not: "system" } }, orderBy: { createdAt: "desc" }, take: 1 } },
  });
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
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Pesan</h1>
        <div className="flex gap-2">
          <div className="flex rounded-lg border border-slate-300 bg-white p-0.5 text-sm">
            <Link href={link({ view: "daftar" })} className={`rounded-md px-3 py-1.5 ${view === "daftar" ? "bg-green-600 text-white" : ""}`}>Daftar</Link>
            <Link href={link({ view: "kanban" })} className={`rounded-md px-3 py-1.5 ${view === "kanban" ? "bg-green-600 text-white" : ""}`}>Kanban</Link>
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

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1 text-sm">
          {[["semua", "Semua", convs.length && tab === "semua" ? convs.length : undefined], ["staf", "Staf", countOf("staf")], ["eskalasi", "Eskalasi", countOf("eskalasi")]].map(([k, label, n]) => (
            <Link key={k as string} href={link({ tab: k as string, c: undefined })} className={`rounded-md px-3 py-1.5 ${tab === k ? "bg-white font-medium shadow-sm" : "text-slate-600"}`}>
              {label} {n ? <span className="ml-1 text-xs text-slate-400">{n}</span> : null}
            </Link>
          ))}
        </div>
        <form action="/pesan" className="flex flex-1 gap-2">
          <input type="hidden" name="view" value={view} />
          <input type="hidden" name="tab" value={tab} />
          <input name="q" defaultValue={q} placeholder="Cari nama atau nomor telepon" className="input max-w-sm" />
          <button className="btn btn-secondary">Cari</button>
        </form>
      </div>

      {view === "kanban" ? (
        <Kanban convs={convs} link={link} />
      ) : (
        <div className="grid h-[calc(100vh-260px)] min-h-[480px] grid-cols-1 overflow-hidden rounded-xl border border-slate-200 bg-white md:grid-cols-[320px_1fr]">
          <ul className="overflow-y-auto border-r border-slate-100">
            {convs.length === 0 && <li className="p-6 text-center text-sm text-slate-500">Tidak ada percakapan.</li>}
            {convs.map((c) => {
              const last = c.messages[0];
              return (
                <li key={c.id}>
                  <Link href={link({ c: String(c.id) })} className={`flex gap-3 border-b border-slate-50 px-4 py-3 hover:bg-slate-50 ${String(c.id) === sp.c ? "bg-green-50" : ""}`}>
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-200 text-sm font-semibold">{c.customer.name.charAt(0)}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium">{c.customer.name}</span>
                        <span className="shrink-0 text-xs text-slate-400">{formatTime(c.lastMessageAt)}</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-slate-500">
                        <span className="text-green-600" title="WhatsApp">●</span>
                        {last?.direction === "out" && <span className={last.status === "read" ? "text-blue-500" : ""}>✓✓</span>}
                        <span className="truncate">{last?.text ?? ""}</span>
                        {c.unread > 0 && <span className="ml-auto rounded-full bg-green-600 px-1.5 text-xs text-white">{c.unread}</span>}
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
          <section className="hidden min-h-0 md:flex md:flex-col">
            {sp.c ? <ConversationPanel id={Number(sp.c)} /> : (
              <div className="flex flex-1 items-center justify-center text-sm text-slate-400">Pilih percakapan untuk melihat detail</div>
            )}
          </section>
        </div>
      )}
      {sp.c && view === "daftar" && (
        <div className="mt-4 md:hidden"><div className="flex h-[70vh] flex-col rounded-xl border border-slate-200 bg-white"><ConversationPanel id={Number(sp.c)} /></div></div>
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
          <div key={col.name} className="w-72 shrink-0 rounded-xl bg-slate-100 p-3">
            <div className="mb-3 flex items-center justify-between text-sm font-medium">{col.name}<span className="text-slate-400">{items.length}</span></div>
            <div className="space-y-2">
              {items.map((c) => (
                <Link key={c.id} href={link({ view: "daftar", c: String(c.id) })} className="block rounded-lg bg-white p-3 text-sm shadow-sm hover:shadow">
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

async function ConversationPanel({ id }: { id: number }) {
  const conv = await db.conversation.findUnique({
    where: { id },
    include: { customer: true, device: { include: { templates: true } }, messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!conv) return <div className="p-6 text-sm text-slate-500">Percakapan tidak ditemukan.</div>;
  const [staff, stages] = await Promise.all([
    db.user.findMany({ where: { status: "active" }, select: { id: true, name: true } }),
    db.funnelStage.findMany({ orderBy: { number: "asc" } }),
  ]);
  const inWindow = insideServiceWindow(conv.lastInboundAt);

  return (
    <>
      <div className="border-b border-slate-100 p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="font-semibold">{conv.customer.name}</p>
            <p className="text-xs text-slate-500">{conv.customer.phone} · {conv.device?.label ?? "Tanpa perangkat"}</p>
          </div>
          <div className="flex items-start gap-2">
            <ActionButton action={requestAiReply} fields={{ conversationId: id }} className="btn btn-secondary text-xs">🤖 Minta balasan AI</ActionButton>
            <AiToggle conversationId={id} on={conv.mode === "ai"}
              changed={conv.modeChangedAt ? `Terakhir diubah ${timeAgo(conv.modeChangedAt)}` : conv.mode === "ai" ? "Aktif sejak awal" : ""} />
          </div>
        </div>
        {/* key: remount so the selects pick up a mode changed by the Agen AI switch */}
        <ActionForm key={conv.mode} action={updateConversation} className="mt-3 flex flex-wrap items-end gap-2 text-sm" showOk={false}>
          <input type="hidden" name="conversationId" value={id} />
          <select name="mode" defaultValue={conv.mode} className="input w-auto" aria-label="Ditangani oleh">
            <option value="ai">Ditangani AI</option>
            <option value="staf">Ditangani Staf</option>
            <option value="eskalasi">Eskalasi</option>
          </select>
          <select name="assignedToId" defaultValue={conv.assignedToId ?? ""} className="input w-auto" aria-label="Staf">
            <option value="">Belum ditugaskan</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select name="stageId" defaultValue={conv.customer.stageId ?? ""} className="input w-auto" aria-label="Tahapan">
            <option value="">Tanpa tahapan</option>
            {stages.map((s) => <option key={s.id} value={s.id}>{s.number}. {s.name}</option>)}
          </select>
          <SubmitButton variant="secondary">Simpan</SubmitButton>
        </ActionForm>
      </div>

      <div className="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto bg-slate-50 p-4">
        <div className="space-y-2">
          {conv.messages.map((m) =>
            m.sender === "system" ? (
              <p key={m.id} className="text-center text-xs text-slate-400">{m.text}</p>
            ) : (
              <div key={m.id} className={`flex ${m.direction === "out" ? "justify-end" : ""}`}>
                <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${m.direction === "out" ? "bg-green-600 text-white" : "bg-white shadow-sm"}`}>
                  <p className="whitespace-pre-wrap">{m.text}</p>
                  <p className={`mt-1 text-right text-[10px] ${m.direction === "out" ? "text-green-100" : "text-slate-400"}`}>
                    {m.sender === "ai" && "AI · "}{formatTime(m.createdAt)}
                    {m.direction === "out" && (m.status === "simulated" ? " · simulasi" : m.status === "failed" ? " · gagal" : " ✓✓")}
                  </p>
                </div>
              </div>
            ),
          )}
        </div>
      </div>

      <div className="border-t border-slate-100 p-3">
        {conv.device?.apiType !== HUB_API_TYPE && !isConfigured(conv.device?.phoneNumberId) && <p className="mb-2 text-xs text-amber-700">WhatsApp API belum dikonfigurasi. Pesan disimpan sebagai simulasi.</p>}
        {conv.mode === "ai" ? (
          <p className="rounded-lg bg-green-50 px-3 py-2 text-center text-xs text-green-800">Agen AI sedang membalas percakapan ini. Matikan <span className="font-semibold">Agen AI</span> di atas untuk membalas manual.</p>
        ) : inWindow ? (
          <ActionForm action={sendMessage} resetOnSuccess showOk={false} className="flex gap-2">
            <input type="hidden" name="conversationId" value={id} />
            <input name="text" required placeholder="Tulis pesan..." className="input" autoComplete="off" />
            <SubmitButton>Kirim</SubmitButton>
          </ActionForm>
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
