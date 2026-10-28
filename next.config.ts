import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Baileys (WhatsApp QR login) uses native/Node-only deps; don't bundle it.
  serverExternalPackages: ["baileys", "exceljs"],
  experimental: {
    serverActions: {
      // Product images are capped at 2 MB each; allow a few per request.
      bodySizeLimit: "12mb",
    },
  },
};

export default nextConfig;
