// SSRF guard for outbound webhooks. Webhook URLs are user-supplied, and this
// app shares a host with the OMS API, Postgres, Redis and Caddy, so deliveries
// must never reach loopback, private, link-local or metadata addresses.
//
// Checked twice: when a URL is saved (friendly error) and on every delivery,
// where the resolved IP is checked inside the socket's DNS lookup so a
// DNS-rebinding host cannot pass the first check and then point at 127.0.0.1.
// Redirects are never followed.
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { lookup as dnsLookupAsync } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";

const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, cloud metadata
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15], // benchmarking
  ["224.0.0.0", 3], // multicast + reserved, up to 255.255.255.255
] as const) {
  blocked.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96], // NAT64 can embed private IPv4
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
] as const) {
  blocked.addSubnet(net, prefix, "ipv6");
}

/** Local dev and smoke tests deliver to 127.0.0.1; never set this in production. */
function privateAllowed() {
  return process.env.WEBHOOK_ALLOW_PRIVATE_URLS === "true";
}

export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blocked.check(address, "ipv4");
  if (family === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    if (mapped) return blocked.check(mapped[1], "ipv4");
    return blocked.check(address, "ipv6");
  }
  return true; // not an IP: refuse rather than guess
}

export class UnsafeWebhookUrlError extends Error {}

const BLOCKED_MESSAGE =
  "URL webhook tidak boleh mengarah ke localhost, jaringan privat, atau alamat internal.";

function hostOf(url: URL) {
  // URL keeps IPv6 literals in brackets.
  return url.hostname.replace(/^\[|\]$/g, "");
}

/** Parses and checks a webhook URL before it is saved. Returns the normalized URL. */
export async function assertSafeWebhookUrl(raw: string): Promise<string> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeWebhookUrlError("URL webhook harus diawali http:// atau https:// dan valid.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeWebhookUrlError("URL webhook harus diawali http:// atau https:// dan valid.");
  }
  if (url.username || url.password) {
    throw new UnsafeWebhookUrlError("URL webhook tidak boleh berisi username atau password.");
  }
  if (privateAllowed()) return url.toString();

  const host = hostOf(url);
  if (host.toLowerCase() === "localhost" || host.toLowerCase().endsWith(".localhost")) {
    throw new UnsafeWebhookUrlError(BLOCKED_MESSAGE);
  }
  let addresses: string[];
  if (isIP(host)) {
    addresses = [host];
  } else {
    try {
      addresses = (await dnsLookupAsync(host, { all: true })).map((a) => a.address);
    } catch {
      throw new UnsafeWebhookUrlError("Domain URL webhook tidak ditemukan.");
    }
  }
  if (!addresses.length || addresses.some(isBlockedAddress)) {
    throw new UnsafeWebhookUrlError(BLOCKED_MESSAGE);
  }
  return url.toString();
}

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

/** DNS lookup for sockets that refuses blocked addresses after resolution. */
function guardedLookup(hostname: string, options: { all?: boolean }, callback: LookupCallback) {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, []);
    if (!addresses.length || addresses.some((a) => isBlockedAddress(a.address))) {
      return callback(Object.assign(new Error(BLOCKED_MESSAGE), { code: "EBLOCKED" }), []);
    }
    if (options.all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
}

export type SafePostResult = { status: number };

/**
 * POSTs a body to a webhook URL with the SSRF guard applied at connect time.
 * Does not follow redirects (a 3xx is returned as the status).
 */
export function safePost(
  rawUrl: string,
  headers: Record<string, string>,
  body: string,
  timeoutMs: number,
): Promise<SafePostResult> {
  return new Promise((resolve, reject) => {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return reject(new UnsafeWebhookUrlError("URL webhook tidak valid."));
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return reject(new UnsafeWebhookUrlError("URL webhook harus http atau https."));
    }
    const host = hostOf(url);
    const allowPrivate = privateAllowed();
    if (!allowPrivate) {
      const lower = host.toLowerCase();
      // IP literals skip DNS lookup entirely, so check them here.
      if (lower === "localhost" || lower.endsWith(".localhost") || (isIP(host) && isBlockedAddress(host))) {
        return reject(new UnsafeWebhookUrlError(BLOCKED_MESSAGE));
      }
    }

    const client = url.protocol === "https:" ? https : http;
    const req = client.request(
      url,
      {
        method: "POST",
        headers: { ...headers, "Content-Length": Buffer.byteLength(body).toString() },
        lookup: allowPrivate ? undefined : (guardedLookup as unknown as typeof dnsLookup),
        timeout: timeoutMs,
      },
      (res) => {
        res.resume(); // response body is not used
        res.on("end", () => resolve({ status: res.statusCode ?? 0 }));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error(`Timeout setelah ${timeoutMs} ms`)));
    req.on("error", (e) =>
      reject((e as NodeJS.ErrnoException).code === "EBLOCKED" ? new UnsafeWebhookUrlError(e.message) : e),
    );
    req.end(body);
  });
}
