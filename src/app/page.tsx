import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { allowedModules } from "@/lib/permissions";

/** Opens the first module the user's role may access. */
export default async function Home() {
  const user = await requireUser();
  const first = allowedModules(user.role)[0];
  redirect(first ? `/${first}` : "/akses-ditolak");
}
