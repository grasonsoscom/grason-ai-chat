"use client";

import { useEffect, useState } from "react";

/** Shows the webhook callback URL for this deployment with a copy button. */
export function CallbackUrl() {
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => setUrl(`${window.location.origin}/api/webhooks/whatsapp`), []);
  return (
    <div className="flex items-center gap-2">
      <code className="flex-1 truncate rounded bg-white px-2 py-1 text-xs ring-1 ring-slate-200">{url}</code>
      <button type="button" className="btn btn-secondary px-2 py-1 text-xs"
        onClick={() => { void navigator.clipboard.writeText(url).then(() => setCopied(true)); }}>
        {copied ? "Tersalin" : "Salin"}
      </button>
    </div>
  );
}
