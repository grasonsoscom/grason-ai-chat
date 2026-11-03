"use client";

import { useState } from "react";

type Destination = {
  id: number;
  label: string;
  province_name: string;
  city_name: string;
  district_name: string;
  subdistrict_name: string;
  zip_code: string;
};

export type ShippingCost = {
  name: string;
  code: string;
  service: string;
  description: string;
  cost: number;
  etd: string;
};

const formatIDR = (n: number) => `Rp${n.toLocaleString("id-ID")}`;

const COURIERS = ["jne", "jnt", "sicepat", "anteraja", "pos", "tiki", "ninja", "lion", "paxel", "idexpress", "wahana", "sap"];

/**
 * Destination search + RajaOngkir cost result. Renders no <form>, so it can be
 * embedded inside the OMS checkout form without nesting forms.
 */
export function RajaOngkirCheck({
  originLabel,
  defaultCourier,
  defaultWeight,
  initialQuery = "",
  onPick,
  compact = false,
}: {
  originLabel: string;
  defaultCourier: string;
  defaultWeight: number;
  initialQuery?: string;
  onPick?: (row: ShippingCost) => void;
  compact?: boolean;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [selected, setSelected] = useState<Destination | null>(null);
  const [results, setResults] = useState<Destination[]>([]);
  const [courier, setCourier] = useState(defaultCourier);
  const [weight, setWeight] = useState(defaultWeight);
  const [rows, setRows] = useState<ShippingCost[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [error, setError] = useState("");

  async function search() {
    const q = query.trim();
    if (q.length < 2 || searching) return;
    setSearching(true);
    setError("");
    setRows(null);
    try {
      const res = await fetch("/api/rajaongkir/destinations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q, limit: 10 }),
      });
      const json = (await res.json().catch(() => ({}))) as { data?: Destination[]; error?: string };
      if (!res.ok || json.error) {
        setError(json.error ?? `Pencarian gagal (${res.status}).`);
        setResults([]);
      } else {
        setResults(json.data ?? []);
        if (!json.data?.length) setError("Daerah tidak ditemukan. Coba nama kecamatan, kota, atau kode pos.");
      }
    } catch {
      setError("Tidak dapat menghubungi server.");
    } finally {
      setSearching(false);
    }
  }

  async function calculate() {
    if (!selected) {
      setError("Pilih daerah tujuan dari hasil pencarian dulu.");
      return;
    }
    if (!Number.isInteger(weight) || weight < 1) {
      setError("Berat paket minimal 1 gram.");
      return;
    }
    setCalculating(true);
    setError("");
    setRows(null);
    try {
      const res = await fetch("/api/rajaongkir/cost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ destinationId: selected.id, weight, courier }),
      });
      const json = (await res.json().catch(() => ({}))) as { data?: ShippingCost[]; error?: string };
      if (!res.ok || json.error) {
        setError(json.error ?? `Cek ongkir gagal (${res.status}).`);
      } else if (!json.data?.length) {
        setError("Tidak ada layanan kurir untuk rute ini. Coba kurir lain.");
        setRows([]);
      } else {
        setRows(json.data);
      }
    } catch {
      setError("Tidak dapat menghubungi server.");
    } finally {
      setCalculating(false);
    }
  }

  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      <p className="text-xs text-slate-500">
        Asal: <span className="font-medium text-slate-700">{originLabel || "belum diatur"}</span>
      </p>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">Daerah tujuan</label>
        <div className="flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); search(); } }}
            className="input"
            placeholder="Kecamatan, kota, atau kode pos"
            aria-label="Cari daerah tujuan"
          />
          <button type="button" className="btn btn-secondary" onClick={search} disabled={searching || query.trim().length < 2}>
            {searching ? "Mencari..." : "Cari"}
          </button>
        </div>
        {selected && (
          <p className="mt-1 text-xs text-green-700">Tujuan: {selected.label} (ID {selected.id})</p>
        )}
        {results.length > 0 && (
          <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
            {results.map((d) => (
              <li key={`${d.id}-${d.label}`}>
                <button
                  type="button"
                  onClick={() => { setSelected(d); setResults([]); setRows(null); setError(""); }}
                  className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-left text-xs hover:bg-slate-50"
                >
                  <span className="font-medium">{d.label}</span>
                  <span className="ml-1 text-slate-400">{d.zip_code}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Berat paket (gram)</label>
          <input
            type="number"
            min={1}
            max={100000}
            step={1}
            value={weight}
            onChange={(e) => setWeight(Number(e.target.value))}
            className="input"
            aria-label="Berat paket dalam gram"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Kurir <span className="font-normal text-slate-500">(beberapa: jnt:jne:sicepat)</span></label>
          <input
            value={courier}
            onChange={(e) => setCourier(e.target.value.toLowerCase())}
            className="input"
            list="rajaongkir-check-couriers"
            aria-label="Kode kurir"
          />
          <datalist id="rajaongkir-check-couriers">
            {COURIERS.map((c) => <option key={c} value={c} />)}
          </datalist>
        </div>
      </div>

      <button type="button" className="btn btn-primary" onClick={calculate} disabled={calculating || !selected}>
        {calculating ? "Menghitung..." : "Cek Ongkir"}
      </button>

      {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {rows && rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Kurir</th>
                <th className="px-3 py-2">Layanan</th>
                <th className="px-3 py-2">Estimasi</th>
                <th className="px-3 py-2">Ongkir</th>
                {onPick && <th className="px-3 py-2" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={`${row.code}-${row.service}-${i}`} className="border-t border-slate-100">
                  <td className="px-3 py-2">{row.name || row.code.toUpperCase()}</td>
                  <td className="px-3 py-2">
                    <span className="font-medium">{row.service}</span>
                    {row.description && <span className="block text-xs text-slate-500">{row.description}</span>}
                  </td>
                  <td className="px-3 py-2 text-slate-600">{row.etd || "-"}</td>
                  <td className="px-3 py-2 font-medium">{formatIDR(row.cost)}</td>
                  {onPick && (
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        className="btn btn-secondary text-xs"
                        onClick={() => onPick(row)}
                      >
                        Pakai
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows && rows.length === 0 && !error && <p className="text-sm text-slate-500">Tidak ada layanan untuk rute ini.</p>}
    </div>
  );
}
