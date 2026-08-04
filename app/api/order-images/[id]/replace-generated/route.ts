import { NextResponse } from "next/server";
import sharp from "sharp";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

async function normaliseReplacementToJpg(buffer: Buffer) {
  return await sharp(buffer, {
    failOn: "none",
    animated: false,
  })
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize({
      width: 2400,
      height: 3200,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({
      quality: 95,
      mozjpeg: true,
    })
    .toBuffer();
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;

    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Replacement file is required." },
        { status: 400 }
      );
    }

    const { data: image, error: imageError } = await supabaseAdmin
      .from("order_images")
      .select("*, orders(id, customer_name)")
      .eq("id", id)
      .single();

    if (imageError || !image) {
      return NextResponse.json(
        { error: "Order image not found." },
        { status: 404 }
      );
    }

    const inputBuffer = Buffer.from(await file.arrayBuffer());

    let jpgBuffer: Buffer;

    try {
      jpgBuffer = await normaliseReplacementToJpg(inputBuffer);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown image conversion error.";

      return NextResponse.json(
        {
          error: `Replacement image could not be converted into a print-safe JPG. Please export this image as JPG/PNG and upload it again. ${message}`,
        },
        { status: 422 }
      );
    }

    const order = Array.isArray(image.orders) ? image.orders[0] : image.orders;
    const orderSlug = slugify(order?.customer_name || "order");
    const shortOrderId = String(image.order_id).slice(0, 8);
    const orderFolder = `${orderSlug}-${shortOrderId}`;

    const pageNumber = String(image.page_number || 1).padStart(2, "0");
    const filePath = `${orderFolder}/manual-replacements/page-${pageNumber}-${Date.now()}.jpg`;

    const { error: uploadError } = await supabaseAdmin.storage
      .from("generated")
      .upload(filePath, jpgBuffer, {
        contentType: "image/jpeg",
        upsert: true,
      });

    if (uploadError) {
      return NextResponse.json(
        { error: uploadError.message },
        { status: 500 }
      );
    }

    const { data: publicUrlData } = supabaseAdmin.storage
      .from("generated")
      .getPublicUrl(filePath);

    const generatedUrl = publicUrlData.publicUrl;

    const { data: updatedImage, error: updateError } = await supabaseAdmin
      .from("order_images")
      .update({
        generated_url: generatedUrl,
        status: "generated",
        error_message: null,
        replaced_manually: true,
        model_used: "manual-replacement",
        prompt_version: "manual-replacement",
        generated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("*")
      .single();

    if (updateError) {
      return NextResponse.json(
        { error: updateError.message },
        { status: 500 }
      );
    }

    await supabaseAdmin
      .from("orders")
      .update({
        status: "needs_review",
        pdf_status: "not_exported",
      })
      .eq("id", image.order_id);

    return NextResponse.json({
      ok: true,
      image: updatedImage,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to replace generated page.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
