import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import sharp from "sharp";
import fs from "node:fs/promises";
import path from "node:path";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";

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

async function addImagePage(
  pdfDoc: PDFDocument,
  imageUrl: string,
  pageNumber: number,
  pageWidth: number,
  pageHeight: number,
  options?: {
    caption?: string;
    captionFont?: any;
  }
) {
  const response = await fetch(imageUrl);

  if (!response.ok) {
    throw new Error(`Failed to download generated page ${pageNumber}.`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const originalBuffer = Buffer.from(arrayBuffer);

  const cleanPngBuffer = await sharp(originalBuffer)
    .flatten({ background: "#ffffff" })
    .png()
    .toBuffer();

  const embeddedImage = await pdfDoc.embedPng(cleanPngBuffer);
  const page = pdfDoc.addPage([pageWidth, pageHeight]);

  const isStoryPage = Boolean(options?.caption);

  const outerMargin = isStoryPage ? 36 : 24;
  const caption = options?.caption || "";
  const captionAreaHeight = caption ? 90 : 0;

  const imageAreaWidth = pageWidth - outerMargin * 2;
  const imageAreaHeight = pageHeight - outerMargin * 2 - captionAreaHeight;

  const scale = Math.min(
    imageAreaWidth / embeddedImage.width,
    imageAreaHeight / embeddedImage.height
  );

  const drawWidth = embeddedImage.width * scale;
  const drawHeight = embeddedImage.height * scale;

  const x = (pageWidth - drawWidth) / 2;
  const y = captionAreaHeight
    ? outerMargin + captionAreaHeight + (imageAreaHeight - drawHeight) / 2
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
      outerMargin +
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

    const captionFont = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

    const productType = getProductType(order);
    const isStoryBook = productType === "story_book";

    const pageWidth = 595.28;
    const pageHeight = 841.89;

    if (isStoryBook) {
      for (const image of images) {
        if (!image.generated_url) continue;

        await addImagePage(
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

      for (const image of images.slice(0, expectedArtworkPages)) {
        if (!image.generated_url) continue;

        await addImagePage(
          pdfDoc,
          image.generated_url,
          image.page_number,
          pageWidth,
          pageHeight
        );

        addBlankPage(pdfDoc, pageWidth, pageHeight);
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
