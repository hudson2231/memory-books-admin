import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import sharp from "sharp";
import fs from "node:fs/promises";
import path from "node:path";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";

const A4_PAGE_WIDTH = 595.28;
const A4_PAGE_HEIGHT = 841.89;

const A4_EXPORT_WIDTH_PX = 2480;
const A4_EXPORT_HEIGHT_PX = 3508;

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

  drawCenteredText(
    page,
    "Memory Books",
    normalFont,
    23,
    pageHeight - 118,
    pageWidth,
    gold
  );

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
      order.product_type === "story_book" ? "Made into a Story Book" : "Made to Colour",
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
    const lines = wrapGraceTextByWidth(
      message,
      normalFont,
      messageFontSize,
      maxTextWidth
    );

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
      ((order.product_type === "story_book") ? "A personalised story book made especially for you." : "A personalised colouring book made especially for you."),
      normalFont,
      17,
      pageHeight - 470,
      pageWidth,
      muted
    );
  }

  drawCenteredText(
    page,
    ((order.product_type === "story_book") ? "READ, GIFT, AND KEEP FOREVER." : "COLOUR, GIFT, AND KEEP FOREVER."),
    normalFont,
    9,
    86,
    pageWidth,
    softGreen,
    { characterSpacing: 2.2 }
  );
}


function addBlankPage(pdfDoc: PDFDocument, pageWidth: number, pageHeight: number) {
  pdfDoc.addPage([pageWidth, pageHeight]);
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

  const pngBuffer = await sharp(sourceBuffer)
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


async function normaliseColouringPageToA4Jpg(originalBuffer: Buffer) {
  const output = await sharp(originalBuffer, {
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
      quality: 82,
      mozjpeg: true,
    })
    .toBuffer();

  // JPEG files must start with FF D8. If not, pdf-lib will throw "SOI not found in JPEG".
  if (output[0] !== 0xff || output[1] !== 0xd8) {
    throw new Error("Colouring page conversion did not produce a valid JPEG.");
  }

  return output;
}

async function addImagePage(
  pdfDoc: PDFDocument,
  imageUrl: string,
  pageNumber: number,
  pageWidth: number,
  pageHeight: number,
  options?: {
    caption?: string;
    captionFont?: any;
    pageKind?: "colouring" | "story";
  }
) {
  const response = await fetch(imageUrl);

  if (!response.ok) {
    throw new Error(`Failed to download generated page ${pageNumber}.`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const originalBuffer = Buffer.from(arrayBuffer);

  const pageKind = options?.pageKind || "colouring";

  if (pageKind === "colouring") {
    const a4JpgBuffer = await normaliseColouringPageToA4Jpg(originalBuffer);
    const embeddedImage = await pdfDoc.embedJpg(a4JpgBuffer);
    const page = pdfDoc.addPage([pageWidth, pageHeight]);

    page.drawImage(embeddedImage, {
      x: 0,
      y: 0,
      width: pageWidth,
      height: pageHeight,
    });

    return;
  }

  const cleanPngBuffer = await sharp(originalBuffer)
    .rotate()
    .flatten({ background: "#ffffff" })
    .png()
    .toBuffer();

  const embeddedImage = await pdfDoc.embedPng(cleanPngBuffer);
  const page = pdfDoc.addPage([pageWidth, pageHeight]);

  const margin = 36;
  const caption = options?.caption || "";
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

  if (caption && options?.captionFont) {
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
      const storyFrontCoverPath = path.join(
        process.cwd(),
        "public",
        "covers",
        "story-front.png"
      );

      const storyBackCoverPath = path.join(
        process.cwd(),
        "public",
        "covers",
        "story-back.png"
      );

      await addCoverImagePage(pdfDoc, storyFrontCoverPath, pageWidth, pageHeight);

      addGracePage(pdfDoc, pageWidth, pageHeight, normalFont, boldFont, order);

      for (const image of images) {
        if (!image.generated_url) continue;

        await addImagePage(
          pdfDoc,
          image.generated_url,
          image.page_number,
          pageWidth,
          pageHeight,
          {
            pageKind: "story",
            caption: cleanCaption(image.caption_text),
            captionFont,
          }
        );
      }

      // Keep Story Book PDFs at an even page count before the back cover.
      // This gives us: front cover, grace page, story pages, optional blank filler, back cover.
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

      const frontCoverPath = path.join(
        process.cwd(),
        "public",
        "covers",
        "colouring-front.png"
      );

      const backCoverPath = path.join(
        process.cwd(),
        "public",
        "covers",
        "colouring-back.png"
      );

      await addCoverImagePage(pdfDoc, frontCoverPath, pageWidth, pageHeight);

      addGracePage(pdfDoc, pageWidth, pageHeight, normalFont, boldFont, order);

      const colouringImages = images.slice(0, expectedArtworkPages);

      for (const [index, image] of colouringImages.entries()) {
        if (!image.generated_url) continue;

        try {
          await addImagePage(
            pdfDoc,
            image.generated_url,
            image.page_number,
            pageWidth,
            pageHeight,
            {
              pageKind: "colouring",
            }
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Unknown PDF image error.";

          throw new Error(
            `PDF export failed on colouring page ${image.page_number}. ${message}`
          );
        }

        // Blank reverse side after every colouring page except the final artwork page.
        // The grace page uses the inside-front page, so total Gelato page count stays the same.
        if (index < colouringImages.length - 1) {
          addBlankPage(pdfDoc, pageWidth, pageHeight);
        }
      }

      await addCoverImagePage(pdfDoc, backCoverPath, pageWidth, pageHeight);

      const targetGelatoPageCount =
        getGelatoPageCountForColouringBook(expectedArtworkPages);

      if (pdfDoc.getPageCount() !== targetGelatoPageCount) {
        throw new Error(
          `PDF page count mismatch. Expected ${targetGelatoPageCount}, got ${pdfDoc.getPageCount()}.`
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
      throw new Error(uploadError.message);
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
      throw new Error(updateError.message);
    }

    return NextResponse.json({
      order: updatedOrder,
      pdf_url: pdfUrl,
      exported_pages: exportedPages,
      gelato_page_count:
        productType === "colouring_book" ? exportedPages : null,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to export PDF.";

    console.error("PDF export failed:", message);

    await supabaseAdmin
      .from("orders")
      .update({
        pdf_status: "export_failed",
      })
      .eq("id", orderId);

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
