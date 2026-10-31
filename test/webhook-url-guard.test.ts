import { createServer, type Server } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  assertSafeWebhookUrl,
  isBlockedAddress,
  safePost,
  UnsafeWebhookUrlError,
} from "@/lib/webhooks/url-guard";

afterEach(() => {
  delete process.env.WEBHOOK_ALLOW_PRIVATE_URLS;
});

describe("isBlockedAddress", () => {
  it.each([
    "127.0.0.1",
    "127.1.2.3",
    "10.0.0.5",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "255.255.255.255",
    "::1",
    "::",
    "fd00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "64:ff9b::7f00:1",
  ])("blocks %s", (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it.each(["8.8.8.8", "167.71.166.171", "172.32.0.1", "2606:4700::1111"])("allows %s", (ip) => {
    expect(isBlockedAddress(ip)).toBe(false);
  });

  it("treats non-IP input as blocked", () => {
    expect(isBlockedAddress("localhost")).toBe(true);
  });
});

describe("assertSafeWebhookUrl", () => {
  it.each([
    "http://127.0.0.1:3001/api/v1/orders",
    "http://localhost:2019/stop",
    "http://api.localhost/x",
    "http://[::1]:5433/",
    "http://169.254.169.254/latest/meta-data/",
    "http://10.1.2.3/hook",
  ])("rejects internal URL %s", async (url) => {
    await expect(assertSafeWebhookUrl(url)).rejects.toBeInstanceOf(UnsafeWebhookUrlError);
  });

  it("rejects non-http schemes and embedded credentials", async () => {
    await expect(assertSafeWebhookUrl("file:///etc/passwd")).rejects.toBeInstanceOf(UnsafeWebhookUrlError);
    await expect(assertSafeWebhookUrl("https://user:pw@8.8.8.8/")).rejects.toBeInstanceOf(UnsafeWebhookUrlError);
  });

  it("accepts a public IP URL", async () => {
    await expect(assertSafeWebhookUrl("https://8.8.8.8/hook")).resolves.toBe("https://8.8.8.8/hook");
  });

  it("allows private URLs only with the dev override", async () => {
    process.env.WEBHOOK_ALLOW_PRIVATE_URLS = "true";
    await expect(assertSafeWebhookUrl("http://127.0.0.1:4011/hook")).resolves.toBe("http://127.0.0.1:4011/hook");
  });
});

describe("safePost", () => {
  let server: Server;
  let port = 0;
  let hits = 0;

  beforeAll(async () => {
    server = createServer((req, res) => {
      hits += 1;
      if (req.url === "/redirect") {
        res.writeHead(302, { Location: "http://127.0.0.1:1/elsewhere" }).end();
        return;
      }
      res.writeHead(204).end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as { port: number }).port;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("refuses to connect to loopback", async () => {
    const before = hits;
    await expect(safePost(`http://127.0.0.1:${port}/hook`, {}, "{}", 2000)).rejects.toBeInstanceOf(
      UnsafeWebhookUrlError,
    );
    await expect(safePost(`http://localhost:${port}/hook`, {}, "{}", 2000)).rejects.toBeInstanceOf(
      UnsafeWebhookUrlError,
    );
    expect(hits).toBe(before);
  });

  it("delivers with the override and does not follow redirects", async () => {
    process.env.WEBHOOK_ALLOW_PRIVATE_URLS = "true";
    await expect(safePost(`http://127.0.0.1:${port}/hook`, {}, "{}", 2000)).resolves.toEqual({ status: 204 });
    await expect(safePost(`http://127.0.0.1:${port}/redirect`, {}, "{}", 2000)).resolves.toEqual({ status: 302 });
  });
});
