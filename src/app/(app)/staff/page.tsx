import Link from "next/link";
import type { Group, Role, User } from "@prisma/client";
import { ActionButton, ActionForm, Modal, SubmitButton } from "@/components/forms";
import { Badge, Field, PageHeader, Table, Tabs } from "@/components/ui";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { deleteGroup, deleteRole, deleteStaff, saveGroup, saveRole, saveStaff } from "./actions";

const MODULES = ["pesan", "pelanggan", "kalender", "whatsapp", "produk", "funnels", "broadcast", "audience", "staff", "ai-agent", "integrasi"];

export default async function StaffPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const tab = (await searchParams).tab ?? "staff";
  const [users, roles, groups] = await Promise.all([
    db.user.findMany({ include: { role: true, group: true }, orderBy: { createdAt: "asc" } }),
    db.role.findMany({ include: { _count: { select: { users: true } } } }),
    db.group.findMany({ include: { _count: { select: { users: true } } } }),
  ]);

  return (
    <div>
      <PageHeader title="Staff" actions={tab === "staff" && <Modal trigger="+ Tambah Staff" title="Tambah Staff"><StaffForm roles={roles} groups={groups} /></Modal>} />
      <Tabs active={tab} tabs={[
        { key: "staff", label: "Staff", href: "/staff" },
        { key: "grup", label: "Grup", href: "/staff?tab=grup" },
        { key: "peran", label: "Manajemen Peran", href: "/staff?tab=peran" },
      ]} />


      {tab === "staff" && (
        <Table head={["Name", "Phone", "Email", "Role", "Member Group", "Status", "Date Created", "Date Updated", ""]}>
          {users.map((u) => (
            <tr key={u.id}>
              <td className="px-4 py-3 font-medium">{u.name}</td>
              <td className="px-4 py-3">{u.phone || "-"}</td>
              <td className="px-4 py-3">{u.email}</td>
              <td className="px-4 py-3">{u.role.name}</td>
              <td className="px-4 py-3">{u.group?.name ?? "-"}</td>
              <td className="px-4 py-3"><Badge tone={u.status === "active" ? "green" : "slate"}>{u.status}</Badge></td>
              <td className="px-4 py-3 text-slate-500">{formatDate(u.createdAt)}</td>
              <td className="px-4 py-3 text-slate-500">{formatDate(u.updatedAt)}</td>
              <td className="whitespace-nowrap px-4 py-3">
                <Modal trigger="✏️" title="Edit Staff" triggerClass="btn btn-ghost text-sm"><StaffForm user={u} roles={roles} groups={groups} /></Modal>
                <ActionButton action={deleteStaff} fields={{ id: u.id }} confirm={`Hapus staf ${u.name}?`}>🗑️</ActionButton>
                <Link href="/kalender" className="btn btn-ghost text-sm" title="Kalender">📅</Link>
              </td>
            </tr>
          ))}
        </Table>
      )}

      {tab === "grup" && (
        <div className="max-w-xl space-y-4">
          <ActionForm action={saveGroup} resetOnSuccess className="flex items-end gap-2">
            <div className="flex-1"><Field label="Grup baru"><input name="name" required className="input" /></Field></div>
            <div className="mb-3"><SubmitButton>Tambah</SubmitButton></div>
          </ActionForm>
          <Table head={["Nama Grup", "Anggota", ""]} empty={groups.length === 0}>
            {groups.map((g) => (
              <tr key={g.id}>
                <td className="px-4 py-3 font-medium">{g.name}</td>
                <td className="px-4 py-3">{g._count.users}</td>
                <td className="px-4 py-3 text-right"><ActionButton action={deleteGroup} fields={{ id: g.id }} confirm={`Hapus grup ${g.name}?`}>🗑️</ActionButton></td>
              </tr>
            ))}
          </Table>
        </div>
      )}

      {tab === "peran" && (
        <div className="space-y-4">
          <Modal trigger="+ Tambah Peran" title="Tambah Peran"><RoleForm /></Modal>
          <Table head={["Peran", "Deskripsi", "Akses Modul", "Staf", ""]}>
            {roles.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-3 font-medium">{r.name}</td>
                <td className="px-4 py-3">{r.description}</td>
                <td className="px-4 py-3 text-xs text-slate-600">{r.permissions === "all" ? "Semua modul" : r.permissions.split(",").filter(Boolean).join(", ") || "-"}</td>
                <td className="px-4 py-3">{r._count.users}</td>
                <td className="whitespace-nowrap px-4 py-3">
                  <Modal trigger="✏️" title="Edit Peran" triggerClass="btn btn-ghost text-sm"><RoleForm role={r} /></Modal>
                  {r.name !== "Admin" && <ActionButton action={deleteRole} fields={{ id: r.id }} confirm={`Hapus peran ${r.name}?`}>🗑️</ActionButton>}
                </td>
              </tr>
            ))}
          </Table>
          <p className="text-xs text-slate-500">Catatan: akses modul per peran saat ini dicatat, tetapi pembatasan halaman baru diterapkan untuk aksi khusus Admin.</p>
        </div>
      )}
    </div>
  );
}

function StaffForm({ user, roles, groups }: { user?: User; roles: Role[]; groups: Group[] }) {
  return (
    <ActionForm action={saveStaff}>
      {user && <input type="hidden" name="id" value={user.id} />}
      <Field label="Nama *"><input name="name" required defaultValue={user?.name} className="input" /></Field>
      <Field label="Email *" hint="Staf masuk dengan Google memakai email ini (harus akun Google / Gmail).">
        <input name="email" type="email" required defaultValue={user?.email} className="input" />
      </Field>
      <Field label="Telepon"><input name="phone" defaultValue={user?.phone} className="input" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Peran"><select name="roleId" defaultValue={user?.roleId} className="input">{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
        <Field label="Grup"><select name="groupId" defaultValue={user?.groupId ?? ""} className="input"><option value="">-</option>{groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>
      </div>
      <Field label="Status"><select name="status" defaultValue={user?.status ?? "active"} className="input"><option value="active">active</option><option value="inactive">inactive</option></select></Field>
      <Field label={user ? "Kata sandi baru (opsional)" : "Kata sandi (opsional)"} hint={user ? "Kosongkan jika tidak diubah. Minimal 8 karakter." : "Kosongkan jika staf hanya masuk dengan Google. Minimal 8 karakter."}>
        <input name="password" type="password" autoComplete="new-password" className="input" />
      </Field>
      <SubmitButton>Simpan</SubmitButton>
    </ActionForm>
  );
}

function RoleForm({ role }: { role?: Role }) {
  const has = new Set(role?.permissions.split(","));
  const isAdmin = role?.name === "Admin";
  return (
    <ActionForm action={saveRole}>
      {role && <input type="hidden" name="id" value={role.id} />}
      <Field label="Nama peran *"><input name="name" required defaultValue={role?.name} readOnly={isAdmin} className="input" /></Field>
      <Field label="Deskripsi"><input name="description" defaultValue={role?.description} className="input" /></Field>
      {!isAdmin && (
        <fieldset className="mb-4">
          <legend className="mb-1 text-sm font-medium text-slate-700">Akses modul</legend>
          <div className="grid grid-cols-2 gap-1">
            {MODULES.map((m) => <label key={m} className="flex items-center gap-2 text-sm"><input type="checkbox" name="permissions" value={m} defaultChecked={has.has(m)} />{m}</label>)}
          </div>
        </fieldset>
      )}
      <SubmitButton>Simpan</SubmitButton>
    </ActionForm>
  );
}
