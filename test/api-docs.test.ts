import { describe, expect, it } from "vitest";
import {
  API_EVENT_REFERENCE,
  API_GROUPS,
  API_SCOPE_REFERENCE,
  openApiDocument,
} from "@/lib/api/docs";
import { SCOPE_KEYS } from "@/lib/api/scopes";
import { eventMatches, webhookEventGroups } from "@/lib/webhooks/events";

describe("api documentation", () => {
  const endpoints = API_GROUPS.flatMap((group) => group.endpoints);

  it("has unique method+path endpoints with summaries", () => {
    const keys = endpoints.map((endpoint) => `${endpoint.method} ${endpoint.path}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const endpoint of endpoints) expect(endpoint.summary.trim().length).toBeGreaterThan(0);
  });

  it("only uses known scopes (or no scope)", () => {
    for (const endpoint of endpoints) {
      if (endpoint.scope) expect(endpoint.scope === "*" || SCOPE_KEYS.has(endpoint.scope)).toBe(true);
    }
    for (const scope of API_SCOPE_REFERENCE) expect(SCOPE_KEYS.has(scope.key)).toBe(true);
  });

  it("builds a valid OpenAPI document", () => {
    const document = openApiDocument("https://example.com/api/v1");
    expect(document.openapi).toBe("3.1.0");
    expect(document.servers[0]?.url).toBe("https://example.com/api/v1");
    expect(document.components.securitySchemes.bearerAuth).toMatchObject({ type: "http", scheme: "bearer" });
    expect(Object.keys(document.paths)).toContain("/contacts");
    expect(document.paths["/contacts"]?.get).toBeDefined();
    expect(document.paths["/contacts"]?.post).toBeDefined();
  });

  it("lists unique webhook events and excludes test.ping from subscriptions", () => {
    const keys = API_EVENT_REFERENCE.map((event) => event.key);
    expect(new Set(keys).size).toBe(keys.length);
    const groups = webhookEventGroups();
    const grouped = groups.flatMap((group) => group.events.map((event) => event.key));
    expect(grouped).not.toContain("test.ping");
    expect(grouped).toContain("contact.created");
  });

  it("treats an empty subscription as all events", () => {
    expect(eventMatches("", "contact.created")).toBe(true);
    expect(eventMatches("", "campaign.completed")).toBe(true);
    expect(eventMatches("contact.created", "contact.created")).toBe(true);
    expect(eventMatches("contact.created", "message.sent")).toBe(false);
  });
});
