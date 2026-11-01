"use client";

import { useRef, useState } from "react";

const MAX_FOTO = 2 * 1024 * 1024;
const MAX_VIDEO = 16 * 1024 * 1024;

/** One testimonial file: JPEG/PNG up to 2 MB or MP4 up to 16 MB, checked before upload. */
export function MediaInput({ name }: { name: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");

  function accept(list: FileList | null) {
    const f = list?.[0];
    if (!f) return;
    const foto = f.type === "image/jpeg" || f.type === "image/png";
    const video = f.type === "video/mp4";
    let pesan = "";
    if (!foto && !video) pesan = `${f.name} bukan foto JPEG/PNG atau video MP4.`;
    else if (foto && f.size > MAX_FOTO) pesan = `${f.name} lebih dari 2 MB.`;
    else if (video && f.size > MAX_VIDEO) pesan = `${f.name} lebih dari 16 MB.`;
    setError(pesan);
    if (pesan) {
      if (ref.current) ref.current.value = "";
      setFile(null);
      return;
    }
    const dt = new DataTransfer();
    dt.items.add(f);
    if (ref.current) ref.current.files = dt.files;
    setFile(f);
  }

  return (
    <div>
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); accept(e.dataTransfer.files); }}
        onClick={() => ref.current?.click()}
        className="cursor-pointer rounded-xl border-2 border-dashed border-slate-300 p-5 text-center text-sm hover:border-green-500"
      >
        <p className="font-medium">Seret & lepas file di sini, atau <span className="text-green-700 underline">pilih file</span></p>
        <p className="mt-1 text-xs text-slate-500">Foto JPEG/PNG maksimal 2 MB, atau video MP4 maksimal 16 MB</p>
        <input ref={ref} type="file" name={name} accept="image/jpeg,image/png,video/mp4" hidden onChange={(e) => accept(e.target.files)} />
      </div>
      {file && <p className="mt-2 text-xs text-slate-600">Siap diunggah: {file.name} ({(file.size / 1024 / 1024).toFixed(1)} MB)</p>}
      {error && <p role="alert" className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
