import fs from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb, type PDFPage } from "pdf-lib";
import sharp from "sharp";
import { MIXAM_FINAL_CONFIGURATIONS } from "./configurations";
import type { MixamBookVariant } from "./page-layout";

const MM_TO_POINTS = 72 / 25.4;
const BLEED_MM = 3;
const TRIM_WIDTH_MM = 210;
const TRIM_HEIGHT_MM = 297;
const MIXAM_QUIET_MM = 12;

export type MixamGeometry = {
  spineMm: number;
  trimWidthMm: number;
  trimHeightMm: number;
  bleedMm: number;
  bodyWidthPt: number;
  bodyHeightPt: number;
  coverWidthPt: number;
  coverHeightPt: number;
  frontPanelCentrePt: number;
};

export function mm(value: number) { return value * MM_TO_POINTS; }

export function getMixamGeometry(spineMm: number): MixamGeometry {
  if (!Number.isFinite(spineMm) || spineMm <= 0) throw new Error("Mixam offer did not return a valid spine width.");
  const coverWidthMm = TRIM_WIDTH_MM * 2 + spineMm + BLEED_MM * 2;
  return {
    spineMm,
    trimWidthMm: TRIM_WIDTH_MM,
    trimHeightMm: TRIM_HEIGHT_MM,
    bleedMm: BLEED_MM,
    bodyWidthPt: mm(TRIM_WIDTH_MM + BLEED_MM * 2),
    bodyHeightPt: mm(TRIM_HEIGHT_MM + BLEED_MM * 2),
    coverWidthPt: mm(coverWidthMm),
    coverHeightPt: mm(TRIM_HEIGHT_MM + BLEED_MM * 2),
    frontPanelCentrePt: mm(BLEED_MM + TRIM_WIDTH_MM + spineMm + TRIM_WIDTH_MM / 2),
  };
}

