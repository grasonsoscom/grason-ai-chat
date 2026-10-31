// Minimal fetch mock for the OMS OpenAPI operations. Tests assert the exact
// method/path/body so the client cannot drift from cs-ai.v1.yaml unnoticed.
import { vi } from "vitest";

export type OmsCall = {
  method: string;
  url: string;
  path: string;
  headers: Record<string, string>;
  body?: unknown;
};

export function mockOms(handler: (call: OmsCall) => Response | Promise<Response>) {
  const calls: OmsCall[] = [];

  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const parsed = new URL(url);
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });

    const call: OmsCall = {
      method: init?.method ?? "GET",
      url,
      path: parsed.pathname + parsed.search,
      headers,
      ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
    };
    calls.push(call);
    return handler(call);
  });

  return calls;
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
