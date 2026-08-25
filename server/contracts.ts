import { mkdir, readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { Contract, Contractor, Job, PortalSettings, Project } from "../src/types.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const contractStorage = process.env.CONTRACT_STORAGE_DIR
  ? resolve(process.env.CONTRACT_STORAGE_DIR)
  : resolve(root, "storage", "contracts");

export interface ContractContext {
  contract: Contract;
  contractor: Contractor;
  job: Job;
  project: Project;
  settings: PortalSettings;
}

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function renderContractText(context: ContractContext) {
  const { contract, contractor, job, project, settings } = context;
  const values: Record<string, string> = {
    contractNumber: contract.contractNumber,
    contractorName: contractor.name,
    contractorCompany: contractor.company,
    projectName: project.name,
    jobNumber: job.number,
    jobTitle: job.title,
    location: job.location,
    scope: job.scope,
    price: money.format(contract.price),
    paymentTerms: contract.paymentTerms,
    scheduleStart: job.scheduleStart || "To be scheduled",
    scheduleEnd: job.scheduleEnd || "To be scheduled",
    notes: contract.notes ? `SPECIAL TERMS\n${contract.notes}` : "",
  };

  return Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{{${key}}}`, value),
    settings.contractTemplate,
  );
}

const wrapLine = (text: string, maxWidth: number, size: number, font: Awaited<ReturnType<PDFDocument["embedFont"]>>) => {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !current) current = candidate;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
};

export async function generateContractPdf(context: ContractContext) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const signatureFont = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const navy = rgb(0.027, 0.075, 0.122);
  const cyan = rgb(0.133, 0.827, 0.933);
  const muted = rgb(0.29, 0.36, 0.42);
  const text = renderContractText(context);
  const margin = 54;
  const width = 612;
  const height = 792;
  const contentWidth = width - margin * 2;
  let page = pdf.addPage([width, height]);
  let y = height - 112;

  const addHeader = () => {
    page.drawRectangle({ x: 0, y: height - 76, width, height: 76, color: navy });
    page.drawRectangle({ x: margin, y: height - 77, width: 54, height: 3, color: cyan });
    page.drawText("BULLSHARK", { x: margin, y: height - 43, size: 18, font: bold, color: rgb(1, 1, 1) });
    page.drawText("CONNECTED", { x: margin + 112, y: height - 43, size: 9, font: regular, color: cyan });
    page.drawText(context.contract.contractNumber, { x: width - 180, y: height - 43, size: 9, font: regular, color: rgb(0.72, 0.8, 0.85) });
  };

  const addPage = () => {
    page = pdf.addPage([width, height]);
    addHeader();
    y = height - 112;
  };

  addHeader();
  for (const paragraph of text.split("\n")) {
    const trimmed = paragraph.trim();
    if (!trimmed) {
      y -= 8;
      continue;
    }
    const isHeading = trimmed === trimmed.toUpperCase() && trimmed.length < 70;
    const size = isHeading ? 11 : 9.5;
    const activeFont = isHeading ? bold : regular;
    const lineHeight = isHeading ? 16 : 14;
    const lines = wrapLine(trimmed, contentWidth, size, activeFont);
    if (y - lines.length * lineHeight < 110) addPage();
    if (isHeading) y -= 4;
    for (const line of lines) {
      page.drawText(line, { x: margin, y, size, font: activeFont, color: isHeading ? navy : muted });
      y -= lineHeight;
    }
    y -= isHeading ? 2 : 4;
  }

  if (y < 160) addPage();
  y -= 18;
  page.drawLine({ start: { x: margin, y }, end: { x: 260, y }, thickness: 0.8, color: muted });
  if (context.contract.signedAt) {
    page.drawText(context.contract.signerName || "Authorized signer", { x: margin + 6, y: y + 7, size: 15, font: signatureFont, color: navy });
    page.drawText(context.contract.signerTitle || "Authorized representative", { x: margin, y: y - 16, size: 8, font: regular, color: muted });
  } else page.drawText("Subcontractor signature", { x: margin, y: y - 16, size: 8, font: regular, color: muted });
  page.drawText("/contractor-signature/", { x: margin, y: y - 32, size: 4, font: regular, color: rgb(1, 1, 1) });
  page.drawLine({ start: { x: 330, y }, end: { x: width - margin, y }, thickness: 0.8, color: muted });
  page.drawText(context.contract.signedAt ? `Signed: ${new Date(context.contract.signedAt).toLocaleDateString("en-US")}` : "Date", { x: 330, y: y - 16, size: context.contract.signedAt ? 9 : 8, font: context.contract.signedAt ? bold : regular, color: muted });
  page.drawText("/contractor-date/", { x: 330, y: y - 32, size: 4, font: regular, color: rgb(1, 1, 1) });

  const pages = pdf.getPages();
  pages.forEach((pdfPage, index) => {
    pdfPage.drawText(`${context.settings.companyName}  •  ${context.settings.supportEmail}`, {
      x: margin,
      y: 28,
      size: 7,
      font: regular,
      color: muted,
    });
    pdfPage.drawText(`${index + 1} / ${pages.length}`, { x: width - 78, y: 28, size: 7, font: regular, color: muted });
  });

  const safeName = basename(`${context.contract.id}.pdf`);
  const outputPath = resolve(contractStorage, safeName);
  await mkdir(contractStorage, { recursive: true });
  const { writeFile } = await import("node:fs/promises");
  const pdfBytes = await pdf.save();
  await writeFile(outputPath, pdfBytes);
  return outputPath;
}

export interface EnvelopeResult {
  envelopeId: string;
  status: "ready" | "sent";
  signingUrl?: string;
}

export interface EsignService {
  send(context: ContractContext): Promise<EnvelopeResult>;
}

export class ConfiguredEsignService implements EsignService {
  async send(context: ContractContext): Promise<EnvelopeResult> {
    if (context.settings.esignProvider === "demo") {
      return {
        envelopeId: `demo-${context.contract.id}`,
        status: "ready",
        signingUrl: `/api/contracts/${context.contract.id}/pdf`,
      };
    }
    return this.sendWithDocuSign(context);
  }

  private async sendWithDocuSign(context: ContractContext): Promise<EnvelopeResult> {
    const integrationKey = process.env.DOCUSIGN_INTEGRATION_KEY;
    const userId = process.env.DOCUSIGN_USER_ID;
    const accountId = process.env.DOCUSIGN_ACCOUNT_ID;
    if (!integrationKey || !userId || !accountId) {
      throw new Error("DocuSign is selected, but the integration key, user ID, or account ID is missing.");
    }

    let privateKey = process.env.DOCUSIGN_PRIVATE_KEY?.replaceAll("\\n", "\n");
    if (!privateKey && process.env.DOCUSIGN_PRIVATE_KEY_PATH) {
      privateKey = await readFile(process.env.DOCUSIGN_PRIVATE_KEY_PATH, "utf8");
    }
    if (!privateKey) throw new Error("DocuSign is selected, but no RSA private key is configured.");

    const sdkModule = await import("docusign-esign");
    const sdk = (sdkModule.default || sdkModule) as any;
    const apiClient = new sdk.ApiClient();
    apiClient.setBasePath(process.env.DOCUSIGN_BASE_PATH || "https://demo.docusign.net/restapi");
    apiClient.setOAuthBasePath(process.env.DOCUSIGN_OAUTH_BASE_PATH || "account-d.docusign.com");
    const auth = await apiClient.requestJWTUserToken(
      integrationKey,
      userId,
      ["signature", "impersonation"],
      Buffer.from(privateKey),
      3600,
    );
    apiClient.addDefaultHeader("Authorization", `Bearer ${auth.body.access_token}`);

    const pdf = await readFile(context.contract.pdfPath);
    const envelope = {
      emailSubject: `Signature requested: ${context.contract.contractNumber}`,
      documents: [{
        documentBase64: pdf.toString("base64"),
        name: `${context.contract.contractNumber}.pdf`,
        fileExtension: "pdf",
        documentId: "1",
      }],
      recipients: {
        signers: [{
          email: context.contractor.email,
          name: context.contractor.name,
          recipientId: "1",
          routingOrder: "1",
          tabs: {
            signHereTabs: [{ anchorString: "/contractor-signature/", anchorUnits: "pixels", anchorYOffset: "-8" }],
            dateSignedTabs: [{ anchorString: "/contractor-date/", anchorUnits: "pixels", anchorYOffset: "-8" }],
          },
        }],
      },
      status: "sent",
    };
    const response = await new sdk.EnvelopesApi(apiClient).createEnvelope(accountId, { envelopeDefinition: envelope });
    return { envelopeId: response.envelopeId, status: "sent" };
  }
}
