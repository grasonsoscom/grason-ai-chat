import { AccessDenied, PageHeader } from "@/components/ui";

export default function AksesDitolakPage() {
  return (
    <>
      <PageHeader title="Akses ditolak" />
      <AccessDenied message="Peran Anda tidak memiliki akses ke modul ini. Hubungi Admin jika Anda membutuhkannya." />
    </>
  );
}
