import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isValidService } from "@/lib/prospect/intake-lifecycle";
import { buildOnboardingPdfModel, onboardingPdfFilename } from "@/lib/onboarding-pdf";
import { renderOnboardingPdf } from "@/lib/onboarding-pdf-render";

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

  if (!sub || !client) {
    return new NextResponse("Not found", { status: 404 });
  }

  const model = buildOnboardingPdfModel({
    service,
    data: sub.data,
    businessName: client.name,
    status: sub.status,
    submittedAt: sub.submitted_at,
  });

  // Export is based on actual content, not submit-state: no answers → nothing to
  // export (avoids an empty PDF); a filled draft (in_progress) IS exportable.
  if (!model.presented.hasContent) {
    return new NextResponse("Not found", { status: 404 });
  }

  const bytes = await renderOnboardingPdf(model);
  const filename = onboardingPdfFilename(client.name, model.meta.serviceName);

  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
