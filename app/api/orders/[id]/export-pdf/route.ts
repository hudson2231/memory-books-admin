import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import sharp from "sharp";
import fs from "node:fs/promises";
import path from "node:path";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const EXPORT_VERSION = "pdf-export-clean-jpeg-v3";

const A4_PAGE_WIDTH = 595.28;
const A4_PAGE_HEIGHT = 841.89;

// 200 DPI A4. Big enough for print line art, small enough for 20/32/40 page exports.
const A4_EXPORT_WIDTH_PX = 1654;
const A4_EXPORT_HEIGHT_PX = 2339;

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function getProductType(order: Record<string, any>) {
  return order.product_type === "story_book" ? "story_book" : "colouring_book";
}

function getExpectedArtworkPages(order: Record<string, any>, fallback: number) {
  const candidates = [
    order.page_count,
    order.pages,
    order.product_title,
    order.variant_title,
    order.title,
  ];

  for (const value of candidates) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return value;
    }

    if (typeof value === "string") {
      const match = value.match(/(\d+)\s*(page|pages)/i);
      if (match?.[1]) return Number(match[1]);
    }
  }

  return fallback;
}

function getGelatoPageCountForColouringBook(artworkPages: number) {
  return artworkPages * 2 + 2;
}

function cleanCaption(value: unknown) {
  if (typeof value !== "string") return "";

  return value
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function wrapText(text: string, maxCharsPerLine: number) {
  const words = text.split(" ").filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;

    if (next.length > maxCharsPerLine && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }

  if (current) lines.push(current);
  return lines.slice(0, 3);
}

function cleanGraceText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function wrapGraceTextByWidth(
  text: string,
  font: any,
  fontSize: number,
  maxWidth: number
) {
  const words = text.split(" ").filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    const nextWidth = font.widthOfTextAtSize(next, fontSize);

    if (nextWidth > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }

  if (current) lines.push(current);
  return lines.slice(0, 6);
}

function drawCenteredText(
  page: any,
  text: string,
  font: any,
  size: number,
  y: number,
  pageWidth: number,
  color: any,
  options?: { characterSpacing?: number }
) {
  const width = font.widthOfTextAtSize(text, size);
  page.drawText(text, {
    x: (pageWidth - width) / 2,
    y,
    size,
    font,
    color,
    characterSpacing: options?.characterSpacing,
  });
}

function addBlankPage(pdfDoc: PDFDocument, pageWidth: number, pageHeight: number) {
  pdfDoc.addPage([pageWidth, pageHeight]);
}

function addGracePage(
  pdfDoc: PDFDocument,
  pageWidth: number,
  pageHeight: number,
  normalFont: any,
  boldFont: any,
  order: Record<string, any>
) {
  const page = pdfDoc.addPage([pageWidth, pageHeight]);

  const cream = rgb(0.985, 0.955, 0.885);
  const darkGreen = rgb(0.13, 0.18, 0.1);
  const softGreen = rgb(0.36, 0.43, 0.28);
  const gold = rgb(0.58, 0.45, 0.22);
  const muted = rgb(0.36, 0.32, 0.26);
  const paleGold = rgb(0.78, 0.67, 0.43);

  const recipient = cleanGraceText(order.grace_recipient, 80);
  const fromName = cleanGraceText(order.grace_from, 80);
  const message = cleanGraceText(order.grace_message, 240);
  const isStoryBook = order.product_type === "story_book";

  page.drawRectangle({
    x: 0,
    y: 0,
    width: pageWidth,
    height: pageHeight,
    color: cream,
  });

  const borderMargin = 34;

  page.drawRectangle({
    x: borderMargin,
    y: borderMargin,
    width: pageWidth - borderMargin * 2,
    height: pageHeight - borderMargin * 2,
    borderColor: rgb(0.78, 0.72, 0.58),
    borderWidth: 0.65,
  });

  page.drawRectangle({
    x: borderMargin + 8,
    y: borderMargin + 8,
    width: pageWidth - (borderMargin + 8) * 2,
    height: pageHeight - (borderMargin + 8) * 2,
    borderColor: rgb(0.88, 0.82, 0.68),
    borderWidth: 0.35,
  });

  drawCenteredText(page, "Memory Books", normalFont, 23, pageHeight - 118, pageWidth, gold);

  page.drawLine({
    start: { x: pageWidth / 2 - 118, y: pageHeight - 134 },
    end: { x: pageWidth / 2 - 36, y: pageHeight - 134 },
    thickness: 0.6,
    color: paleGold,
  });

  page.drawLine({
    start: { x: pageWidth / 2 + 36, y: pageHeight - 134 },
    end: { x: pageWidth / 2 + 118, y: pageHeight - 134 },
    thickness: 0.6,
    color: paleGold,
  });

  drawCenteredText(page, "·", normalFont, 16, pageHeight - 142, pageWidth, gold);

  if (recipient) {
    drawCenteredText(
      page,
      "MADE ESPECIALLY FOR",
      normalFont,
      10,
      pageHeight - 255,
      pageWidth,
      gold,
      { characterSpacing: 1.9 }
    );

    const recipientSize = recipient.length > 16 ? 42 : 50;

    drawCenteredText(
      page,
      recipient,
      boldFont,
      recipientSize,
      pageHeight - 325,
      pageWidth,
      darkGreen
    );
  } else {
    drawCenteredText(
      page,
      "Your Memories",
      boldFont,
      45,
      pageHeight - 285,
      pageWidth,
      darkGreen
    );

    drawCenteredText(
      page,
      isStoryBook ? "Made into a Story Book" : "Made to Colour",
      boldFont,
      45,
      pageHeight - 340,
      pageWidth,
      darkGreen
    );
  }

  page.drawLine({
    start: { x: pageWidth / 2 - 82, y: pageHeight - 365 },
    end: { x: pageWidth / 2 - 22, y: pageHeight - 365 },
    thickness: 0.55,
    color: paleGold,
  });

  page.drawLine({
    start: { x: pageWidth / 2 + 22, y: pageHeight - 365 },
    end: { x: pageWidth / 2 + 82, y: pageHeight - 365 },
    thickness: 0.55,
    color: paleGold,
  });

  drawCenteredText(page, "·", normalFont, 13, pageHeight - 372, pageWidth, gold);

  if (fromName) {
    drawCenteredText(
      page,
      `From ${fromName}`,
      normalFont,
      23,
      pageHeight - 420,
      pageWidth,
      gold
    );
  }

  if (message) {
    const messageFontSize = 18;
    const lineHeight = 27;
    const maxTextWidth = pageWidth - 170;
    const lines = wrapGraceTextByWidth(message, normalFont, messageFontSize, maxTextWidth);
    const totalHeight = (lines.length - 1) * lineHeight;
    const startY = pageHeight - 510 + totalHeight / 2;

    lines.forEach((line, index) => {
      drawCenteredText(
        page,
        line,
        normalFont,
        messageFontSize,
        startY - index * lineHeight,
        pageWidth,
        muted
      );
    });
  } else if (!recipient && !fromName) {
    drawCenteredText(
      page,
      isStoryBook
        ? "A personalised story book made especially for you."
        : "A personalised colouring book made especially for you.",
      normalFont,
      17,
      pageHeight - 470,
      pageWidth,
      muted
    );
  }

  drawCenteredText(
    page,
    isStoryBook ? "READ, GIFT, AND KEEP FOREVER." : "COLOUR, GIFT, AND KEEP FOREVER.",
    normalFont,
    9,
    86,
    pageWidth,
    softGreen,
    { characterSpacing: 2.2 }
  );
}

function getCoverDrawBox(
  imageWidth: number,
  imageHeight: number,
  pageWidth: number,
  pageHeight: number
) {
  const scale = Math.max(pageWidth / imageWidth, pageHeight / imageHeight);
  const drawWidth = imageWidth * scale;
  const drawHeight = imageHeight * scale;

  return {
    x: (pageWidth - drawWidth) / 2,
    y: (pageHeight - drawHeight) / 2,
    width: drawWidth,
    height: drawHeight,
  };
}

async function addCoverImagePage(
  pdfDoc: PDFDocument,
  imagePath: string,
  pageWidth: number,
  pageHeight: number
) {
  const sourceBuffer = await fs.readFile(imagePath);

  const pngBuffer = await sharp(sourceBuffer, {
    failOn: "none",
    animated: false,
  })
    .flatten({ background: "#fff7e8" })
    .png()
    .toBuffer();

  const embeddedImage = await pdfDoc.embedPng(pngBuffer);
  const page = pdfDoc.addPage([pageWidth, pageHeight]);

  const box = getCoverDrawBox(
    embeddedImage.width,
    embeddedImage.height,
    pageWidth,
    pageHeight
  );

  page.drawImage(embeddedImage, box);
}

async function downloadImageBuffer(imageUrl: string, pageNumber: number) {
  const response = await fetch(imageUrl, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(
      `Failed to download generated image for page ${pageNumber}. HTTP ${response.status}`
    );
  }

  const contentType = response.headers.get("content-type") || "";
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (buffer.length < 20) {
    throw new Error(`Generated image for page ${pageNumber} downloaded as an empty file.`);
  }

  if (contentType.includes("text/html")) {
    throw new Error(`Generated image for page ${pageNumber} downloaded as HTML, not an image.`);
  }

  return buffer;
}

async function makeColouringPageJpeg(inputBuffer: Buffer, pageNumber: number) {
  const output = await sharp(inputBuffer, {
    failOn: "none",
    animated: false,
  })
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize({
      width: A4_EXPORT_WIDTH_PX,
      height: A4_EXPORT_HEIGHT_PX,
      fit: "cover",
      position: "centre",
    })
    .jpeg({
      quality: 78,
      progressive: false,
      chromaSubsampling: "4:4:4",
    })
    .toBuffer();

  const outputBuffer = Buffer.from(output);

  if (outputBuffer[0] !== 0xff || outputBuffer[1] !== 0xd8) {
    throw new Error(
      `Sharp did not output a valid JPEG for page ${pageNumber}. First bytes: ${outputBuffer
        .subarray(0, 8)
        .toString("hex")}`
    );
  }

  return outputBuffer;
}

async function makeStoryPagePng(inputBuffer: Buffer) {
  return await sharp(inputBuffer, {
    failOn: "none",
    animated: false,
  })
    .rotate()
    .flatten({ background: "#ffffff" })
    .png()
    .toBuffer();
}

async function addColouringImagePage(
  pdfDoc: PDFDocument,
  imageUrl: string,
  pageNumber: number,
  pageWidth: number,
  pageHeight: number
) {
  const downloaded = await downloadImageBuffer(imageUrl, pageNumber);
  const jpegBuffer = await makeColouringPageJpeg(downloaded, pageNumber);

  const embeddedImage = await pdfDoc.embedJpg(jpegBuffer);
  const page = pdfDoc.addPage([pageWidth, pageHeight]);

  page.drawImage(embeddedImage, {
    x: 0,
    y: 0,
    width: pageWidth,
    height: pageHeight,
  });
}

async function addStoryImagePage(
  pdfDoc: PDFDocument,
  imageUrl: string,
  pageNumber: number,
  pageWidth: number,
  pageHeight: number,
  options: {
    caption?: string;
    captionFont: any;
  }
) {
  const downloaded = await downloadImageBuffer(imageUrl, pageNumber);
  const cleanPngBuffer = await makeStoryPagePng(downloaded);

  const embeddedImage = await pdfDoc.embedPng(cleanPngBuffer);
  const page = pdfDoc.addPage([pageWidth, pageHeight]);

  const margin = 36;
  const caption = options.caption || "";
  const captionAreaHeight = caption ? 90 : 0;
  const imageAreaWidth = pageWidth - margin * 2;
  const imageAreaHeight = pageHeight - margin * 2 - captionAreaHeight;

  const scale = Math.min(
    imageAreaWidth / embeddedImage.width,
    imageAreaHeight / embeddedImage.height
  );

  const drawWidth = embeddedImage.width * scale;
  const drawHeight = embeddedImage.height * scale;

  const x = (pageWidth - drawWidth) / 2;
  const y = captionAreaHeight
    ? margin + captionAreaHeight + (imageAreaHeight - drawHeight) / 2
    : (pageHeight - drawHeight) / 2;

  page.drawImage(embeddedImage, {
    x,
    y,
    width: drawWidth,
    height: drawHeight,
  });

  if (caption && options.captionFont) {
    const lines = wrapText(caption, 54);
    const fontSize = 16;
    const lineHeight = 21;
    const totalTextHeight = lines.length * lineHeight;
    const startY =
      margin +
      (captionAreaHeight - totalTextHeight) / 2 +
      totalTextHeight -
      fontSize;

    lines.forEach((line, index) => {
      const textWidth = options.captionFont.widthOfTextAtSize(line, fontSize);

      page.drawText(line, {
        x: (pageWidth - textWidth) / 2,
        y: startY - index * lineHeight,
        size: fontSize,
        font: options.captionFont,
        color: rgb(0.12, 0.12, 0.12),
      });
    });
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: orderId } = await context.params;

  const { data: order, error: orderError } = await supabaseAdmin
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .single();

  if (orderError || !order) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  const { data: images, error: imagesError } = await supabaseAdmin
    .from("order_images")
    .select("*")
    .eq("order_id", orderId)
    .eq("approved", true)
    .not("generated_url", "is", null)
    .order("page_number", { ascending: true });

  if (imagesError) {
    return NextResponse.json({ error: imagesError.message }, { status: 500 });
  }

  if (!images || images.length === 0) {
    return NextResponse.json(
      { error: "No approved generated pages found. Approve at least one page first." },
      { status: 400 }
    );
  }

  await supabaseAdmin
    .from("orders")
    .update({
      pdf_status: "exporting",
      pdf_url: null,
    })
    .eq("id", orderId);

  try {
    const pdfDoc = await PDFDocument.create();

    const normalFont = await pdfDoc.embedFont(StandardFonts.TimesRoman);
    const boldFont = await pdfDoc.embedFont(StandardFonts.TimesRoman);
    const captionFont = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

    const productType = getProductType(order);
    const isStoryBook = productType === "story_book";

    const pageWidth = A4_PAGE_WIDTH;
    const pageHeight = A4_PAGE_HEIGHT;

    if (isStoryBook) {
      const storyFrontCoverPath = path.join(process.cwd(), "public", "covers", "story-front.png");
      const storyBackCoverPath = path.join(process.cwd(), "public", "covers", "story-back.png");

      await addCoverImagePage(pdfDoc, storyFrontCoverPath, pageWidth, pageHeight);
      addGracePage(pdfDoc, pageWidth, pageHeight, normalFont, boldFont, order);

      for (const image of images) {
        if (!image.generated_url) continue;

        await addStoryImagePage(
          pdfDoc,
          image.generated_url,
          image.page_number,
          pageWidth,
          pageHeight,
          {
            caption: cleanCaption(image.caption_text),
            captionFont,
          }
        );
      }

      if ((pdfDoc.getPageCount() + 1) % 2 !== 0) {
        addBlankPage(pdfDoc, pageWidth, pageHeight);
      }

      await addCoverImagePage(pdfDoc, storyBackCoverPath, pageWidth, pageHeight);
    } else {
      const expectedArtworkPages = getExpectedArtworkPages(order, images.length);

      if (images.length < expectedArtworkPages) {
        return NextResponse.json(
          {
            error: `This colouring book needs ${expectedArtworkPages} approved generated pages before export. Currently approved: ${images.length}.`,
          },
          { status: 400 }
        );
      }

      const frontCoverPath = path.join(process.cwd(), "public", "covers", "colouring-front.png");
      const backCoverPath = path.join(process.cwd(), "public", "covers", "colouring-back.png");

      await addCoverImagePage(pdfDoc, frontCoverPath, pageWidth, pageHeight);
      addGracePage(pdfDoc, pageWidth, pageHeight, normalFont, boldFont, order);

      const colouringImages = images.slice(0, expectedArtworkPages);

      for (const [index, image] of colouringImages.entries()) {
        if (!image.generated_url) continue;

        try {
          await addColouringImagePage(
            pdfDoc,
            image.generated_url,
            image.page_number,
            pageWidth,
            pageHeight
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Unknown PDF image error.";

          throw new Error(
            `${EXPORT_VERSION}: PDF export failed on colouring page ${image.page_number}. ${message}`
          );
        }

        if (index < colouringImages.length - 1) {
          addBlankPage(pdfDoc, pageWidth, pageHeight);
        }
      }

      await addCoverImagePage(pdfDoc, backCoverPath, pageWidth, pageHeight);

      const targetGelatoPageCount = getGelatoPageCountForColouringBook(expectedArtworkPages);

      if (pdfDoc.getPageCount() !== targetGelatoPageCount) {
        throw new Error(
          `${EXPORT_VERSION}: PDF page count mismatch. Expected ${targetGelatoPageCount}, got ${pdfDoc.getPageCount()}.`
        );
      }
    }

    const pdfBytes = await pdfDoc.save();

    const orderSlug = slugify(order.customer_name || "order");
    const shortOrderId = order.id.slice(0, 8);
    const orderFolder = `${orderSlug}-${shortOrderId}`;
    const pdfPath = `${orderFolder}/memory-book-${Date.now()}.pdf`;

    const { error: uploadError } = await supabaseAdmin.storage
      .from("pdfs")
      .upload(pdfPath, Buffer.from(pdfBytes), {
        contentType: "application/pdf",
        upsert: true,
      });

    if (uploadError) {
      throw new Error(`${EXPORT_VERSION}: PDF upload failed. ${uploadError.message}`);
    }

    const { data: publicUrlData } = supabaseAdmin.storage
      .from("pdfs")
      .getPublicUrl(pdfPath);

    const pdfUrl = publicUrlData.publicUrl;
    const exportedPages = pdfDoc.getPageCount();

    const { data: updatedOrder, error: updateError } = await supabaseAdmin
      .from("orders")
      .update({
        pdf_url: pdfUrl,
        pdf_status: "exported",
        exported_at: new Date().toISOString(),
        status: "exported",
      })
      .eq("id", orderId)
      .select("*")
      .single();

    if (updateError) {
      throw new Error(`${EXPORT_VERSION}: Order update failed. ${updateError.message}`);
    }

    return NextResponse.json({
      ok: true,
      version: EXPORT_VERSION,
      order: updatedOrder,
      pdf_url: pdfUrl,
      exported_pages: exportedPages,
      gelato_page_count: productType === "colouring_book" ? exportedPages : null,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : `${EXPORT_VERSION}: Failed to export PDF.`;

    console.error("PDF export failed:", message);

    await supabaseAdmin
      .from("orders")
      .update({
        pdf_status: "export_failed",
      })
      .eq("id", orderId);

    return NextResponse.json(
      {
        ok: false,
        version: EXPORT_VERSION,
        error: message,
      },
      { status: 500 }
    );
  }
}
