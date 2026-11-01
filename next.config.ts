import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Baileys (WhatsApp Hub) uses native/Node-only deps; don't bundle it.
  serverExternalPackages: ["baileys", "exceljs"],
  experimental: {
    serverActions: {
      // Product images are capped at 2 MB each; testimonial videos at 16 MB (one per upload).
      bodySizeLimit: "20mb",
    },
  },
};

export default nextConfig;
