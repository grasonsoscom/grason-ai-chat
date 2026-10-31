"use client";

import { useEffect, useMemo, useState } from "react";
import { ActionButton, ActionForm, Modal, SubmitButton } from "@/components/forms";
import { RajaOngkirCheck, type ShippingCost } from "@/components/rajaongkir-checker";
import { Badge, Field } from "@/components/ui";
import { formatIDR } from "@/lib/format";
import type { Harga, Stok } from "@/lib/oms/types";
import {
  orderQuote,
  regionFromText,
  SEGMENT_LABEL,
  type Segment,
} from "@/lib/promo-quote";
import {
  createOmsCheckout,
  markLeadFailed,
  refreshOmsOrder,
  verifyOmsOrder,
} from "@/app/(app)/pesan/actions";

export type OmsOrderSummary = {
  id: number;
  nomor: string;
  status: string;
  metodeBayar: string;
  entitas: string;
  subtotal: number;
  diskon: number;
  ongkir: number;
  subsidiOngkir: number;
  biayaCod: number;
  subsidiAdminCod: number;
  total: number;
  nilaiCod: number;
  segmen: string | null;
  perluVerifikasiManusia: boolean;
  createdAt: string;
};

type RajaOngkirInfo = {
  enabled: boolean;
  originLabel: string;
  courier: string;
  weight: number;
};

type Props = {
  conversationId: number;
  customerName: string;
  customerPhone: string;
  defaultSegment: Segment;
  rajaOngkir: RajaOngkirInfo;
  configured: boolean;
  hasLead: boolean;
  leadStatus: string | null;
  handover: boolean;
  orders: OmsOrderSummary[];
};

const ORDER_TONE: Record<string, "slate" | "green" | "blue" | "amber" | "red" | "purple"> = {
  baru: "amber",
  terverifikasi: "blue",
  di_gudang: "blue",
  dikirim: "purple",
  terkirim: "green",
  batal: "red",
  rts: "red",
};

const LEAD_TONE: Record<string, "slate" | "green" | "blue" | "amber" | "red" | "purple"> = {
  baru: "slate",
  direspon: "blue",
  follow_up: "amber",
  closing: "green",
  gagal: "red",
};

