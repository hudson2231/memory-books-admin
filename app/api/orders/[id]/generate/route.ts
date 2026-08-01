import { NextResponse } from "next/server";
import {
  generateColoringWithFal,
  generateStorybookWithGemini,
  getAspectRatioForImage,
  getMimeTypeFromUrl,
  getProductType,
  getPromptForOrder,
  getPromptVersionForOrder,
  slugify,
  uploadGeneratedBuffer,
} from "../../../../../lib/image-generation";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";

const MAX_IMAGES_PER_REQUEST = 2;

export async function POST(
  _request: Request,
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

  const productType = getProductType(order);

  if (productType === "story_book" && !process.env.GEMINI_API_KEY?.trim()) {
    return NextResponse.json(
      { error: "Missing GEMINI_API_KEY." },
      { status: 500 }
    );
  }

  if (productType === "colouring_book" && !process.env.FAL_KEY?.trim()) {
    return NextResponse.json(
      { error: "Missing FAL_KEY." },
      { status: 500 }
    );
  }

  const { data: images, error: imagesError } = await supabaseAdmin
    .from("order_images")
    .select("*")
    .eq("order_id", orderId)
    .or("generated_url.is.null,status.eq.failed,status.eq.uploaded,status.eq.not_generated")
    .order("page_number", { ascending: true })
    .limit(MAX_IMAGES_PER_REQUEST);

  if (imagesError) {
    return NextResponse.json({ error: imagesError.message }, { status: 500 });
  }

  if (!images || images.length === 0) {
    return NextResponse.json(
      { error: "No ungenerated pages left for this order." },
      { status: 400 }
    );
  }

  const orderSlug = slugify(order.customer_name || "order");
  const shortOrderId = order.id.slice(0, 8);
  const orderFolder = `${orderSlug}-${shortOrderId}`;

  const generatedResults = [];

  for (const image of images) {
    try {
      await supabaseAdmin
        .from("order_images")
        .update({
          status: "generating",
          error_message: null,
        })
        .eq("id", image.id);

      const promptText = getPromptForOrder(order, image);
      const promptVersion = getPromptVersionForOrder(order);

      const generated =
        productType === "story_book"
          ? await generateStorybookWithGemini({
              promptText,
              originalUrl: image.original_url,
              mimeType: image.mime_type || getMimeTypeFromUrl(image.original_url),
            })
          : await generateColoringWithFal({
              promptText,
              originalUrl: image.original_url,
              aspectRatio: getAspectRatioForImage(image),
            });

      const generatedUrl = await uploadGeneratedBuffer({
        buffer: generated.buffer,
        contentType: generated.contentType,
        orderFolder,
        pageNumber: image.page_number,
      });

      const { data: updatedImage, error: updateError } = await supabaseAdmin
        .from("order_images")
        .update({
          generated_url: generatedUrl,
          status: "generated",
          error_message: null,
          model_used: generated.modelUsed,
          prompt_version: promptVersion,
          generated_at: new Date().toISOString(),
          replaced_manually: false,
        })
        .eq("id", image.id)
        .select("*")
        .single();

      if (updateError) throw new Error(updateError.message);

      generatedResults.push(updatedImage);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown generation error.";

      await supabaseAdmin
        .from("order_images")
        .update({
          status: "failed",
          error_message: message,
        })
        .eq("id", image.id);

      generatedResults.push({
        id: image.id,
        status: "failed",
        error_message: message,
      });
    }
  }

  const failedCount = generatedResults.filter(
    (result) => result.status === "failed"
  ).length;

  const { count: remainingCount } = await supabaseAdmin
    .from("order_images")
    .select("id", { count: "exact", head: true })
    .eq("order_id", orderId)
    .or("generated_url.is.null,status.eq.failed,status.eq.uploaded,status.eq.not_generated");

  const newOrderStatus =
    failedCount > 0
      ? "generation_failed"
      : remainingCount && remainingCount > 0
        ? "generating"
        : "needs_review";

  await supabaseAdmin
    .from("orders")
    .update({
      status: newOrderStatus,
      pdf_status: "not_exported",
    })
    .eq("id", orderId);

  return NextResponse.json({
    provider: productType === "story_book" ? "gemini" : "fal",
    product_type: productType,
    images: generatedResults,
    generated_this_run: generatedResults.filter(
      (result) => result.status === "generated"
    ).length,
    failed_this_run: failedCount,
    remaining: remainingCount || 0,
    status: newOrderStatus,
    message:
      remainingCount && remainingCount > 0
        ? `Generated this batch. ${remainingCount} page(s) still remaining.`
        : "All pages generated. Ready for review.",
  });
}
