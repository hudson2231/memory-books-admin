import fs from "node:fs/promises";
import type { PDFDocument } from "pdf-lib";

export const STORY_COVER_SPREAD_WIDTH = 1215.72;
export const STORY_COVER_SPREAD_HEIGHT = 810.709;
export const STORY_COVER_SOURCE_WIDTH = 5066;
export const STORY_COVER_SOURCE_HEIGHT = 3378;

export async function addStoryCoverSpreadPage(
  pdfDoc: PDFDocument,
  coverWrapPath: string
) {
  let sourceBuffer: Buffer;

  try {
    sourceBuffer = await fs.readFile(coverWrapPath);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown filesystem error.";

    throw new Error("Story cover wrap could not be read. " + message);
  }

  const coverWrap = await pdfDoc.embedJpg(sourceBuffer);

  if (
    coverWrap.width !== STORY_COVER_SOURCE_WIDTH ||
    coverWrap.height !== STORY_COVER_SOURCE_HEIGHT
  ) {
    throw new Error(
      "Story cover wrap dimensions changed. Expected " +
        STORY_COVER_SOURCE_WIDTH +
        "x" +
        STORY_COVER_SOURCE_HEIGHT +
        "px, got " +
        coverWrap.width +
        "x" +
        coverWrap.height +
        "px."
    );
  }

  const page = pdfDoc.addPage([
    STORY_COVER_SPREAD_WIDTH,
    STORY_COVER_SPREAD_HEIGHT,
  ]);

  // The source is already the complete 428.879 x 286 mm wrap. Mapping the
  // full JPEG directly to the matching page box avoids panel splitting,
  // cropping, and the high memory cost of decoding/re-encoding a large PNG.
  page.drawImage(coverWrap, {
    x: 0,
    y: 0,
    width: STORY_COVER_SPREAD_WIDTH,
    height: STORY_COVER_SPREAD_HEIGHT,
  });
}
