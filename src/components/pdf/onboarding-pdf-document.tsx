import { Document, Page, View, Text, Link, StyleSheet } from "@react-pdf/renderer";
import type { OnboardingPdfModel } from "@/lib/onboarding-pdf";
import type { PresentedRow } from "@/lib/onboarding-present";

/**
 * Professional onboarding PDF (server-rendered via @react-pdf/renderer). Consumes
 * the shared presenter model so it stays in lockstep with the on-screen summary.
 * Clean Helvetica, Bbettr brand accent, sectioned layout, auto page-breaks.
 */

const BRAND = "#38B6FF";
const INK_900 = "#0f1729";
const INK_600 = "#48566f";
const INK_400 = "#8a95a8";
const INK_100 = "#e6e9f0";

const styles = StyleSheet.create({
  page: { paddingTop: 48, paddingBottom: 56, paddingHorizontal: 48, fontFamily: "Helvetica", fontSize: 10, color: INK_900, lineHeight: 1.45 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", paddingBottom: 10, borderBottomWidth: 2, borderBottomColor: BRAND },
  agency: { fontFamily: "Helvetica-Bold", fontSize: 16, color: INK_900 },
  docKind: { fontSize: 9, color: INK_400, textTransform: "uppercase", letterSpacing: 1 },
  title: { fontFamily: "Helvetica-Bold", fontSize: 15, marginTop: 18, color: INK_900 },
  metaGrid: { flexDirection: "row", flexWrap: "wrap", marginTop: 10, marginBottom: 4 },
  metaItem: { width: "50%", marginBottom: 6, paddingRight: 12 },
  metaLabel: { fontSize: 8, color: INK_400, textTransform: "uppercase", letterSpacing: 0.5 },
  metaValue: { fontSize: 10, color: INK_900, marginTop: 1 },
  section: { marginTop: 18 },
  sectionTitle: { fontFamily: "Helvetica-Bold", fontSize: 11, color: INK_900 },
  sectionDesc: { fontSize: 8.5, color: INK_400, marginTop: 1, marginBottom: 6 },
  sectionRule: { borderBottomWidth: 1, borderBottomColor: INK_100, marginTop: 4, marginBottom: 8 },
  rowsWrap: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: "50%", paddingRight: 14, marginBottom: 9 },
  cellFull: { width: "100%", paddingRight: 0, marginBottom: 9 },
  fieldLabel: { fontSize: 8, color: INK_600, marginBottom: 2 },
  value: { fontSize: 10, color: INK_900 },
  longValue: { fontSize: 10, color: INK_900, lineHeight: 1.5 },
  link: { fontSize: 10, color: BRAND, textDecoration: "none" },
  listItem: { fontSize: 10, color: INK_900, marginBottom: 1.5 },
  entry: { borderWidth: 1, borderColor: INK_100, borderRadius: 4, padding: 8, marginBottom: 6 },
  entryLabel: { fontSize: 7.5, color: INK_400, marginBottom: 1 },
  footer: { position: "absolute", bottom: 24, left: 48, right: 48, flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: INK_100, paddingTop: 6 },
  footerText: { fontSize: 8, color: INK_400 },
  empty: { fontSize: 10, color: INK_400, marginTop: 16 },
});

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" });
}
function statusLabel(status: string): string {
  return { submitted: "Submitted", approved: "Approved", in_progress: "In progress", not_started: "Not started" }[status] ?? status;
}

function ValueNode({ row }: { row: PresentedRow }) {
  switch (row.kind) {
    case "email":
      return <Link style={styles.link} src={`mailto:${row.text}`}>{row.text}</Link>;
    case "tel":
      return <Link style={styles.link} src={`tel:${(row.text ?? "").replace(/\s+/g, "")}`}>{row.text}</Link>;
    case "url":
      return (
        <Link style={styles.link} src={/^https?:\/\//i.test(row.text ?? "") ? (row.text as string) : `https://${row.text}`}>
          {row.text}
        </Link>
      );
    case "longtext":
      return <Text style={styles.longValue}>{row.text}</Text>;
    case "list":
      return (
        <View>
          {(row.items ?? []).map((item, i) => (
            <Text key={i} style={styles.listItem}>• {item}</Text>
          ))}
        </View>
      );
    case "files":
      return (
        <View>
          {(row.files ?? []).map((name, i) => (
            <Text key={i} style={styles.listItem}>• {name}</Text>
          ))}
        </View>
      );
    case "group":
      return (
        <View>
          {(row.entries ?? []).map((entry, i) => (
            <View key={i} style={styles.entry} wrap={false}>
              {entry.map((sub, j) => (
                <View key={j} style={{ marginBottom: 3 }}>
                  <Text style={styles.entryLabel}>{sub.label}</Text>
                  <ValueNode row={sub} />
                </View>
              ))}
            </View>
          ))}
        </View>
      );
    default:
      return <Text style={styles.value}>{row.text}</Text>;
  }
}

export function OnboardingPdfDocument({ model }: { model: OnboardingPdfModel }) {
  const { meta, presented } = model;
  return (
    <Document title={`${meta.businessName} — ${meta.serviceName} Onboarding`} author={meta.agency}>
      <Page size="A4" style={styles.page}>
        <View style={styles.headerRow} fixed>
          <Text style={styles.agency}>{meta.agency}</Text>
          <Text style={styles.docKind}>Onboarding Summary</Text>
        </View>

        <Text style={styles.title}>{meta.businessName}</Text>
        <View style={styles.metaGrid}>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>Service</Text>
            <Text style={styles.metaValue}>{meta.serviceName}</Text>
          </View>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>Status</Text>
            <Text style={styles.metaValue}>{statusLabel(meta.status)}</Text>
          </View>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>Submitted</Text>
            <Text style={styles.metaValue}>{formatDate(meta.submittedAt)}</Text>
          </View>
        </View>

        {!presented.hasContent && <Text style={styles.empty}>No onboarding answers were provided.</Text>}

        {presented.sections.map((section) => (
          <View key={section.title} style={styles.section} wrap>
            <View wrap={false}>
              <Text style={styles.sectionTitle}>{section.title}</Text>
              {section.description ? <Text style={styles.sectionDesc}>{section.description}</Text> : null}
              <View style={styles.sectionRule} />
            </View>
            <View style={styles.rowsWrap}>
              {section.rows.map((row) => (
                <View key={row.label} style={row.full ? styles.cellFull : styles.cell} wrap={false}>
                  <Text style={styles.fieldLabel}>{row.label}</Text>
                  <ValueNode row={row} />
                </View>
              ))}
            </View>
          </View>
        ))}

        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>{meta.agency} · {meta.businessName} · {meta.serviceName}</Text>
          <Text style={styles.footerText} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
