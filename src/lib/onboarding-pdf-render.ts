import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { OnboardingPdfModel } from "./onboarding-pdf";
import type { PresentedRow } from "./onboarding-present";

/**
 * Server-side onboarding PDF renderer (pdf-lib) — pure JS, no external font
 * files, no fontkit; bundles/traces cleanly on Vercel's Node runtime (this is
 * why it replaced @react-pdf/renderer, whose asset tracing failed at first
 * production invocation). Content comes entirely from the shared presenter model,
 * so the document and the on-screen summary never drift.
 */

const A4 = { w: 595.28, h: 841.89 };
const MARGIN = 48;
const RIGHT = A4.w - MARGIN;
const FOOTER_Y = 30;
const BOTTOM = FOOTER_Y + 18; // don't draw body below this

const BRAND = rgb(0.216, 0.714, 1); // #38B6FF
const INK900 = rgb(0.06, 0.09, 0.16);
const INK700 = rgb(0.28, 0.34, 0.44);
const INK500 = rgb(0.45, 0.5, 0.58);
const INK400 = rgb(0.54, 0.58, 0.66);
const INK100 = rgb(0.9, 0.91, 0.94);

/**
 * Make text safe for the WinAnsi StandardFonts (which throw on un-encodable code
 * points). Map common smart punctuation to ASCII, keep Latin-1, replace anything
 * else with "?" so free-text answers can never crash rendering. Source uses \u
 * escapes only (no literal high bytes).
 */
function safe(input: unknown): string {
  return String(input ?? "")
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[•·]/g, "-")
    // Keep tab/LF/CR, ASCII printable, and Latin-1 (U+00A0..U+00FF); drop the
    // undefined CP1252 slots (0x80-0x9F) and anything higher so WinAnsi is safe.
    .replace(/[^\t\n\r\x20-\x7E\xA0-\xFF]/g, "?");
}

function formatDate(iso: string | null): string {
  if (!iso) return "Not provided";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Not provided";
  return d.toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" });
}
function statusLabel(status: string): string {
  return (
    { submitted: "Submitted", approved: "Approved", in_progress: "In progress", not_started: "Not started" }[
      status
    ] ?? status
  );
}

