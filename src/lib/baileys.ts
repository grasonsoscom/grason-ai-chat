// Shared Baileys (unofficial WhatsApp Web client) setup for WhatsApp Hub.
import makeWASocket, { Browsers, fetchLatestBaileysVersion, useMultiFileAuthState } from "baileys";

type Logger = NonNullable<Parameters<typeof makeWASocket>[0]["logger"]>;

// Baileys logs message metadata (numbers, JIDs); keep it silent per data rules.
const silent: Logger = {
  level: "silent",
  child: () => silent,
  trace() {}, debug() {}, info() {}, warn() {}, error() {},
};

export type WASocket = ReturnType<typeof makeWASocket>;

let versionPromise: ReturnType<typeof fetchLatestBaileysVersion> | null = null;

/** Opens a socket using the multi-file auth state in `dir`. */
export async function openSocket(dir: string) {
  versionPromise ??= fetchLatestBaileysVersion().catch(() => ({ version: undefined, isLatest: false } as never));
  const { version } = await versionPromise;
  const { state, saveCreds } = await useMultiFileAuthState(dir);
  const sock = makeWASocket({
    auth: state,
    version,
    logger: silent,
    browser: Browsers.appropriate("GrasOn AI Chat"),
    syncFullHistory: false,
    markOnlineOnConnect: false,
    shouldSyncHistoryMessage: () => false,
  });
  sock.ev.on("creds.update", saveCreds);
  return sock;
}

export function disconnectCode(err: unknown) {
  return (err as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
}
