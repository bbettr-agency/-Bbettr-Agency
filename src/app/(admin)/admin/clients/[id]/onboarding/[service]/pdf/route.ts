import { createElement } from "react";
import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isValidService } from "@/lib/prospect/intake-lifecycle";
import {
  buildOnboardingPdfModel,
  isDownloadableOnboardingStatus,
  onboardingPdfFilename,
} from "@/lib/onboarding-pdf";
import { OnboardingPdfDocument } from "@/components/pdf/onboarding-pdf-document";

/**
 * Admin-only onboarding PDF export. Not a public/permanent URL: it requires an
 * authenticated ADMIN session (checked here) AND is read through the
 * authenticated Supabase client, so RLS is the enforced boundary — a
 * client-supplied id/service alone grants nothing. Only submitted/approved
 * onboarding can be exported. Streams the PDF as a download; nothing is persisted.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; service: string }> }
) {
  const { id, service } = await params;

  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "admin") {
    return new NextResponse("Forbidden", { status: 403 });
  }
  if (!isValidService(service)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const supabase = await createClient();
  const [{ data: sub }, { data: client }] = await Promise.all([
    supabase
      .from("onboarding_submissions")
      .select("service, data, status, submitted_at")
      .eq("client_id", id)
      .eq("service", service)
      .maybeSingle(),
    supabase.from("clients").select("name").eq("id", id).maybeSingle(),
  ]);

  if (!sub || !client || !isDownloadableOnboardingStatus(sub.status)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const model = buildOnboardingPdfModel({
    service,
    data: sub.data,
    businessName: client.name,
    status: sub.status,
    submittedAt: sub.submitted_at,
  });

  // OnboardingPdfDocument returns a <Document>; cast to renderToBuffer's expected
  // element type (react-pdf types the arg as the Document element specifically).
  const element = createElement(OnboardingPdfDocument, { model }) as unknown as Parameters<
    typeof renderToBuffer
  >[0];
  const buffer = await renderToBuffer(element);
  const filename = onboardingPdfFilename(client.name, model.meta.serviceName);

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
