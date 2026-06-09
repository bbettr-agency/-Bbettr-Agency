import { requireRep } from "@/lib/auth";
import { AppShell } from "@/components/layout/app-shell";

export default async function RepLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireRep();

  return (
    <AppShell
      roleLabel="Rep"
      context="Sales Rep"
      user={{
        name: profile.full_name ?? "Sales Rep",
        email: profile.email ?? "",
        avatarUrl: profile.avatar_url,
      }}
    >
      {children}
    </AppShell>
  );
}
