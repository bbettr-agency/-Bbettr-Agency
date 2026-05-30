import type { Metadata } from "next";
import { ClipboardList } from "lucide-react";
import { requireClient } from "@/lib/auth";
import { getClientServices, getOnboarding } from "@/lib/queries";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { OnboardingTabs } from "@/components/onboarding/onboarding-tabs";

export const metadata: Metadata = { title: "Onboarding" };

export default async function OnboardingPage() {
  const profile = await requireClient();
  const [services, submissions] = await Promise.all([
    getClientServices(profile.client_id),
    getOnboarding(profile.client_id),
  ]);

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Onboarding"
        description="Tell us what we need to get your services up and running. Only the services you purchased appear here."
      />

      {services.length > 0 ? (
        <OnboardingTabs
          clientId={profile.client_id}
          services={services.map((s) => ({
            service: s.service,
            onboarding_status: s.onboarding_status,
          }))}
          submissions={submissions}
        />
      ) : (
        <EmptyState
          icon={ClipboardList}
          title="No services to onboard yet"
          description="Once your Bbettr Agency team adds your services, your tailored onboarding forms will appear here."
        />
      )}
    </div>
  );
}
