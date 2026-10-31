"use client";

import { useState } from "react";
import { saveRajaOngkir } from "@/app/(app)/integrasi/actions";
import { ActionForm, SubmitButton } from "./forms";
import { Field } from "./ui";

type Destination = {
  id: number;
  label: string;
  province_name: string;
  city_name: string;
  district_name: string;
  subdistrict_name: string;
  zip_code: string;
};

type Props = {
  originId: number | null;
  originLabel: string;
  courier: string;
  weight: number;
  hasKey: boolean;
};

const COURIERS = ["jne", "jnt", "sicepat", "anteraja", "pos", "tiki", "ninja", "lion", "paxel", "idexpress", "wahana", "sap"];

export function RajaOngkirSettingsForm({ originId: initialOriginId, originLabel: initialOriginLabel, courier: initialCourier, weight: initialWeight, hasKey }: Props) {
  const [apiKey, setApiKey] = useState("");
  const [originId, setOriginId] = useState<number | null>(initialOriginId);
  const [originLabel, setOriginLabel] = useState(initialOriginLabel);
  const [courier, setCourier] = useState(initialCourier);
  const [weight, setWeight] = useState(initialWeight);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Destination[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");

  async function search(e: React.SyntheticEvent) {
    e.preventDefault();
    const q = query.trim();
    if (q.length < 2 || searching) return;
    setSearching(true);
    setSearchError("");
    try {
      const res = await fetch("/api/rajaongkir/destinations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q, key: apiKey.trim(), limit: 10 }),
      });
      const json = (await res.json().catch(() => ({}))) as { data?: Destination[]; error?: string };
      if (!res.ok || json.error) {
        setSearchError(json.error ?? `Pencarian gagal (${res.status}).`);
        setResults([]);
      } else {
        setResults(json.data ?? []);
        if (!json.data?.length) setSearchError("Daerah tidak ditemukan. Coba nama kecamatan, kota, atau kode pos.");
      }
    } catch {
      setSearchError("Tidak dapat menghubungi server.");
    } finally {
      setSearching(false);
    }
  }

  function pick(d: Destination) {
    setOriginId(d.id);
    setOriginLabel(d.label);
    setResults([]);
    setQuery("");
  }

  return (
    <ActionForm action={saveRajaOngkir}>
      <input type="hidden" name="originId" value={originId ?? ""} />
      <input type="hidden" name="originLabel" value={originLabel} />
      <Field
        label="API key RajaOngkir"
        hint={hasKey ? "Key sudah tersimpan. Kosongkan untuk tetap memakai key lama." : "Salin dari dashboard RajaOngkir → Developer → Settings → Api Key (Shipping Cost)."}
      >
        <input
          name="rajaOngkirApiKey"
          type="password"
          autoComplete="off"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          className="input"
          placeholder={hasKey ? "••••••••" : ""}
        />
      </Field>

      <div className="mb-4 rounded-lg border border-slate-200 p-3">
        <p className="mb-1 text-sm font-medium text-slate-700">Kota/kecamatan asal pengiriman</p>
        <p className="mb-2 text-xs text-slate-500">
          {originId ? `Terpilih: ${originLabel} (ID ${originId})` : "Belum dipilih. Cari nama kecamatan asal gudang Anda."}
        </p>
        <div className="flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); search(e); } }}
            className="input"
            placeholder="Contoh: Sukajadi, Bandung"
            aria-label="Cari kota asal"
          />
          <button type="button" className="btn btn-secondary" onClick={search} disabled={searching || query.trim().length < 2}>
            {searching ? "Mencari..." : "Cari"}
          </button>
        </div>
        {searchError && <p role="alert" className="mt-2 text-xs text-red-600">{searchError}</p>}
        {results.length > 0 && (
          <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
            {results.map((d) => (
              <li key={`${d.id}-${d.label}`}>
                <button type="button" onClick={() => pick(d)} className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-left text-xs hover:bg-slate-50">
                  <span className="font-medium">{d.label}</span>
                  <span className="ml-1 text-slate-400">{d.zip_code}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {!hasKey && !apiKey.trim() && (
          <p className="mt-2 text-xs text-amber-700">Isi API key di atas dulu supaya pencarian kota asal bisa dipakai.</p>
        )}
      </div>

      <Field label="Kurir default" hint="Kode kurir RajaOngkir, misalnya jne, jnt, atau sicepat.">
        <input
          name="courier"
          value={courier}
          onChange={(e) => setCourier(e.target.value.toLowerCase())}
          className="input"
          list="rajaongkir-couriers"
          pattern="[a-z0-9_-]{2,20}"
          required
        />
        <datalist id="rajaongkir-couriers">
          {COURIERS.map((c) => <option key={c} value={c} />)}
        </datalist>
      </Field>

      <Field label="Berat default paket (gram)" hint="Dipakai kalau berat paket tidak diisi saat cek ongkir. 1 kg = 1000 gram.">
        <input
          name="weight"
          type="number"
          min={1}
          max={100000}
          step={1}
          value={weight}
          onChange={(e) => setWeight(Number(e.target.value))}
          className="input"
          required
        />
      </Field>

      <SubmitButton>Simpan</SubmitButton>
    </ActionForm>
  );
}
