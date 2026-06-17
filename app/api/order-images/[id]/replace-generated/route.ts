import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: imageId } = await context.params;

  const { data: image, error: imageError } = await supabaseAdmin
    .from("order_images")
    .select("*")
    .eq("id", imageId)
    .single();

  if (imageError || !image) {
    return NextResponse.json(
      { error: "Image row not found." },
      { status: 404 }
    );
  }

  const { data: order, error: orderError } = await supabaseAdmin
    .from("orders")
    .select("*")
    .eq("id", image.order_id)
    .single();

  if (orderError || !order) {
    return NextResponse.json(
      { error: "Order not found." },
      { status: 404 }
    );
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Replacement file is required." },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const orderSlug = slugify(order.customer_name || "order");
    const shortOrderId = order.id.slice(0, 8);
    const orderFolder = `${orderSlug}-${shortOrderId}`;

    const generatedPath = `${orderFolder}/page-${image.page_number}-manual-replacement-${Date.now()}.png`;

    const { error: uploadError } = await supabaseAdmin.storage
      .from("generated")
      .upload(generatedPath, buffer, {
        contentType: file.type || "image/png",
        upsert: true,
      });

    if (uploadError) {
      throw new Error(uploadError.message);
    }

    const { data: publicUrlData } = supabaseAdmin.storage
      .from("generated")
      .getPublicUrl(generatedPath);

    const generatedUrl = publicUrlData.publicUrl;

    const { data: updatedImage, error: updateError } = await supabaseAdmin
      .from("order_images")
      .update({
        generated_url: generatedUrl,
        status: "generated",
        approved: false,
        error_message: null,
        model_used: "manual_upload",
        prompt_version: "manual_replacement",
        generated_at: new Date().toISOString(),
        replaced_manually: true,
      })
      .eq("id", image.id)
      .select("*")
      .single();

    if (updateError) {
      throw new Error(updateError.message);
    }

    await supabaseAdmin
      .from("orders")
      .update({
        status: "needs_review",
        pdf_status: "not_exported",
      })
      .eq("id", order.id);

    return NextResponse.json({
      image: updatedImage,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Manual replacement failed.";

    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
