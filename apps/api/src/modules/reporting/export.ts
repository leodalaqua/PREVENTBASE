import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";

export interface Column {
  key: string;
  label: string;
  width?: number;
  format?: (value: unknown, row: Record<string, unknown>) => string;
}

export interface TableExport {
  title: string;
  subtitle?: string;
  columns: Column[];
  rows: Array<Record<string, unknown>>;
  filename: string;
}

export interface ExportResult {
  buffer: Buffer;
  contentType: string;
  filename: string;
}

export function fmtDate(v: unknown): string {
  if (!v) return "";
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

export function fmtDateTime(v: unknown): string {
  if (!v) return "";
  const d = v instanceof Date ? v : new Date(String(v));
  return d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function cell(col: Column, row: Record<string, unknown>): string {
  const v = row[col.key];
  if (col.format) return col.format(v, row);
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return fmtDate(v);
  return String(v);
}

export function toCsv(t: TableExport): ExportResult {
  const esc = (s: string) => (/[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = [t.columns.map((c) => esc(c.label)).join(";"), ...t.rows.map((r) => t.columns.map((c) => esc(cell(c, r))).join(";"))];
  return { buffer: Buffer.from(`\uFEFF${lines.join("\r\n")}`, "utf8"), contentType: "text/csv; charset=utf-8", filename: `${t.filename}.csv` };
}

export async function toXlsx(t: TableExport): Promise<ExportResult> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "PreventBase";
  const ws = wb.addWorksheet(t.title.slice(0, 31));
  ws.addRow([t.title]).font = { bold: true, size: 14 };
  if (t.subtitle) ws.addRow([t.subtitle]);
  ws.addRow([]);
  const header = ws.addRow(t.columns.map((c) => c.label));
  header.font = { bold: true };
  header.eachCell((c) => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFACC15" } };
  });
  for (const r of t.rows) ws.addRow(t.columns.map((c) => cell(c, r)));
  t.columns.forEach((c, i) => {
    ws.getColumn(i + 1).width = c.width ?? Math.max(12, c.label.length + 2);
  });
  const buf = await wb.xlsx.writeBuffer();
  return { buffer: Buffer.from(buf), contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", filename: `${t.filename}.xlsx` };
}

export function pdfBuffer(build: (doc: PDFKit.PDFDocument) => void, opts: PDFKit.PDFDocumentOptions = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40, bufferPages: true, ...opts });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    build(doc);
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const bottom = doc.page.height - 25;
      doc.fontSize(7).fillColor("#666").text(`PreventBase · página ${i + 1}/${range.count} · gerado em ${fmtDateTime(new Date())}`, 40, bottom, { width: doc.page.width - 80, align: "center", lineBreak: false });
    }
    doc.end();
  });
}

export async function toPdf(t: TableExport): Promise<ExportResult> {
  const buffer = await pdfBuffer(
    (doc) => {
      const left = 30;
      const usable = doc.page.width - 60;
      const total = t.columns.reduce((s, c) => s + (c.width ?? 12), 0);
      const widths = t.columns.map((c) => ((c.width ?? 12) / total) * usable);
      doc.fontSize(14).fillColor("#000").text(t.title, left, 30);
      if (t.subtitle) doc.fontSize(9).fillColor("#444").text(t.subtitle);
      doc.moveDown(0.5);
      const drawHeader = () => {
        const y = doc.y;
        doc.rect(left, y - 2, usable, 16).fill("#facc15");
        doc.fillColor("#000").fontSize(8).font("Helvetica-Bold");
        let x = left;
        t.columns.forEach((c, i) => {
          doc.text(c.label, x + 2, y + 2, { width: widths[i]! - 4, lineBreak: false, ellipsis: true });
          x += widths[i]!;
        });
        doc.font("Helvetica").moveDown(0.2);
        doc.y = y + 18;
      };
      drawHeader();
      t.rows.forEach((r, idx) => {
        const texts = t.columns.map((c) => cell(c, r));
        const heights = texts.map((txt, i) => doc.fontSize(7.5).heightOfString(txt, { width: widths[i]! - 4 }));
        const h = Math.max(12, ...heights) + 4;
        if (doc.y + h > doc.page.height - 40) {
          doc.addPage();
          doc.y = 30;
          drawHeader();
        }
        const y = doc.y;
        if (idx % 2 === 1) doc.rect(left, y - 1, usable, h).fill("#f4f4f5");
        doc.fillColor("#111").fontSize(7.5);
        let x = left;
        texts.forEach((txt, i) => {
          doc.text(txt, x + 2, y + 1, { width: widths[i]! - 4 });
          x += widths[i]!;
        });
        doc.y = y + h;
      });
      if (t.rows.length === 0) doc.fontSize(9).fillColor("#666").text("Nenhum registro.", left);
    },
    { layout: t.columns.length > 6 ? "landscape" : "portrait", margin: 30 },
  );
  return { buffer, contentType: "application/pdf", filename: `${t.filename}.pdf` };
}

export async function renderTable(format: "csv" | "xlsx" | "pdf", t: TableExport): Promise<ExportResult> {
  if (format === "csv") return toCsv(t);
  if (format === "xlsx") return toXlsx(t);
  return toPdf(t);
}
