import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";

/**
 * Root entry. Routes the authenticated user to the correct surface based on
 * their role. Unauthenticated users are caught by middleware -> /login.
 */
export default async function RootPage() {
  const profile = await getCurrentProfile();

  if (!profile) redirect("/login");
  if (profile.role === "admin") redirect("/admin");
  if (profile.role === "rep") redirect("/rep");
  redirect("/dashboard");
}
