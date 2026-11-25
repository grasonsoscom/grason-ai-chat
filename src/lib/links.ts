/**
 * Link detection for inbound messages.
 *
 * A new lead/customer who writes a link other than the official Shopee page must be
 * answered by a human: `recordInbound` (messaging.ts) turns the Agen AI switch off
 * for that conversation before the AI runs. Pure functions, covered by links.test.ts.
 */

/** Hosts the AI may keep answering. Everything else is a foreign link. */
const ALLOWED_HOSTS = ["vivagoat.com"];

/** Path allowed under those hosts: the official Shopee page. `/` is allowed too. */
const ALLOWED_PATH = "/shopee";

/**
 * Last labels that make "kata.kata" look like a domain instead of a typo ("bagus.banget")
 * or a price ("42.000"). Bare domains are only links when the TLD is listed here.
 */
const TLDS = new Set([
  "com", "net", "org", "id", "co", "io", "me", "ly", "gg", "ai", "app", "dev", "tv",
  "xyz", "info", "biz", "site", "shop", "store", "online", "link", "page", "cloud",
  "live", "my", "sg", "us", "uk", "au", "in", "be", "to", "cc", "ws", "club", "top",
  "pro", "space", "website", "digital", "tech", "media", "news", "one", "vip", "mobi",
  "asia", "edu", "gov", "sch", "name", "art", "blog", "design", "fun", "icu", "life",
  "world", "network", "agency", "global", "group", "company", "center", "so", "sh",
  "click", "sale", "today", "email", "crm",
]);

const SCHEME_RE = /https?:\/\/[^\s<>"'`]+/gi;
const BARE_RE = /\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}\b(?:\/[^\s<>"'`]*)?/gi;

/** Trailing punctuation that belongs to the sentence, not to the URL. */
const TRAILING = /[.,;:!?…'"”’»)\]}]+$/;

function clean(raw: string) {
  return raw.replace(TRAILING, "");
}

function parse(raw: string): URL | null {
  const value = clean(raw).trim();
  if (!value) return null;
  try {
    return new URL(/^https?:\/\//i.test(value) ? value : `http://${value}`);
  } catch {
    return null;
  }
}

/** All links in the text, in order, without duplicates. Explicit URLs always count. */
export function extractLinks(text: string): string[] {
  const found: string[] = [];
  const rest = text.replace(SCHEME_RE, (match) => {
    found.push(clean(match));
    return " ".repeat(match.length);
  });
  for (const match of rest.match(BARE_RE) ?? []) {
    const candidate = clean(match);
    const url = parse(candidate);
    if (!url) continue;
    const tld = url.hostname.toLowerCase().split(".").pop() ?? "";
    if (!TLDS.has(tld)) continue;
    found.push(candidate);
  }
  return [...new Set(found.filter(Boolean))];
}

/** Host without "www." and trailing dot, or null when the text is not a URL. */
export function linkHost(raw: string): string | null {
  const url = parse(raw);
  if (!url) return null;
  return url.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
}

/** Official Shopee page on vivagoat.com (the site root is allowed too). */
export function isAllowedLink(raw: string): boolean {
  const url = parse(raw);
  if (!url) return false;
  const host = url.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  const path = url.pathname.toLowerCase().replace(/\/+$/, "");
  const hostOk = ALLOWED_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
  const pathOk = path === "" || path === ALLOWED_PATH || path.startsWith(`${ALLOWED_PATH}/`);
  return hostOk && pathOk;
}

/** Links the AI must not answer to. Empty when the message has no link at all. */
export function foreignLinks(text: string): string[] {
  return extractLinks(text).filter((link) => !isAllowedLink(link));
}
