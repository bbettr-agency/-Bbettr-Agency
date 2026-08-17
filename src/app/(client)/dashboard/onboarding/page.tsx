import type { Metadata } from "next";
import { ClipboardList, CheckCircle2 } from "lucide-react";
import { requireClient } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  getClientServices,
  getOnboarding,
  isOnboardingComplete,
} from "@/lib/queries";
import { getBillingDetails } from "@/lib/billing-details-queries";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { OnboardingTabs } from "@/components/onboarding/onboarding-tabs";
import { BillingDetailsSection } from "@/components/onboarding/billing-details-section";

export const metadata: Metadata = { title: "Onboarding" };

export default async function OnboardingPage() {
  const profile = await requireClient();
  const supabase = await createClient();
  const [services, submissions, billing, clientRow] = await Promise.all([
    getClientServices(profile.client_id),
    getOnboarding(profile.client_id),
    getBillingDetails(profile.client_id),
    supabase.from("clients").select("contact_email").eq("id", profile.client_id).maybeSingle(),
  ]);

  const complete = isOnboardingComplete(services);
  const contactEmail = clientRow.data?.contact_email ?? null;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Onboarding"
        description="Tell us what we need to get your services up and running. Only the services you purchased appear here."
      />

      {complete && (
        <Card className="border-emerald-200 bg-emerald-50/40">
          <CardContent className="flex items-start gap-3 p-5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500 text-white">
              <CheckCircle2 className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm font-semibold text-ink-900">
                Onboarding Complete
              </p>
              <p className="text-sm text-ink-500">
                Our team is now preparing your project. You can still review your
                answers below.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {services.length > 0 ? (
        <>
          {/* One shared, client-level billing section — NOT per service tab. */}
          <BillingDetailsSection initial={billing} contactEmail={contactEmail} />
          <OnboardingTabs
            clientId={profile.client_id}
            services={services.map((s) => ({
              service: s.service,
              onboarding_status: s.onboarding_status,
            }))}
            submissions={submissions}
          />
        </>
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
