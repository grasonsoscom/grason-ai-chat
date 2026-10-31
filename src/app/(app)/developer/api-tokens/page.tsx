import { ActionButton, Modal } from "@/components/forms";
import { AccessDenied, Badge, EmptyState, PageHeader, Table } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { SCOPES } from "@/lib/api/scopes";
import { revokeToken } from "./actions";
import { CreateTokenForm } from "./create-token-form";

export default async function ApiTokensPage() {
  const user = await requireUser();
  if (user.role.name !== "Admin") {
    return <AccessDenied message="API Tokens hanya dapat dikelola oleh Admin." />;
  }

  const tokens = await db.apiToken.findMany({
    include: { user: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });
  const baseUrl = `${(process.env.APP_URL ?? "https://<domain>").replace(/\/+$/, "")}/api/v1`;
  const now = Date.now();

  return (
    <div>
      <PageHeader
        title="API Tokens"
        subtitle="Personal access token untuk REST API GrasOn AI Chat."
        actions={
          <Modal trigger="Buat API Token" title="Buat API Token" triggerClass="btn btn-primary" wide>
            <CreateTokenForm />
          </Modal>
        }
      />

      <div className="mb-4 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
        <p>
          Base URL: <code className="rounded bg-slate-100 px-1">{baseUrl}</code>
        </p>
        <p className="mt-1 text-xs text-slate-500">
          Kirim token sebagai <code className="rounded bg-slate-100 px-1">Authorization: Bearer &lt;token&gt;</code>.
          Token hanya ditampilkan sekali saat dibuat.
        </p>
      </div>

      {tokens.length === 0 ? (
        <EmptyState
          title="Belum ada API token"
          description="Buat token pertama untuk menghubungkan aplikasi lain ke GrasOn AI Chat."
          action={
            <Modal trigger="Buat API Token" title="Buat API Token" wide>
              <CreateTokenForm />
            </Modal>
          }
        />
      ) : (
        <Table head={["Nama", "Prefix", "Scopes", "Terakhir dipakai", "Kedaluwarsa", "Dibuat", "Aksi"]}>
          {tokens.map((token) => {
            const scopes = token.scopes.split(",").filter(Boolean);
            const expired = Boolean(token.expiresAt && token.expiresAt.getTime() <= now);
            return (
              <tr key={token.id}>
                <td className="px-4 py-3">
                  <p className="font-medium">{token.name}</p>
                  <p className="text-xs text-slate-400">{token.user.name}</p>
                </td>
                <td className="px-4 py-3">
                  <code className="rounded bg-slate-100 px-1 text-xs">gro_{token.prefix}_…</code>
                </td>
                <td className="px-4 py-3">
                  <div className="flex max-w-xs flex-wrap gap-1">
                    {scopes.map((scope) => (
                      <Badge key={scope} tone={scope === "*" ? "purple" : "slate"}>
                        {scope === "*" ? "Full access" : scope}
                      </Badge>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-500">
                  {token.lastUsedAt ? formatDateTime(token.lastUsedAt) : "Belum pernah"}
                </td>
                <td className="px-4 py-3 text-slate-500">
                  {token.expiresAt ? formatDateTime(token.expiresAt) : "Tidak pernah"}
                </td>
                <td className="px-4 py-3 text-slate-500">{formatDateTime(token.createdAt)}</td>
                <td className="px-4 py-3">
                  {token.revokedAt ? (
                    <Badge tone="red">Dicabut</Badge>
                  ) : expired ? (
                    <Badge tone="amber">Kedaluwarsa</Badge>
                  ) : (
                    <ActionButton
                      action={revokeToken}
                      fields={{ id: token.id }}
                      confirm="Cabut token ini? Aplikasi yang memakainya akan langsung gagal."
                      className="btn btn-ghost text-xs text-red-600"
                    >
                      Cabut
                    </ActionButton>
                  )}
                </td>
              </tr>
            );
          })}
        </Table>
      )}

      <p className="mt-4 text-xs text-slate-500">
        Scopes: {scopesLegend()}.
      </p>
    </div>
  );
}

function scopesLegend() {
  return SCOPES.map((scope) => scope.key).join(" · ");
}