async function fetchImage(url: string, page: number) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`MIXAM_EXPORT_IMAGE_FETCH: page ${page} HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 20) throw new Error(`MIXAM_EXPORT_IMAGE_FETCH: page ${page} was empty.`);
  return bytes;
}

async function embedPrintImage(pdf: PDFDocument, source: Buffer, width: number, height: number) {
  const jpeg = await sharp(source, { failOn: "none", animated: false })
    .rotate().flatten({ background: "#ffffff" })
    .resize({ width: Math.round(width / 72 * 200), height: Math.round(height / 72 * 200), fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85, chromaSubsampling: "4:4:4" }).toBuffer();
  return pdf.embedJpg(jpeg);
}

function setMixamPageBoxes(page: PDFPage, widthPt: number, heightPt: number) {
  const bleedPt = mm(BLEED_MM);
  page.setMediaBox(0, 0, widthPt, heightPt);
  page.setBleedBox(0, 0, widthPt, heightPt);
  page.setTrimBox(bleedPt, bleedPt, widthPt - bleedPt * 2, heightPt - bleedPt * 2);
}

function addBlank(pdf: PDFDocument, geometry: MixamGeometry) {
  const page = pdf.addPage([geometry.bodyWidthPt, geometry.bodyHeightPt]);
  setMixamPageBoxes(page, geometry.bodyWidthPt, geometry.bodyHeightPt);
  return page;
}

function drawCenteredText(page: PDFPage, text: string, font: Awaited<ReturnType<PDFDocument["embedFont"]>>, size: number, y: number, pageWidth: number, color: ReturnType<typeof rgb>) {
  page.drawText(text, { x: (pageWidth - font.widthOfTextAtSize(text, size)) / 2, y, size, font, color });
}

function wrapGraceTextByWidth(text: string, font: Awaited<ReturnType<PDFDocument["embedFont"]>>, size: number, maxWidth: number) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawGrace(page: PDFPage, geometry: MixamGeometry, order: Record<string, unknown>, font: Awaited<ReturnType<PDFDocument["embedFont"]>>) {
  const recipient = String(order.grace_recipient || "").trim().slice(0, 80);
  const from = String(order.grace_from || "").trim().slice(0, 80);
  const message = String(order.grace_message || "").trim().slice(0, 240);
  const width = geometry.bodyWidthPt;
  const height = geometry.bodyHeightPt;
  const gold = rgb(0.58, 0.43, 0.19);
  const paleGold = rgb(0.76, 0.64, 0.42);
  const darkGreen = rgb(0.035, 0.16, 0.095);
  const charcoal = rgb(0.24, 0.22, 0.2);
  const outer = 22;
  const inner = 31;
  const corner = 42;

  page.drawRectangle({ x: 0, y: 0, width, height, color: rgb(1, 1, 1) });
  page.drawRectangle({ x: outer, y: outer, width: width - outer * 2, height: height - outer * 2, borderColor: gold, borderWidth: 0.65 });
  page.drawRectangle({ x: inner, y: inner, width: width - inner * 2, height: height - inner * 2, borderColor: paleGold, borderWidth: 0.35 });

  page.drawLine({ start: { x: outer, y: height - corner }, end: { x: outer + corner, y: height - corner }, thickness: 0.45, color: paleGold });
  page.drawLine({ start: { x: outer + corner, y: height - outer }, end: { x: outer + corner, y: height - corner }, thickness: 0.45, color: paleGold });
  page.drawLine({ start: { x: width - outer, y: height - corner }, end: { x: width - outer - corner, y: height - corner }, thickness: 0.45, color: paleGold });
  page.drawLine({ start: { x: width - outer - corner, y: height - outer }, end: { x: width - outer - corner, y: height - corner }, thickness: 0.45, color: paleGold });
  page.drawLine({ start: { x: outer, y: corner }, end: { x: outer + corner, y: corner }, thickness: 0.45, color: paleGold });
  page.drawLine({ start: { x: outer + corner, y: outer }, end: { x: outer + corner, y: corner }, thickness: 0.45, color: paleGold });
  page.drawLine({ start: { x: width - outer, y: corner }, end: { x: width - outer - corner, y: corner }, thickness: 0.45, color: paleGold });
  page.drawLine({ start: { x: width - outer - corner, y: outer }, end: { x: width - outer - corner, y: corner }, thickness: 0.45, color: paleGold });

  drawCenteredText(page, "M E M O R Y   B O O K S", font, 15, height - 112, width, gold);
  page.drawLine({ start: { x: width / 2 - 35, y: height - 132 }, end: { x: width / 2 - 8, y: height - 132 }, thickness: 0.45, color: paleGold });
  page.drawLine({ start: { x: width / 2 + 8, y: height - 132 }, end: { x: width / 2 + 35, y: height - 132 }, thickness: 0.45, color: paleGold });
  page.drawCircle({ x: width / 2, y: height - 132, size: 1.6, color: gold });

  drawCenteredText(page, "Made Especially", font, 60, height - 225, width, darkGreen);
  drawCenteredText(page, "for You", font, 54, height - 287, width, darkGreen);
  page.drawLine({ start: { x: width / 2 - 38, y: height - 335 }, end: { x: width / 2 - 7, y: height - 335 }, thickness: 0.45, color: paleGold });
  page.drawLine({ start: { x: width / 2 + 7, y: height - 335 }, end: { x: width / 2 + 38, y: height - 335 }, thickness: 0.45, color: paleGold });
  page.drawCircle({ x: width / 2, y: height - 335, size: 1.5, color: gold });

  drawCenteredText(page, "TO", font, 11, height - (recipient ? 420 : 435), width, gold);
  if (recipient) drawCenteredText(page, recipient, font, 22, height - 450, width, darkGreen);
  drawCenteredText(page, "FROM", font, 11, height - (from ? 500 : 515), width, gold);
  if (from) drawCenteredText(page, from, font, 22, height - 530, width, darkGreen);

  if (message) {
    const messageFontSize = 17;
    const lines = wrapGraceTextByWidth(message, font, messageFontSize, width - 140);
    lines.forEach((line, index) => drawCenteredText(page, line, font, messageFontSize, height - 610 - index * 23, width, charcoal));
  }

  page.drawLine({ start: { x: width / 2 - 28, y: 104 }, end: { x: width / 2 - 7, y: 104 }, thickness: 0.45, color: paleGold });
  page.drawLine({ start: { x: width / 2 + 7, y: 104 }, end: { x: width / 2 + 28, y: 104 }, thickness: 0.45, color: paleGold });
  page.drawCircle({ x: width / 2, y: 104, size: 1.6, color: gold });
  drawCenteredText(page, "A  G I F T  O F  M E M O R I E S  T O  K E E P  F O R E V E R .", font, 9, 70, width, gold);
}

function drawGuides(page: PDFPage, geometry: MixamGeometry) {
  const x = mm(BLEED_MM); const trimW = mm(TRIM_WIDTH_MM); const spineW = mm(geometry.spineMm); const y = mm(BLEED_MM); const h = mm(TRIM_HEIGHT_MM);
  const red = rgb(0.85, 0.1, 0.1); const blue = rgb(0.1, 0.4, 0.9); const amber = rgb(0.9, 0.6, 0.05);
  page.drawRectangle({ x, y, width: trimW * 2 + spineW, height: h, borderColor: red, borderWidth: 0.75 });
  page.drawLine({ start: { x: x + trimW, y }, end: { x: x + trimW, y: y + h }, thickness: 0.75, color: blue });
  page.drawLine({ start: { x: x + trimW + spineW, y }, end: { x: x + trimW + spineW, y: y + h }, thickness: 0.75, color: blue });
  page.drawLine({ start: { x: geometry.frontPanelCentrePt, y }, end: { x: geometry.frontPanelCentrePt, y: y + h }, thickness: 0.75, color: amber });
}

async function addCover(pdf: PDFDocument, variant: MixamBookVariant, geometry: MixamGeometry, debug: boolean) {
  const page = pdf.addPage([geometry.coverWidthPt, geometry.coverHeightPt]);
  setMixamPageBoxes(page, geometry.coverWidthPt, geometry.coverHeightPt);
  const source = variant.startsWith("story")
    ? path.join(process.cwd(), "public", "covers", "story-cover-wrap-v2-300dpi.jpg")
    : path.join(process.cwd(), "public", "covers", "colouring-cover-approved-300dpi.png");
  const buffer = await fs.readFile(source);
  const image = await embedPrintImage(pdf, buffer, geometry.coverWidthPt, geometry.coverHeightPt);
  const scale = Math.max(geometry.coverWidthPt / image.width, geometry.coverHeightPt / image.height);
  page.drawImage(image, { x: (geometry.coverWidthPt - image.width * scale) / 2, y: (geometry.coverHeightPt - image.height * scale) / 2, width: image.width * scale, height: image.height * scale });
  if (debug) drawGuides(page, geometry);
}

async function addInteriorImage(pdf: PDFDocument, geometry: MixamGeometry, url: string, pageNumber: number, colouring: boolean, caption: string, font: Awaited<ReturnType<PDFDocument["embedFont"]>>) {
  const image = await embedPrintImage(pdf, await fetchImage(url, pageNumber), geometry.bodyWidthPt, geometry.bodyHeightPt);
  const page = addBlank(pdf, geometry);
  const isRightHandPage = pdf.getPageCount() % 2 === 1;
  // Colouring pages are always recto, so their protected PUR binding edge is
  // left. Reserve only the approved 12 mm quiet area there; let the artwork
  // use the rest of the trim rather than creating a second large outer margin.
  const inner = mm(MIXAM_QUIET_MM);
  const outer = colouring ? mm(BLEED_MM) : mm(MIXAM_QUIET_MM);
  const left = isRightHandPage ? inner : outer;
  const right = isRightHandPage ? outer : inner;
  const topBottom = colouring ? mm(BLEED_MM) : mm(MIXAM_QUIET_MM);
  const captionHeight = !colouring && caption ? 46 : 0;
  const availableWidth = geometry.bodyWidthPt - left - right;
  const availableHeight = geometry.bodyHeightPt - topBottom * 2 - captionHeight;
  const scale = Math.min(availableWidth / image.width, availableHeight / image.height);
  const width = image.width * scale; const height = image.height * scale;
  page.drawImage(image, { x: left + (availableWidth - width) / 2, y: topBottom + captionHeight + (availableHeight - height) / 2, width, height });
  if (caption) page.drawText(caption.slice(0, 180), { x: left, y: topBottom + 15, size: 12, font, color: rgb(0.12, 0.12, 0.12), maxWidth: availableWidth });
}

export async function createMixamPdfs(input: { order: Record<string, unknown>; images: Array<Record<string, unknown>>; variant: MixamBookVariant; spineMm: number; debug?: boolean }) {
  const configuration = MIXAM_FINAL_CONFIGURATIONS[input.variant];
  const geometry = getMixamGeometry(input.spineMm);
  const body = await PDFDocument.create(); const cover = await PDFDocument.create();
  const font = await body.embedFont(StandardFonts.TimesRoman);
  await addCover(cover, input.variant, geometry, Boolean(input.debug));
  const grace = addBlank(body, geometry); drawGrace(grace, geometry, input.order, font); addBlank(body, geometry);
  const content = input.images.slice(0, Number(input.variant.match(/(20|32|40)$/)?.[1] || 20));
  const colouring = configuration.productType === "colouring_book";
  for (const image of content) {
    const url = String(image.generated_url || ""); if (!url) throw new Error("MIXAM_EXPORT_IMAGE_FETCH: generated image missing.");
    await addInteriorImage(body, geometry, url, Number(image.page_number || 0), colouring, colouring ? "" : String(image.caption_text || ""), font);
    if (colouring) addBlank(body, geometry);
  }
  while (body.getPageCount() < configuration.bodyPageCount) addBlank(body, geometry);
  if (body.getPageCount() !== configuration.bodyPageCount) throw new Error(`MIXAM_EXPORT_BODY: expected ${configuration.bodyPageCount} pages, got ${body.getPageCount()}.`);
  if (cover.getPageCount() !== 1) throw new Error("MIXAM_EXPORT_COVER: expected one cover page.");
  return { geometry, coverBytes: Buffer.from(await cover.save()), bodyBytes: Buffer.from(await body.save()), bodyPageCount: body.getPageCount() };
}