export async function renderOnboardingPdf(model: OnboardingPdfModel): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${safe(model.meta.businessName)} - ${safe(model.meta.serviceName)} Onboarding`);
  doc.setAuthor(safe(model.meta.agency));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;

  function header(p: PDFPage) {
    p.drawText(safe(model.meta.agency), { x: MARGIN, y: A4.h - MARGIN, size: 15, font: bold, color: INK900 });
    const kicker = "ONBOARDING SUMMARY";
    const kw = font.widthOfTextAtSize(kicker, 8);
    p.drawText(kicker, { x: RIGHT - kw, y: A4.h - MARGIN + 3, size: 8, font, color: INK400 });
    const ruleY = A4.h - MARGIN - 8;
    p.drawLine({ start: { x: MARGIN, y: ruleY }, end: { x: RIGHT, y: ruleY }, thickness: 2, color: BRAND });
  }
  function newPage() {
    page = doc.addPage([A4.w, A4.h]);
    pages.push(page);
    header(page);
    y = A4.h - MARGIN - 30; // first baseline below the brand rule
  }
  function ensure(h: number) {
    if (y - h < BOTTOM) newPage();
  }

  // Draw wrapped text from (x, current y as top-of-line). Advances y.
  function paragraph(
    value: string,
    opts: { x?: number; size: number; font: PDFFont; color: ReturnType<typeof rgb>; gap?: number }
  ) {
    const x = opts.x ?? MARGIN;
    const maxW = RIGHT - x;
    const lh = opts.size * 1.4;
    for (const line of wrap(safe(value), opts.font, opts.size, maxW)) {
      ensure(lh);
      page.drawText(line, { x, y: y - opts.size, size: opts.size, font: opts.font, color: opts.color });
      y -= lh;
    }
    if (opts.gap) y -= opts.gap;
  }

  function bulletLines(items: string[], x = MARGIN) {
    const size = 10;
    const lh = size * 1.4;
    for (const item of items) {
      const lines = wrap(safe(item), font, size, RIGHT - x - 12);
      lines.forEach((line, i) => {
        ensure(lh);
        if (i === 0) page.drawCircle({ x: x + 2, y: y - size + 3, size: 1.3, color: INK500 });
        page.drawText(line, { x: x + 10, y: y - size, size, font, color: INK900 });
        y -= lh;
      });
    }
  }

  function rowValue(row: PresentedRow) {
    switch (row.kind) {
      case "email":
      case "tel":
      case "url":
        paragraph(row.text ?? "", { size: 10, font, color: BRAND });
        break;
      case "longtext":
        paragraph(row.text ?? "", { size: 10, font, color: INK900 });
        break;
      case "list":
        bulletLines(row.items ?? []);
        break;
      case "files":
        bulletLines(row.files ?? []);
        break;
      case "group":
        (row.entries ?? []).forEach((entry, i) => {
          if (i > 0) y -= 3;
          for (const sub of entry) {
            paragraph(sub.label, { x: MARGIN + 12, size: 7.5, font, color: INK400 });
            if (sub.kind === "list") bulletLines(sub.items ?? [], MARGIN + 12);
            else if (sub.kind === "files") bulletLines(sub.files ?? [], MARGIN + 12);
            else paragraph(sub.text ?? "", { x: MARGIN + 12, size: 10, font, color: INK900 });
          }
        });
        break;
      default:
        paragraph(row.text ?? "", { size: 10, font, color: INK900 });
    }
  }

  // ── build ───────────────────────────────────────────────────────────────────
  newPage();

  paragraph(model.meta.businessName, { size: 15, font: bold, color: INK900, gap: 6 });
  const metaBits: [string, string][] = [
    ["Service", model.meta.serviceName],
    ["Status", statusLabel(model.meta.status)],
    ["Submitted", formatDate(model.meta.submittedAt)],
  ];
  for (const [label, value] of metaBits) {
    ensure(24);
    page.drawText(safe(label).toUpperCase(), { x: MARGIN, y: y - 8, size: 8, font, color: INK400 });
    page.drawText(safe(value), { x: MARGIN + 90, y: y - 9, size: 10, font, color: INK900 });
    y -= 18;
  }
  y -= 6;

  if (!model.presented.hasContent) {
    paragraph("No onboarding answers were provided.", { size: 10, font, color: INK500 });
  }

  for (const section of model.presented.sections) {
    ensure(46); // keep the heading with at least its first row
    y -= 6;
    paragraph(section.title, { size: 11, font: bold, color: INK900 });
    if (section.description) paragraph(section.description, { size: 8.5, font, color: INK400 });
    ensure(10);
    page.drawLine({ start: { x: MARGIN, y: y - 2 }, end: { x: RIGHT, y: y - 2 }, thickness: 1, color: INK100 });
    y -= 12;

    for (const row of section.rows) {
      ensure(24);
      paragraph(row.label, { size: 8, font, color: INK700 });
      rowValue(row);
      y -= 6;
    }
  }

  // Footers with page numbers (total now known).
  const total = pages.length;
  const footer = `${safe(model.meta.agency)}  ${safe(model.meta.businessName)}  ${safe(model.meta.serviceName)}`;
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: MARGIN, y: FOOTER_Y + 10 }, end: { x: RIGHT, y: FOOTER_Y + 10 }, thickness: 1, color: INK100 });
    p.drawText(footer.slice(0, 120), { x: MARGIN, y: FOOTER_Y, size: 8, font, color: INK400 });
    const pageLabel = `Page ${i + 1} of ${total}`;
    const pw = font.widthOfTextAtSize(pageLabel, 8);
    p.drawText(pageLabel, { x: RIGHT - pw, y: FOOTER_Y, size: 8, font, color: INK400 });
  });

  return doc.save();
}

/** Word-wrap (honours explicit newlines) to a max pixel width for a font/size. */
function wrap(text: string, f: PDFFont, size: number, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    if (para.trim() === "") {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of para.split(/\s+/)) {
      const trial = line ? `${line} ${word}` : word;
      if (f.widthOfTextAtSize(trial, size) <= maxW) {
        line = trial;
      } else {
        if (line) out.push(line);
        if (f.widthOfTextAtSize(word, size) > maxW) {
          let chunk = "";
          for (const ch of word) {
            if (f.widthOfTextAtSize(chunk + ch, size) <= maxW) chunk += ch;
            else {
              if (chunk) out.push(chunk);
              chunk = ch;
            }
          }
          line = chunk;
        } else {
          line = word;
        }
      }
    }
    if (line) out.push(line);
  }
  return out.length ? out : [""];
}
