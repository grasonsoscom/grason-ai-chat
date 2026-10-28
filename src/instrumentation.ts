// Runs once when the Next.js server starts.
export async function register() {
  // Inline check so the edge build drops this import (Baileys is Node-only).
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Reconnect WhatsApp Hub numbers linked by QR before the first request.
    const { restoreHubSessions } = await import("./lib/wa-hub");
    await restoreHubSessions().catch(() => {});
  }
}
