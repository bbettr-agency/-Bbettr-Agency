import { requireAdmin } from "@/lib/auth";
import { AppShell } from "@/components/layout/app-shell";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireAdmin();

  return (
    <AppShell
      roleLabel="Admin"
      context="Bbettr Agency · Administrator"
      user={{
        name: profile.full_name ?? "Admin",
        email: profile.email ?? "",
        avatarUrl: profile.avatar_url,
      }}
    >
      {children}
    </AppShell>
  );
}
