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
  if (typeof value !== "string") {
    return "";
  }

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

  if (current) {
    lines.push(current);
  }

  return lines.slice(0, 3);
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
    return NextResponse.json(
      { error: "Order not found." },
      { status: 404 }
    );
  }

  const { data: images, error: imagesError } = await supabaseAdmin
    .from("order_images")
    .select("*")
    .eq("order_id", orderId)
    .eq("approved", true)
    .not("generated_url", "is", null)
    .order("page_number", { ascending: true });

  if (imagesError) {
    return NextResponse.json(
      { error: imagesError.message },
      { status: 500 }
    );
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

    // A4 portrait in PDF points: 210mm x 297mm
    const pageWidth = 595.28;
    const pageHeight = 841.89;

    for (const image of images) {
      if (!image.generated_url) {
        continue;
      }

      const response = await fetch(image.generated_url);

      if (!response.ok) {
        throw new Error(`Failed to download generated page ${image.page_number}.`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const originalBuffer = Buffer.from(arrayBuffer);

      // Force every generated image into a clean PNG before PDF embedding.
      // This avoids PDF export failures from odd image encodings.
      const cleanPngBuffer = await sharp(originalBuffer)
        .flatten({ background: "#ffffff" })
        .png()
        .toBuffer();

      const embeddedImage = await pdfDoc.embedPng(cleanPngBuffer);

      const page = pdfDoc.addPage([pageWidth, pageHeight]);

      const margin = 36;
      const caption = isStoryBook ? cleanCaption(image.caption_text) : "";
      const captionAreaHeight = isStoryBook && caption ? 90 : 0;
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

      if (isStoryBook && caption) {
        const lines = wrapText(caption, 54);
        const fontSize = 16;
        const lineHeight = 21;
        const totalTextHeight = lines.length * lineHeight;
        const startY = margin + (captionAreaHeight - totalTextHeight) / 2 + totalTextHeight - fontSize;

        lines.forEach((line, index) => {
          const textWidth = captionFont.widthOfTextAtSize(line, fontSize);
          page.drawText(line, {
            x: (pageWidth - textWidth) / 2,
            y: startY - index * lineHeight,
            size: fontSize,
            font: captionFont,
            color: rgb(0.12, 0.12, 0.12),
          });
        });
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
      exported_pages: images.length,
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

    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