export function OmsOrderPanel({
  conversationId,
  customerName,
  customerPhone,
  defaultSegment,
  rajaOngkir,
  configured,
  hasLead,
  leadStatus,
  handover,
  orders,
}: Props) {
  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium text-slate-700">Order OMS</span>
          {leadStatus ? (
            <Badge tone={LEAD_TONE[leadStatus] ?? "slate"}>Lead: {leadStatus}</Badge>
          ) : (
            <Badge tone="slate">Lead: belum dibuat</Badge>
          )}
          {handover && <Badge tone="red">Handover</Badge>}
          {!hasLead && <span className="text-xs text-slate-500">Lead dibuat otomatis saat pesan masuk.</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {configured ? (
            <Modal
              trigger="Buat Order OMS"
              title="Buat Order OMS"
              triggerClass="btn btn-secondary text-xs"
              wide
            >
              <OmsCheckoutForm
                conversationId={conversationId}
                customerName={customerName}
                customerPhone={customerPhone}
                defaultSegment={defaultSegment}
                rajaOngkir={rajaOngkir}
              />
            </Modal>
          ) : (
            <span className="text-xs text-slate-500">OMS belum dikonfigurasi</span>
          )}
          {leadStatus && leadStatus !== "gagal" && leadStatus !== "closing" && (
            <ActionButton
              action={markLeadFailed}
              fields={{ conversationId }}
              confirm="Tandai lead ini gagal di OMS? Status tidak bisa dikembalikan."
              className="btn btn-ghost text-xs text-red-600"
            >
              Tandai gagal
            </ActionButton>
          )}
        </div>
      </div>

      {orders.length > 0 && (
        <div className="mt-3 space-y-2">
          {orders.map((order) => (
            <div key={order.id} className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{order.nomor}</span>
                  <Badge tone={ORDER_TONE[order.status] ?? "slate"}>{order.status}</Badge>
                  <Badge tone="slate">{order.entitas}</Badge>
                  {order.perluVerifikasiManusia && <Badge tone="red">Perlu CS manusia</Badge>}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">
                    {order.metodeBayar === "cod" ? "COD" : "Transfer"} {formatIDR(order.total)}
                  </span>
                  <ActionButton
                    action={refreshOmsOrder}
                    fields={{ orderId: order.id }}
                    className="btn btn-ghost text-xs"
                  >
                    Muat ulang
                  </ActionButton>
                </div>
              </div>

              <p className="mt-1 text-xs text-slate-500">
                Subtotal {formatIDR(order.subtotal)} · Diskon {formatIDR(order.diskon)} · Ongkir{" "}
                {formatIDR(order.ongkir)} · Subsidi ongkir {formatIDR(order.subsidiOngkir)} · Biaya COD{" "}
                {formatIDR(order.biayaCod)} · Subsidi admin {formatIDR(order.subsidiAdminCod)}
                {order.segmen ? ` · ${SEGMENT_LABEL[order.segmen as Segment] ?? order.segmen}` : ""}
              </p>

              {order.status === "baru" && !order.perluVerifikasiManusia && (
                <div className="mt-2 border-t border-slate-100 pt-2">
                  <Modal trigger="Verifikasi order" title={`Verifikasi ${order.nomor}`} triggerClass="btn btn-secondary text-xs">
                    <p className="mb-3 text-sm text-slate-600">
                      Konfirmasi bahwa pembeli sudah setuju dengan alamat lengkap dan nilai COD{" "}
                      <span className="font-semibold">{formatIDR(order.nilaiCod)}</span>. Angka ini harus sama
                      dengan nilai COD di OMS.
                    </p>
                    <ActionForm action={verifyOmsOrder}>
                      <input type="hidden" name="orderId" value={order.id} />
                      <label className="mb-3 flex items-start gap-2 text-sm">
                        <input type="checkbox" name="konfirmasi" className="mt-1" />
                        <span>Pembeli sudah mengonfirmasi alamat, nilai COD, dan bersedia membayar.</span>
                      </label>
                      <Field label="Catatan (opsional)">
                        <input name="catatan" className="input" placeholder="Konfirmasi via chat" />
                      </Field>
                      <SubmitButton>Verifikasi</SubmitButton>
                    </ActionForm>
                  </Modal>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function OmsCheckoutForm({
  conversationId,
  customerName,
  customerPhone,
  defaultSegment,
  rajaOngkir,
}: {
  conversationId: number;
  customerName: string;
  customerPhone: string;
  defaultSegment: Segment;
  rajaOngkir: RajaOngkirInfo;
}) {
  const [prices, setPrices] = useState<Harga[]>([]);
  const [stock, setStock] = useState<Stok[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<{ sku: string; qty: number }[]>([{ sku: "", qty: 1 }]);
  const [metode, setMetode] = useState<"cod" | "transfer">("cod");
  const [ongkir, setOngkir] = useState(0);
  const [diskon, setDiskon] = useState(0);
  const [segmen, setSegmen] = useState<Segment>(defaultSegment);
  const [provinsi, setProvinsi] = useState("");
  const [showOngkir, setShowOngkir] = useState(false);
  const [ongkirQuery, setOngkirQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/oms/catalog")
      .then(async (res) => {
        const json = (await res.json().catch(() => ({}))) as {
          configured?: boolean;
          prices?: Harga[];
          stock?: Stok[];
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok || json.error) {
          setError(json.error ?? `Gagal memuat katalog OMS (${res.status}).`);
          return;
        }
        if (!json.configured) {
          setError("OMS belum dikonfigurasi.");
          return;
        }
        setPrices(json.prices ?? []);
        setStock(json.stock ?? []);
        setItems((current) =>
          current[0]?.sku || !json.prices?.length
            ? current
            : [{ sku: json.prices[0].sku, qty: 1 }],
        );
      })
      .catch(() => !cancelled && setError("Tidak dapat memuat katalog OMS."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const stockBySku = useMemo(() => new Map(stock.map((s) => [s.sku, s])), [stock]);
  const priceBySku = useMemo(() => new Map(prices.map((p) => [p.sku, p])), [prices]);

  const subtotal = items.reduce((sum, item) => {
    const price = priceBySku.get(item.sku)?.harga_jual ?? 0;
    return sum + price * item.qty;
  }, 0);
  const region = regionFromText(provinsi) ?? "luar";
  const quote = orderQuote({ subtotal, ongkir, diskon, metode, segment: segmen, region });

  const update = (index: number, patch: Partial<{ sku: string; qty: number }>) => {
    setItems((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  function openOngkir() {
    const read = (name: string) => (document.querySelector(`[name="${name}"]`) as HTMLInputElement | null)?.value ?? "";
    setOngkirQuery([read("kecamatan"), read("kota"), read("provinsi")].filter(Boolean).join(" "));
    setShowOngkir((open) => !open);
  }

  if (loading) return <p className="text-sm text-slate-500">Memuat katalog OMS...</p>;
  if (error) return <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>;
  if (!prices.length) return <p className="text-sm text-slate-500">Belum ada produk aktif di OMS.</p>;

  const payloadItems = items.filter((item) => item.sku);

  return (
    <ActionForm action={createOmsCheckout}>
      <input type="hidden" name="conversationId" value={conversationId} />
      <input type="hidden" name="items" value={JSON.stringify(payloadItems)} />

      <div className="mb-3 space-y-2">
        <p className="text-sm font-medium text-slate-700">Item</p>
        {items.map((item, index) => {
          const price = priceBySku.get(item.sku);
          const available = stockBySku.get(item.sku)?.tersedia;
          return (
            <div key={index} className="flex flex-wrap items-center gap-2">
              <select
                value={item.sku}
                onChange={(e) => update(index, { sku: e.target.value })}
                className="input min-w-52 flex-1"
                aria-label={`SKU item ${index + 1}`}
              >
                <option value="">Pilih produk</option>
                {prices.map((p) => (
                  <option key={p.sku} value={p.sku}>
                    {p.nama} — {p.sku} — {formatIDR(p.harga_jual)}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={1}
                max={100}
                value={item.qty}
                onChange={(e) => update(index, { qty: Number(e.target.value) })}
                className="input w-20"
                aria-label={`Jumlah item ${index + 1}`}
              />
              <span className="w-28 text-xs text-slate-500">
                {available === undefined ? "" : `stok ${available}`}
              </span>
              {items.length > 1 && (
                <button
                  type="button"
                  className="text-xs text-red-600"
                  onClick={() => setItems((current) => current.filter((_, i) => i !== index))}
                >
                  Hapus
                </button>
              )}
              {price?.komponen?.length ? (
                <span className="w-full text-xs text-slate-500">
                  Isi paket: {price.komponen.map((k) => `${k.sku} x${k.qty}`).join(", ")}
                </span>
              ) : null}
            </div>
          );
        })}
        <button
          type="button"
          className="btn btn-ghost text-xs"
          onClick={() => setItems((current) => (current.length >= 20 ? current : [...current, { sku: "", qty: 1 }]))}
        >
          + Tambah item
        </button>
        <p className="text-xs text-slate-500">
          Subtotal dari katalog OMS: {formatIDR(subtotal)}.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Metode bayar">
          <select
            name="metode_bayar"
            className="input"
            value={metode}
            onChange={(event) => setMetode(event.target.value as "cod" | "transfer")}
          >
            <option value="cod">COD</option>
            <option value="transfer">Transfer</option>
          </select>
        </Field>
        <Field label="Segmen pelanggan" hint="Menentukan subsidi ongkir dan minimum order.">
          <select
            name="segmen"
            className="input"
            value={segmen}
            onChange={(event) => setSegmen(event.target.value as Segment)}
          >
            {(Object.keys(SEGMENT_LABEL) as Segment[]).map((key) => (
              <option key={key} value={key}>{SEGMENT_LABEL[key]}</option>
            ))}
          </select>
        </Field>
        <Field label="Ongkir (Rp)" hint={rajaOngkir.enabled ? "Bisa diisi manual atau dicek lewat RajaOngkir." : undefined}>
          <input
            name="ongkir"
            type="number"
            min={0}
            step={1}
            value={ongkir}
            onChange={(event) => setOngkir(Number(event.target.value) || 0)}
            className="input"
          />
          {rajaOngkir.enabled && (
            <button type="button" className="mt-1 text-xs font-medium text-green-700 hover:underline" onClick={openOngkir}>
              {showOngkir ? "Tutup cek ongkir" : "Cek ongkir (RajaOngkir)"}
            </button>
          )}
        </Field>
        <Field label="Diskon (Rp)">
          <input
            name="diskon"
            type="number"
            min={0}
            step={1}
            value={diskon}
            onChange={(event) => setDiskon(Number(event.target.value) || 0)}
            className="input"
          />
        </Field>
        <Field label="Nama penerima">
          <input name="nama" required defaultValue={customerName} className="input" />
        </Field>
        <Field label="Nomor WA penerima">
          <input name="no_wa" required defaultValue={customerPhone} className="input" />
        </Field>
        <Field label="Kode pos" hint="5 digit, opsional.">
          <input name="kode_pos" pattern="\d{5}" className="input" />
        </Field>
      </div>

      <Field label="Alamat lengkap">
        <textarea name="alamat" required rows={2} className="input" placeholder="Jalan, nomor rumah, RT/RW, patokan" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Kelurahan">
          <input name="kelurahan" className="input" />
        </Field>
        <Field label="Kecamatan">
          <input name="kecamatan" className="input" />
        </Field>
        <Field label="Kota / kabupaten">
          <input name="kota" required className="input" />
        </Field>
      </div>
      <Field label="Provinsi" hint="Menentukan wilayah subsidi: Jawa atau luar Jawa.">
        <input
          name="provinsi"
          required
          value={provinsi}
          onChange={(event) => setProvinsi(event.target.value)}
          className="input"
        />
      </Field>

      {showOngkir && rajaOngkir.enabled && (
        <div className="mb-3 rounded-lg border border-green-200 bg-green-50/40 p-3">
          <RajaOngkirCheck
            originLabel={rajaOngkir.originLabel}
            defaultCourier={rajaOngkir.courier}
            defaultWeight={rajaOngkir.weight}
            initialQuery={ongkirQuery}
            compact
            onPick={(row: ShippingCost) => {
              setOngkir(row.cost);
              setShowOngkir(false);
            }}
          />
          <p className="mt-2 text-xs text-slate-500">
            Ongkir terpilih akan masuk ke rincian pembayaran dan dikirim ke OMS sebagai bagian dari total.
          </p>
        </div>
      )}

      <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
        <p className="mb-1 font-medium text-slate-700">Rincian pembayaran</p>
        <dl className="space-y-1 text-slate-600">
          <div className="flex justify-between"><dt>Subtotal</dt><dd>{formatIDR(subtotal)}</dd></div>
          <div className="flex justify-between"><dt>Diskon</dt><dd>−{formatIDR(diskon)}</dd></div>
          <div className="flex justify-between"><dt>Ongkir</dt><dd>{formatIDR(ongkir)}</dd></div>
          <div className="flex justify-between"><dt>Subsidi ongkir</dt><dd>−{formatIDR(quote.shippingSubsidy)}</dd></div>
          <div className="flex justify-between">
            <dt>Biaya COD (3%)</dt>
            <dd>{formatIDR(quote.codFee)}</dd>
          </div>
          <div className="flex justify-between"><dt>Subsidi admin COD</dt><dd>−{formatIDR(quote.adminSubsidy)}</dd></div>
          <div className="flex justify-between border-t border-slate-200 pt-1 font-semibold text-slate-800">
            <dt>Total</dt><dd>{formatIDR(quote.total)}</dd>
          </div>
        </dl>
        <p className="mt-1 text-xs text-slate-500">
          Wilayah: {region === "jawa" ? "Jawa" : "Luar Jawa"}. Angka final divalidasi ulang oleh OMS dari harga aktifnya.
        </p>
        {metode === "cod" && !quote.eligible && (
          <p className="mt-1 text-xs text-amber-700">Minimum order untuk subsidi belum tercapai.</p>
        )}
      </div>
      <Field label="Catatan (opsional)">
        <input name="catatan" className="input" />
      </Field>

      <SubmitButton>Buat order</SubmitButton>
    </ActionForm>
  );
}
