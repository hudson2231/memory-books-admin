import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import sharp from "sharp";
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
  return value.replace(/\s+/g, " ").trim().slice(0, 180);
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
  // Gelato pageCount includes front cover + interior pages + back cover.
  // Interior pages are single-sided: artwork page, then blank back.
  return artworkPages * 2 + 2;
}

function drawCoverText(
  page: any,
  font: any,
  boldFont: any,
  pageWidth: number,
  pageHeight: number,
  type: "front" | "back"
) {
  const black = rgb(0.05, 0.05, 0.05);
  const grey = rgb(0.55, 0.55, 0.55);

  const brand = "MEMORY BOOKS";
  const brandSize = 18;
  const brandWidth = font.widthOfTextAtSize(brand, brandSize);

  page.drawText(brand, {
    x: (pageWidth - brandWidth) / 2,
    y: pageHeight - 95,
    size: brandSize,
    font,
    color: black,
    characterSpacing: 3,
  });

  const lineY = pageHeight - 122;
  page.drawLine({
    start: { x: pageWidth / 2 - 72, y: lineY },
    end: { x: pageWidth / 2 - 18, y: lineY },
    thickness: 0.7,
    color: black,
  });

  page.drawText("♡", {
    x: pageWidth / 2 - 6,
    y: lineY - 8,
    size: 16,
    font,
    color: black,
  });

  page.drawLine({
    start: { x: pageWidth / 2 + 18, y: lineY },
    end: { x: pageWidth / 2 + 72, y: lineY },
    thickness: 0.7,
    color: black,
  });

  if (type === "front") {
    const title1 = "Colouring";
    const title2 = "Book";
    const titleSize = 64;
    const title1Width = boldFont.widthOfTextAtSize(title1, titleSize);
    const title2Width = boldFont.widthOfTextAtSize(title2, titleSize);

    page.drawText(title1, {
      x: (pageWidth - title1Width) / 2,
      y: pageHeight - 245,
      size: titleSize,
      font: boldFont,
      color: black,
    });

    page.drawText(title2, {
      x: (pageWidth - title2Width) / 2,
      y: pageHeight - 315,
      size: titleSize,
      font: boldFont,
      color: black,
    });

    const sub = "Personalised memories, ready to colour";
    const subSize = 14;
    const subWidth = font.widthOfTextAtSize(sub, subSize);

    page.drawText(sub, {
      x: (pageWidth - subWidth) / 2,
      y: pageHeight - 355,
      size: subSize,
      font,
      color: black,
    });
  } else {
    const line1 = "Your memories.";
    const line2 = "Made to colour.";
    const titleSize = 42;
    const line1Width = boldFont.widthOfTextAtSize(line1, titleSize);
    const line2Width = boldFont.widthOfTextAtSize(line2, titleSize);

    page.drawText(line1, {
      x: (pageWidth - line1Width) / 2,
      y: pageHeight - 300,
      size: titleSize,
      font: boldFont,
      color: black,
    });

    page.drawText(line2, {
      x: (pageWidth - line2Width) / 2,
      y: pageHeight - 355,
      size: titleSize,
      font: boldFont,
      color: black,
    });

    const footer = "PERSONALISED MEMORIES, BEAUTIFULLY MADE.";
    const footerSize = 10;
    const footerWidth = font.widthOfTextAtSize(footer, footerSize);

    page.drawText(footer, {
      x: (pageWidth - footerWidth) / 2,
      y: 80,
      size: footerSize,
      font,
      color: grey,
      characterSpacing: 2,
    });
  }
}

function addBlankPage(pdfDoc: PDFDocument, pageWidth: number, pageHeight: number) {
  pdfDoc.addPage([pageWidth, pageHeight]);
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

    // A4 portrait in PDF points: 210mm x 297mm.
    // Gelato product is A4 vertical.
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

      const frontCover = pdfDoc.addPage([pageWidth, pageHeight]);
      drawCoverText(frontCover, normalFont, boldFont, pageWidth, pageHeight, "front");

      for (const image of images.slice(0, expectedArtworkPages)) {
        if (!image.generated_url) continue;

        await addImagePage(
          pdfDoc,
          image.generated_url,
          image.page_number,
          pageWidth,
          pageHeight
        );

        // Blank reverse side after every colouring page.
        addBlankPage(pdfDoc, pageWidth, pageHeight);
      }

      const backCover = pdfDoc.addPage([pageWidth, pageHeight]);
      drawCoverText(backCover, normalFont, boldFont, pageWidth, pageHeight, "back");

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
