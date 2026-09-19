import { PDFDocument, PDFName, type PDFPage } from "pdf-lib";
import { getMixamGeometry, mm } from "./pdf-export";
import type { MixamBookVariant } from "./page-layout";

const POINT_TOLERANCE = 0.75;

type PdfBox = { x: number; y: number; width: number; height: number };
export type MixamPdfQa = {
  valid: boolean;
  blockers: string[];
  pageCount: number | null;
  pageSizesMm: Array<{ width: number; height: number }>;
  pageBoxesMm: Array<{ media: PdfBox; trim: PdfBox; bleed: PdfBox }>;
  expectedPageCount: number;
  expectedSizeMm: { width: number; height: number };
  expectedTrimSizeMm: { width: number; height: number };
};

function pointsToMm(value: number) { return value * 25.4 / 72; }
function mmBox(box: PdfBox): PdfBox {
  return {
    x: Number(pointsToMm(box.x).toFixed(3)), y: Number(pointsToMm(box.y).toFixed(3)),
    width: Number(pointsToMm(box.width).toFixed(3)), height: Number(pointsToMm(box.height).toFixed(3)),
  };
}
function matches(actual: number, expected: number) { return Math.abs(actual - expected) <= POINT_TOLERANCE; }
function equalBox(actual: PdfBox, expected: PdfBox) {
  return matches(actual.x, expected.x) && matches(actual.y, expected.y)
    && matches(actual.width, expected.width) && matches(actual.height, expected.height);
}
function explicitBox(page: PDFPage, name: "MediaBox" | "TrimBox" | "BleedBox") {
  return Boolean(page.node.get(PDFName.of(name)));
}
function inside(inner: PdfBox, outer: PdfBox) {
  return inner.x >= outer.x - POINT_TOLERANCE
    && inner.y >= outer.y - POINT_TOLERANCE
    && inner.x + inner.width <= outer.x + outer.width + POINT_TOLERANCE
    && inner.y + inner.height <= outer.y + outer.height + POINT_TOLERANCE;
}
async function loadPdf(bytes: Uint8Array) {
  try { return await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false }); }
  catch (error) { throw new Error(`PDF is unreadable or encrypted: ${error instanceof Error ? error.message : "unknown PDF error"}`); }
}

export async function validateMixamPdfBytes(input: {
  bytes: Uint8Array;
  kind: "cover" | "body";
  variant: MixamBookVariant;
  spineMm: number;
}): Promise<MixamPdfQa> {
  const geometry = getMixamGeometry(input.spineMm);
  const width = input.kind === "cover" ? geometry.coverWidthPt : geometry.bodyWidthPt;
  const height = input.kind === "cover" ? geometry.coverHeightPt : geometry.bodyHeightPt;
  const bleed = mm(3);
  const expectedMedia: PdfBox = { x: 0, y: 0, width, height };
  const expectedTrim: PdfBox = { x: bleed, y: bleed, width: width - bleed * 2, height: height - bleed * 2 };
  const expectedPageCount = input.kind === "cover" ? 1 : ({
    story_20: 32, story_32: 36, story_40: 44,
    colouring_20: 44, colouring_32: 68, colouring_40: 84,
  } as Record<MixamBookVariant, number>)[input.variant];
  const expectedSizeMm = { width: pointsToMm(width), height: pointsToMm(height) };
  const expectedTrimSizeMm = { width: pointsToMm(expectedTrim.width), height: pointsToMm(expectedTrim.height) };
  const blockers: string[] = [];
  let pdf: PDFDocument;
  try { pdf = await loadPdf(input.bytes); }
  catch (error) {
    return { valid: false, blockers: [error instanceof Error ? error.message : "PDF unreadable."], pageCount: null, pageSizesMm: [], pageBoxesMm: [], expectedPageCount, expectedSizeMm, expectedTrimSizeMm };
  }
  const pages = pdf.getPages();
  if (pages.length !== expectedPageCount) blockers.push(`${input.kind === "cover" ? "Cover" : "Body"} PDF has ${pages.length} pages; expected ${expectedPageCount}.`);
  const pageSizesMm: Array<{ width: number; height: number }> = [];
  const pageBoxesMm: Array<{ media: PdfBox; trim: PdfBox; bleed: PdfBox }> = [];
  for (const [index, page] of pages.entries()) {
    const label = `${input.kind === "cover" ? "Cover" : "Body"} page ${index + 1}`;
    const media = page.getMediaBox(); const trim = page.getTrimBox(); const bleedBox = page.getBleedBox();
    pageSizesMm.push({ width: Number(pointsToMm(media.width).toFixed(3)), height: Number(pointsToMm(media.height).toFixed(3)) });
    pageBoxesMm.push({ media: mmBox(media), trim: mmBox(trim), bleed: mmBox(bleedBox) });
    for (const [name, box, expected] of [["MediaBox", media, expectedMedia], ["BleedBox", bleedBox, expectedMedia], ["TrimBox", trim, expectedTrim]] as const) {
      if (!explicitBox(page, name)) blockers.push(`${label} is missing explicit /${name} metadata.`);
      if (!equalBox(box, expected)) blockers.push(`${label} /${name} is ${JSON.stringify(mmBox(box))} mm; expected ${JSON.stringify(mmBox(expected))} mm.`);
    }
    if (!inside(trim, bleedBox) || !inside(trim, media)) blockers.push(`${label} /TrimBox is outside /BleedBox or /MediaBox.`);
  }
  return { valid: blockers.length === 0, blockers, pageCount: pages.length, pageSizesMm, pageBoxesMm, expectedPageCount, expectedSizeMm, expectedTrimSizeMm };
}

export async function fetchAndValidateMixamPdf(url: string, input: Omit<Parameters<typeof validateMixamPdfBytes>[0], "bytes">) {
  const response = await fetch(url, { cache: "no-store", redirect: "error" });
  if (!response.ok) throw new Error(`PDF asset fetch failed with HTTP ${response.status}.`);
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/pdf")) throw new Error(`PDF asset returned unexpected content type: ${contentType || "missing"}.`);
  return validateMixamPdfBytes({ bytes: new Uint8Array(await response.arrayBuffer()), ...input });
}
