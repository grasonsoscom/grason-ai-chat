"use client";

import { useRef, useState } from "react";

const MAX = 2 * 1024 * 1024;
const TYPES = ["image/jpeg", "image/png"];

/** Drag & drop / pick multiple JPEG or PNG files, rejecting anything over 2 MB before upload. */
export function ImageInput({ name }: { name: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState("");
  const [drag, setDrag] = useState(false);

  function accept(list: FileList | null) {
    if (!list) return;
    const ok: File[] = [];
    const bad: string[] = [];
    for (const f of Array.from(list)) {
      if (!TYPES.includes(f.type)) bad.push(`${f.name} (bukan JPEG/PNG)`);
      else if (f.size > MAX) bad.push(`${f.name} (lebih dari 2 MB)`);
      else ok.push(f);
    }
    setError(bad.length ? `Ditolak: ${bad.join(", ")}` : "");
    const dt = new DataTransfer();
    ok.forEach((f) => dt.items.add(f));
    if (ref.current) ref.current.files = dt.files;
    setFiles(ok);
  }

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); accept(e.dataTransfer.files); }}
        onClick={() => ref.current?.click()}
        className={`cursor-pointer rounded-xl border-2 border-dashed p-6 text-center text-sm ${drag ? "border-green-500 bg-green-50" : "border-slate-300"}`}
      >
        <p className="font-medium">Seret & lepas gambar di sini, atau <span className="text-green-700 underline">pilih file</span></p>
        <p className="mt-1 text-xs text-slate-500">JPEG atau PNG, maksimal 2 MB per file</p>
        <input ref={ref} type="file" name={name} accept="image/jpeg,image/png" multiple hidden onChange={(e) => accept(e.target.files)} />
      </div>
      {files.length > 0 && <p className="mt-2 text-xs text-slate-600">{files.length} file siap diunggah: {files.map((f) => f.name).join(", ")}</p>}
      {error && <p role="alert" className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
