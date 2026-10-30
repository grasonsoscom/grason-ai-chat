import Link from "next/link";
import { AuthNotice, GoogleButton } from "../login/google";

export default async function DaftarPage({ searchParams }: { searchParams: Promise<{ error?: string; status?: string }> }) {
  const { error, status } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-green-50 to-slate-100 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-lg">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-green-600 text-xl font-bold text-white">G</div>
          <h1 className="text-xl font-semibold">Daftar ke GrasOn AI Chat</h1>
          <p className="mt-1 text-sm text-slate-500">Daftar dengan akun Google. Akun baru aktif setelah disetujui admin.</p>
        </div>
        <AuthNotice code={error ?? status} />
        {status !== "registered" && <GoogleButton mode="signup">Daftar dengan Google</GoogleButton>}
        <p className="mt-6 text-center text-sm text-slate-500">
          Sudah punya akun? <Link href="/login" className="font-medium text-green-700 hover:underline">Masuk</Link>
        </p>
      </div>
    </main>
  );
}
