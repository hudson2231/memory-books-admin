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
const COLOURING_GUTTER_MM = 24;

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

function drawGrace(page: PDFPage, geometry: MixamGeometry, order: Record<string, unknown>, font: Awaited<ReturnType<PDFDocument["embedFont"]>>) {
  const recipient = String(order.grace_recipient || "").trim();
  const from = String(order.grace_from || "").trim();
  const message = String(order.grace_message || "").trim();
  const width = geometry.bodyWidthPt;
  const height = geometry.bodyHeightPt;
  page.drawRectangle({ x: 0, y: 0, width, height, color: rgb(1, 1, 1) });
  page.drawText("M E M O R Y   B O O K S", { x: width / 2 - 75, y: height - 105, size: 13, font, color: rgb(0.58, 0.43, 0.19) });
  page.drawText("Made Especially for You", { x: width / 2 - 120, y: height - 205, size: 28, font, color: rgb(0.04, 0.16, 0.10) });
  if (recipient) page.drawText(`TO  ${recipient}`, { x: 72, y: height - 300, size: 17, font, color: rgb(0.12, 0.12, 0.12) });
  if (from) page.drawText(`FROM  ${from}`, { x: 72, y: height - 345, size: 17, font, color: rgb(0.12, 0.12, 0.12) });
  if (message) page.drawText(message.slice(0, 220), { x: 72, y: height - 420, size: 13, font, color: rgb(0.18, 0.18, 0.18), maxWidth: width - 144, lineHeight: 18 });
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
    : path.join(process.cwd(), "public", "covers", "backgrounds", "goodcover.png");
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
  const inner = mm(colouring ? COLOURING_GUTTER_MM : MIXAM_QUIET_MM);
  const outer = mm(MIXAM_QUIET_MM);
  const left = isRightHandPage ? inner : outer;
  const right = isRightHandPage ? outer : inner;
  const topBottom = mm(MIXAM_QUIET_MM);
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
