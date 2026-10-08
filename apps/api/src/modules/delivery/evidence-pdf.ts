import QRCode from "qrcode";
import { fmtDate, fmtDateTime, pdfBuffer } from "../reporting/export.js";

export interface EvidencePdfInput {
  company: { legalName: string; tradeName: string | null; cnpj: string } | null;
  employee: { name: string; cpf: string; registration: string | null };
  manager: { name: string } | null;
  warehouse: { name: string } | null;
  deliveredAt: Date;
  status: string;
  cancellationReason: string | null;
  publicId: string;
  items: Array<{ productDescription: string; caNumber: string; lotNumber: string; lotExpiryDate: Date | null; quantity: number; reasonCode: string; manufacturer: string | null }>;
  evidence: { verificationMethod: string; biometricVerificationId: string; biometricScore: number; livenessResult: boolean; termsVersion: number; hash: string } | null;
  termsText: string | null;
  verifyUrl: string;
}

const maskCpf = (cpf: string) => (cpf.length === 11 ? `${cpf.slice(0, 3)}.***.***-${cpf.slice(9)}` : cpf);

/** PDF probatório (§65): sem template/dado facial; QR para verificação pública (§66). */
export async function evidencePdf(d: EvidencePdfInput): Promise<Buffer> {
  const qr = await QRCode.toBuffer(d.verifyUrl, { margin: 1, width: 220 });
  return pdfBuffer((doc) => {
    doc.fontSize(16).fillColor("#000").text("Comprovante de Entrega de EPI", { continued: false });
    doc.fontSize(9).fillColor("#555").text("Registro eletrônico com validação biométrica — NR-6 (fornecimento registrado em sistema eletrônico)");
    if (d.status === "CANCELLED") {
      doc.moveDown(0.3).fontSize(11).fillColor("#b91c1c").text(`ENTREGA CANCELADA — ${d.cancellationReason ?? ""}`);
    }
    doc.image(qr, doc.page.width - 40 - 110, 40, { width: 110 });
    doc.moveDown(1).fillColor("#000").fontSize(10);
    const line = (label: string, value: string) => {
      doc.font("Helvetica-Bold").text(`${label}: `, { continued: true }).font("Helvetica").text(value);
    };
    line("Empresa", d.company ? `${d.company.tradeName ?? d.company.legalName} — CNPJ ${d.company.cnpj}` : "-");
    line("Colaborador", `${d.employee.name} — CPF ${maskCpf(d.employee.cpf)}${d.employee.registration ? ` — Matrícula ${d.employee.registration}` : ""}`);
    line("Data/hora", fmtDateTime(d.deliveredAt));
    line("Responsável pela entrega", d.manager?.name ?? "-");
    line("Almoxarifado", d.warehouse?.name ?? "-");
    line("Código de verificação", d.publicId);
    doc.moveDown(0.8);

    doc.font("Helvetica-Bold").fontSize(11).text("Equipamentos entregues");
    doc.moveDown(0.3).font("Helvetica").fontSize(9);
    for (const it of d.items) {
      doc.text(`• ${it.quantity}× ${it.productDescription} — CA ${it.caNumber} — Lote ${it.lotNumber}${it.lotExpiryDate ? ` (val. ${fmtDate(it.lotExpiryDate)})` : ""}${it.manufacturer ? ` — ${it.manufacturer}` : ""} — Motivo: ${it.reasonCode}`);
    }
    doc.moveDown(0.8);

    if (d.termsText) {
      doc.font("Helvetica-Bold").fontSize(11).text("Declaração confirmada pelo colaborador");
      doc.moveDown(0.3).font("Helvetica-Oblique").fontSize(9).text(`"${d.termsText}"`);
      doc.font("Helvetica");
      doc.moveDown(0.8);
    }

    doc.font("Helvetica-Bold").fontSize(11).text("Forma de confirmação");
    doc.moveDown(0.3).font("Helvetica").fontSize(9);
    if (d.evidence) {
      doc.text(`Método: confirmação explícita + validação facial 1:1 com prova de vida (${d.evidence.verificationMethod})`);
      doc.text(`Identificador da verificação biométrica: ${d.evidence.biometricVerificationId}`);
      doc.text(`Score de similaridade: ${d.evidence.biometricScore.toFixed(3)} · Prova de vida: ${d.evidence.livenessResult ? "aprovada" : "reprovada"} · Termo v${d.evidence.termsVersion}`);
      doc.moveDown(0.5);
      doc.font("Helvetica-Bold").text("Hash SHA-256 do registro: ", { continued: true }).font("Courier").fontSize(8).text(d.evidence.hash);
      doc.font("Helvetica").fontSize(8).fillColor("#555").text("O hash protege a integridade posterior do registro; não substitui a biometria. Nenhum dado facial é armazenado neste documento.");
    }
    doc.moveDown(1).fillColor("#000").fontSize(9).text(`Verifique a autenticidade em: ${d.verifyUrl}`);
  });
}
