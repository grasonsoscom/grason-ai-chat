// WhatsApp Hub keeps a Baileys socket open for minutes, which needs one
// long-running Node process. Serverless hosts (Vercel) don't keep one, so they're off there.
export const hubSupported = !process.env.VERCEL;

export const HUB_UNAVAILABLE =
  "WhatsApp Hub tidak tersedia di hosting ini (butuh server yang selalu menyala). Pakai WhatsApp Cloud API resmi.";
