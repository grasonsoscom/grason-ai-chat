import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field } from "@/components/ui";
import { login } from "./actions";
import { AuthNotice, GoogleButton } from "./google";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; status?: string }> }) {
  const { error, status } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-green-50 to-slate-100 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-lg">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-green-600 text-xl font-bold text-white">G</div>
          <h1 className="text-xl font-semibold">Masuk ke GrasOn AI Chat</h1>
          <p className="mt-1 text-sm text-slate-500">Masuk dengan Google atau email</p>
        </div>
        <AuthNotice code={error ?? status} />
        <GoogleButton mode="login">Masuk dengan Google</GoogleButton>
        <div className="my-6 flex items-center gap-3 text-xs text-slate-400">
          <div className="h-px flex-1 bg-slate-200" />atau masuk dengan email<div className="h-px flex-1 bg-slate-200" />
        </div>
        <ActionForm action={login}>
          <Field label="Email">
            <input name="email" type="email" required autoComplete="email" className="input" />
          </Field>
          <Field label="Kata sandi">
            <input name="password" type="password" required autoComplete="current-password" className="input" />
          </Field>
          <SubmitButton className="mt-2 w-full">Masuk</SubmitButton>
        </ActionForm>
        <p className="mt-6 text-center text-sm text-slate-500">
          Belum punya akun? <Link href="/daftar" className="font-medium text-green-700 hover:underline">Daftar</Link>
        </p>
      </div>
    </main>
  );
}
