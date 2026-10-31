import Link from "next/link";
import { Badge, Card, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import {
  API_EVENT_REFERENCE,
  API_GROUPS,
  API_SCOPE_REFERENCE,
  ERROR_REFERENCE,
  QUICKSTART,
  apiBaseUrl,
} from "@/lib/api/docs";

const METHOD_TONE = {
  GET: "green",
  POST: "blue",
  PATCH: "amber",
  DELETE: "red",
} as const;

export default async function ApiDocsPage() {
  const user = await requireUser();
  const baseUrl = apiBaseUrl();
  const isAdmin = user.role.name === "Admin";

  const eventGroups = new Map<string, typeof API_EVENT_REFERENCE>();
  for (const event of API_EVENT_REFERENCE) {
    if (!event.subscribable) continue;
    const list = eventGroups.get(event.group) ?? [];
    list.push(event);
    eventGroups.set(event.group, list);
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="REST API Documentation"
        subtitle="A REST API for contacts, segments, campaigns, messaging, conversations, webhooks, AI, wallet and analytics."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/api/v1/openapi.json" target="_blank" rel="noreferrer" className="btn btn-secondary">
              OpenAPI document
            </Link>
            {isAdmin && (
              <Link href="/developer/api-tokens" className="btn btn-primary">
                Manage Tokens
              </Link>
            )}
          </div>
        }
      />

      <Card>
        <p className="text-sm text-slate-600">
          Base URL: <code className="rounded bg-slate-100 px-1 break-all">{baseUrl}</code>
        </p>
        <p className="mt-2 text-sm text-slate-600">
          Authenticate with a personal access token from{" "}
          {isAdmin ? (
            <Link href="/developer/api-tokens" className="text-green-700 underline">API Tokens</Link>
          ) : (
            "the Admin API Tokens page"
          )}
          . Every request needs <code className="rounded bg-slate-100 px-1">Authorization: Bearer &lt;token&gt;</code>.
        </p>
      </Card>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Quick Start</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {QUICKSTART.map((item) => (
            <Card key={item.title}>
              <p className="mb-2 font-medium">{item.title}</p>
              <pre className="overflow-x-auto rounded-lg bg-slate-950 p-3 text-xs leading-relaxed text-slate-100">
                {item.curl.replaceAll("{base_url}", baseUrl)}
              </pre>
            </Card>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Authentication & scopes</h2>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Scope</th>
                <th className="px-4 py-3 font-medium">Grants access to</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              <tr>
                <td className="px-4 py-3"><code>*</code></td>
                <td className="px-4 py-3 text-slate-600">Every endpoint, including token management.</td>
              </tr>
              {API_SCOPE_REFERENCE.map((scope) => (
                <tr key={scope.key}>
                  <td className="px-4 py-3"><code>{scope.key}</code></td>
                  <td className="px-4 py-3 text-slate-600">{scope.label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          A scoped token cannot create a wider token. Token management requires <code>*</code>.
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <Card>
          <h2 className="mb-2 text-lg font-semibold">Pagination</h2>
          <p className="text-sm text-slate-600">
            Lists accept <code className="rounded bg-slate-100 px-1">?page=</code> and return{" "}
            <code className="rounded bg-slate-100 px-1">meta.current_page</code>,{" "}
            <code className="rounded bg-slate-100 px-1">meta.last_page</code>,{" "}
            <code className="rounded bg-slate-100 px-1">meta.total</code> and{" "}
            <code className="rounded bg-slate-100 px-1">links.next</code>. Page size is 25 (50 for messages and recipients).
            Timestamps are ISO 8601 UTC.
          </p>
        </Card>
        <Card>
          <h2 className="mb-2 text-lg font-semibold">Rate limits</h2>
          <p className="text-sm text-slate-600">
            60 requests per minute per token. Over the limit you get HTTP 429 with a{" "}
            <code className="rounded bg-slate-100 px-1">Retry-After</code> header. The limiter is in-memory per
            server instance.
          </p>
        </Card>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Errors</h2>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">HTTP</th>
                <th className="px-4 py-3 font-medium">Meaning</th>
                <th className="px-4 py-3 font-medium">Body</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {ERROR_REFERENCE.map((error) => (
                <tr key={error.status}>
                  <td className="px-4 py-3 font-mono">{error.status}</td>
                  <td className="px-4 py-3 text-slate-600">{error.meaning}</td>
                  <td className="px-4 py-3">
                    <pre className="max-w-md overflow-x-auto rounded bg-slate-50 p-2 text-xs">
                      {JSON.stringify(error.body, null, 2)}
                    </pre>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Webhook signatures</h2>
        <Card>
          <p className="text-sm text-slate-600">
            Each delivery is a JSON POST with <code className="rounded bg-slate-100 px-1">X-Webhook-Event</code> and{" "}
            <code className="rounded bg-slate-100 px-1">X-Webhook-Signature: t=&lt;unix&gt;,v1=&lt;signature&gt;</code>.
            The signature is HMAC-SHA256 of <code>t + "." + raw_request_body</code>, keyed with the endpoint secret
            (<code>whsec_…</code>) and hex encoded. Reject deliveries whose timestamp is more than a few minutes old.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[...eventGroups.entries()].map(([group, events]) => (
              <div key={group}>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{group}</p>
                <div className="flex flex-wrap gap-1">
                  {events.map((event) => (
                    <Badge key={event.key} tone="slate">{event.key}</Badge>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Endpoints</h2>
        <div className="space-y-6">
          {API_GROUPS.map((group) => (
            <Card key={group.key}>
              <h3 className="font-semibold">{group.title}</h3>
              <p className="mb-3 text-sm text-slate-500">{group.description}</p>
              <div className="space-y-2">
                {group.endpoints.map((endpoint) => (
                  <div key={`${endpoint.method}-${endpoint.path}`} className="rounded-lg border border-slate-100">
                    <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                      <Badge tone={METHOD_TONE[endpoint.method]}>{endpoint.method}</Badge>
                      <code className="text-sm">{baseUrl}{endpoint.path}</code>
                      {endpoint.scope && <Badge tone="purple">{endpoint.scope}</Badge>}
                      <span className="text-sm text-slate-600">{endpoint.summary}</span>
                    </div>
                    {Boolean(endpoint.request || endpoint.response) && (
                      <details className="border-t border-slate-100 px-3 py-2">
                        <summary className="cursor-pointer text-xs text-slate-500">Example request/response</summary>
                        <div className="mt-2 grid gap-2 md:grid-cols-2">
                          {Boolean(endpoint.request) && (
                            <div>
                              <p className="mb-1 text-xs font-medium text-slate-500">Request</p>
                              <pre className="overflow-x-auto rounded bg-slate-50 p-2 text-xs">
                                {JSON.stringify(endpoint.request, null, 2)}
                              </pre>
                            </div>
                          )}
                          {Boolean(endpoint.response) && (
                            <div>
                              <p className="mb-1 text-xs font-medium text-slate-500">Response</p>
                              <pre className="overflow-x-auto rounded bg-slate-50 p-2 text-xs">
                                {JSON.stringify(endpoint.response, null, 2)}
                              </pre>
                            </div>
                          )}
                        </div>
                      </details>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      </section>

      <Card>
        <p className="text-sm text-slate-600">
          Not available in this build: social publishing, automations, mobile agent endpoints, and rule-based
          segments. Contact the GrasOn team if you need one of them.
        </p>
      </Card>
    </div>
  );
}
