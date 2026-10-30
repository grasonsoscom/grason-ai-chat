import { ActionForm, SubmitButton } from "@/components/forms";
import { Field } from "@/components/ui";
import { login } from "./actions";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-green-50 to-slate-100 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-lg">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-green-600 text-xl font-bold text-white">G</div>
          <h1 className="text-xl font-semibold">Masuk ke GrasOn AI Chat</h1>
          <p className="mt-1 text-sm text-slate-500">Masuk dengan email dan kata sandi</p>
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
      </div>
    </main>
  );
}
