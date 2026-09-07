import { NextResponse } from "next/server";
import { spawnSync } from "child_process";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  getPackagePayments,
  getTransferRequests,
  getAppSettings,
} from "@/lib/firebase";

export const dynamic = "force-dynamic";

interface ExportRow {
  date: string;
  type: string;
  pkg: string;
  method: string;
  amount: number;
  status: string;
}

/**
 * Generates a vector PDF transaction-history report using ReportLab.
 * All data is REAL (live packagePayments + transferRequests from Firebase).
 */
export async function GET() {
  const [payments, transfers, settings] = await Promise.all([
    getPackagePayments(50),
    getTransferRequests(30),
    getAppSettings(),
  ]);

  const rows: ExportRow[] = [];
  for (const p of payments) {
    rows.push({
      date: p.createdAt
        ? new Date(p.createdAt).toISOString().slice(0, 16).replace("T", " ")
        : "—",
      type: "Package",
      pkg: p.packageName ?? "—",
      method: (p.method ?? "—").toUpperCase(),
      amount: Number(p.amount ?? 0),
      status: (p.status ?? (p.approvedAt ? "approved" : "pending")).toLowerCase(),
    });
  }
  for (const t of transfers) {
    rows.push({
      date: t.createdAt
        ? new Date(t.createdAt).toISOString().slice(0, 16).replace("T", " ")
        : "—",
      type: "Transfer",
      pkg: "Wallet Transfer",
      method: "WALLET",
      amount: Number(t.amount ?? 0),
      status: (t.status ?? "pending").toLowerCase(),
    });
  }
  rows.sort((a, b) => b.date.localeCompare(a.date));

  const totalRevenue = rows
    .filter((r) => r.status === "approved")
    .reduce((s, r) => s + r.amount, 0);

  const payload = {
    appName: settings?.appName ?? "Revo Fixer",
    version: settings?.appVersion ?? "2.0.0",
    support: settings?.supportContact ?? "@RevoAgent",
    totalCount: rows.length,
    totalRevenue,
    generated: new Date().toISOString().slice(0, 19).replace("T", " ") + " UTC",
    rows,
  };

  const pdfBytes = buildPdf(payload);
  if (!pdfBytes) {
    return NextResponse.json(
      { error: "PDF generation failed" },
      { status: 500 },
    );
  }

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(pdfBytes, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="revo-fixer-transactions-${stamp}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}

// Self-contained ReportLab script. Reads JSON payload from stdin, writes PDF to
// a temp file whose path is passed as argv[1], then prints the path to stdout.
const REPORTLAB_SCRIPT = `
import sys, json, tempfile, os
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.lib.enums import TA_CENTER

out_path = sys.argv[1]
data = json.load(sys.stdin)
doc = SimpleDocTemplate(
    out_path,
    pagesize=A4,
    leftMargin=18*mm, rightMargin=18*mm,
    topMargin=18*mm, bottomMargin=18*mm,
    title=data["appName"] + " Transaction Report",
    author="Revo Fixer",
    subject="Transaction History",
    creator="Revo Fixer Web",
)
h1 = ParagraphStyle("h1", fontSize=22, textColor=colors.HexColor("#0a0b14"), alignment=TA_CENTER, spaceAfter=4, fontName="Helvetica-Bold")
sub = ParagraphStyle("sub", fontSize=9, textColor=colors.HexColor("#5a6a99"), alignment=TA_CENTER, spaceAfter=12)
section = ParagraphStyle("section", fontSize=12, textColor=colors.HexColor("#448AFF"), spaceBefore=10, spaceAfter=6, fontName="Helvetica-Bold")
small = ParagraphStyle("small", fontSize=8, textColor=colors.HexColor("#5a6a99"))

story = []
story.append(Paragraph(data["appName"], h1))
story.append(Paragraph("Transaction History Report &middot; v" + data["version"] + " &middot; " + data["support"], sub))
story.append(Spacer(1, 4))

summary = [
    ["Total Transactions", str(data["totalCount"])],
    ["Approved Revenue", "Rs " + format(data["totalRevenue"], ",")],
    ["Generated (UTC)", data["generated"]],
]
st = Table(summary, colWidths=[60*mm, 60*mm])
st.setStyle(TableStyle([
    ("BACKGROUND", (0,0), (-1,-1), colors.HexColor("#F1F5F9")),
    ("TEXTCOLOR", (0,0), (0,-1), colors.HexColor("#5a6a99")),
    ("TEXTCOLOR", (1,0), (1,-1), colors.HexColor("#0a0b14")),
    ("FONTNAME", (0,0), (-1,-1), "Helvetica-Bold"),
    ("FONTSIZE", (0,0), (-1,-1), 10),
    ("BOX", (0,0), (-1,-1), 0.5, colors.HexColor("#1e2240")),
    ("INNERGRID", (0,0), (-1,-1), 0.25, colors.HexColor("#e2e8f0")),
    ("LEFTPADDING", (0,0), (-1,-1), 8),
    ("RIGHTPADDING", (0,0), (-1,-1), 8),
    ("TOPPADDING", (0,0), (-1,-1), 6),
    ("BOTTOMPADDING", (0,0), (-1,-1), 6),
]))
story.append(st)
story.append(Spacer(1, 10))
story.append(Paragraph("Transaction Log", section))

header = ["Date (UTC)", "Type", "Package", "Method", "Amount", "Status"]
rows = [header]
for r in data["rows"]:
    rows.append([
        r["date"], r["type"], r["pkg"], r["method"],
        "Rs " + format(r["amount"], ","),
        r["status"],
    ])
col_widths = [30*mm, 18*mm, 38*mm, 20*mm, 28*mm, 28*mm]
tbl = Table(rows, colWidths=col_widths, repeatRows=1)
style_cmds = [
    ("BACKGROUND", (0,0), (-1,0), colors.HexColor("#448AFF")),
    ("TEXTCOLOR", (0,0), (-1,0), colors.white),
    ("FONTNAME", (0,0), (-1,0), "Helvetica-Bold"),
    ("FONTSIZE", (0,0), (-1,0), 8.5),
    ("FONTSIZE", (0,1), (-1,-1), 8),
    ("TEXTCOLOR", (0,1), (-1,-1), colors.HexColor("#1F2937")),
    ("ALIGN", (4,0), (4,-1), "RIGHT"),
    ("ALIGN", (0,0), (-1,0), "CENTER"),
    ("BOX", (0,0), (-1,-1), 0.5, colors.HexColor("#1e2240")),
    ("INNERGRID", (0,0), (-1,-1), 0.25, colors.HexColor("#e2e8f0")),
    ("ROWBACKGROUNDS", (0,1), (-1,-1), [colors.white, colors.HexColor("#F8FAFC")]),
    ("LEFTPADDING", (0,0), (-1,-1), 5),
    ("RIGHTPADDING", (0,0), (-1,-1), 5),
    ("TOPPADDING", (0,0), (-1,-1), 5),
    ("BOTTOMPADDING", (0,0), (-1,-1), 5),
]
for i, r in enumerate(data["rows"], start=1):
    if r["status"] == "approved":
        style_cmds.append(("TEXTCOLOR", (5,i), (5,i), colors.HexColor("#2ed573")))
        style_cmds.append(("FONTNAME", (5,i), (5,i), "Helvetica-Bold"))
    elif r["status"] == "rejected":
        style_cmds.append(("TEXTCOLOR", (5,i), (5,i), colors.HexColor("#ff4757")))
        style_cmds.append(("FONTNAME", (5,i), (5,i), "Helvetica-Bold"))
    elif r["status"] == "pending":
        style_cmds.append(("TEXTCOLOR", (5,i), (5,i), colors.HexColor("#ffa502")))
tbl.setStyle(TableStyle(style_cmds))
story.append(tbl)
story.append(Spacer(1, 12))
story.append(Paragraph(
    "All data is sourced live from the Revo Fixer Firebase platform. "
    "Revenue counts approved transactions only. Read-only report by " + data["support"] + ".",
    small
))
doc.build(story)
sys.stdout.write(out_path)
`;

function buildPdf(payload: object): Buffer | null {
  // Create a temp dir + output file path for ReportLab to write to.
  const dir = mkdtempSync(join(tmpdir(), "revo-pdf-"));
  const outPath = join(dir, "report.pdf");
  try {
    const result = spawnSync("python3", ["-c", REPORTLAB_SCRIPT, outPath], {
      input: JSON.stringify(payload),
      maxBuffer: 20 * 1024 * 1024,
    });
    if (result.error || result.status !== 0) {
      console.error(
        "ReportLab failed:",
        result.error?.message ?? result.stderr?.toString(),
      );
      return null;
    }
    return readFileSync(outPath);
  } catch (err) {
    console.error("buildPdf error:", err);
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
