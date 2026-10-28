// WhatsApp Hub and QR login keep a Baileys socket open for minutes, which needs one
// long-running Node process. Serverless hosts (Vercel) don't keep one, so they're off there.
export const hubSupported = !process.env.VERCEL;

export const HUB_UNAVAILABLE =
  "WhatsApp Hub dan login QR tidak tersedia di hosting ini (butuh server yang selalu menyala). Pakai WhatsApp Cloud API resmi atau login dengan email.";
