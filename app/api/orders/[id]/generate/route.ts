import { NextResponse } from "next/server";
import {
  generateColoringWithFal,
  generateStorybookWithGemini,
  getMimeTypeFromUrl,
  getProductType,
  getPromptForOrder,
  getPromptVersionForOrder,
  slugify,
  uploadGeneratedBuffer,
} from "../../../../../lib/image-generation";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

// Controlled backend batch sizes.
// The frontend loops through batches until the order is complete.
// Story Books use Gemini, so keep this lower than colouring books to avoid provider/rate-limit spikes.
const COLOURING_MAX_IMAGES_PER_REQUEST = 5;
const STORY_MAX_IMAGES_PER_REQUEST = 3;

function getGenerationInputUrl(image: Record<string, any>) {
  return (
    image.preview_url ||
    image.normalised_url ||
    image.normalized_url ||
    image.converted_url ||
    image.original_url
  );
}

function isGenerated(image: Record<string, any>) {
  return Boolean(image.generated_url) || image.status === "generated";
}

function isFailed(image: Record<string, any>) {
  return image.status === "failed";
}

function isPending(image: Record<string, any>) {
  return !isGenerated(image) && !isFailed(image);
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: orderId } = await context.params;

  console.log(`[generate] start order=${orderId}`);

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
    return NextResponse.json({ error: "Missing GEMINI_API_KEY." }, { status: 500 });
  }

  if (productType === "colouring_book" && !process.env.FAL_KEY?.trim()) {
    return NextResponse.json({ error: "Missing FAL_KEY." }, { status: 500 });
  }

  const { data: allImages, error: imagesError } = await supabaseAdmin
    .from("order_images")
    .select("*")
    .eq("order_id", orderId)
    .order("page_number", { ascending: true });

  if (imagesError) {
    return NextResponse.json({ error: imagesError.message }, { status: 500 });
  }

  const images = allImages || [];

  const pendingImages = images.filter(isPending);
  const failedImages = images.filter((image) => !isGenerated(image) && isFailed(image));

  const maxImagesPerRequest =
    productType === "story_book"
      ? STORY_MAX_IMAGES_PER_REQUEST
      : COLOURING_MAX_IMAGES_PER_REQUEST;

  // Normal pages first. Only retry failed pages after no normal pending pages remain.
  const selectedImages =
    pendingImages.length > 0
      ? pendingImages.slice(0, maxImagesPerRequest)
      : failedImages.slice(0, maxImagesPerRequest);

  if (selectedImages.length === 0) {
    return NextResponse.json(
      { error: "No ungenerated pages left for this order." },
      { status: 400 }
    );
  }

  const orderSlug = slugify(order.customer_name || "order");
  const shortOrderId = order.id.slice(0, 8);
  const orderFolder = `${orderSlug}-${shortOrderId}`;

  async function generateOneImage(image: Record<string, any>) {
    try {
      console.log(`[generate] page=${image.page_number} image=${image.id}`);

      const inputUrl = getGenerationInputUrl(image);

      if (!inputUrl || typeof inputUrl !== "string") {
        throw new Error(`No usable input image URL found for page ${image.page_number}.`);
      }

      await supabaseAdmin
        .from("order_images")
        .update({ status: "generating", error_message: null })
        .eq("id", image.id);

      const promptText = getPromptForOrder(order, image);
      const promptVersion = getPromptVersionForOrder(order);

      const generated =
        productType === "story_book"
          ? await generateStorybookWithGemini({
              promptText,
              originalUrl: inputUrl,
              mimeType: image.mime_type || getMimeTypeFromUrl(inputUrl),
            })
          : await generateColoringWithFal({
              promptText,
              originalUrl: inputUrl,
              aspectRatio: "3:4",
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

      console.log(`[generate] success page=${image.page_number}`);
      return updatedImage;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown generation error.";

      console.error(`[generate] failed page=${image.page_number}: ${message}`);

      const { error: failedUpdateError } = await supabaseAdmin
        .from("order_images")
        .update({
          status: "failed",
          error_message: message,
        })
        .eq("id", image.id);

      if (failedUpdateError) {
        console.error(
          `[generate] failed to save failure state page=${image.page_number}: ${failedUpdateError.message}`
        );
      }

      return {
        id: image.id,
        page_number: image.page_number,
        status: "failed",
        error_message: message,
      };
    }
  }

  const generatedResults = await Promise.all(
    selectedImages.map((image) => generateOneImage(image))
  );

  const { data: refreshedImages, error: refreshError } = await supabaseAdmin
    .from("order_images")
    .select("id,status,generated_url")
    .eq("order_id", orderId);

  if (refreshError) {
    return NextResponse.json({ error: refreshError.message }, { status: 500 });
  }

  const refreshed = refreshedImages || [];
  const remaining = refreshed.filter(isPending).length;
  const failedTotal = refreshed.filter((image) => !isGenerated(image) && isFailed(image)).length;

  const generatedThisRun = generatedResults.filter(
    (result) => result.status === "generated"
  ).length;

  const failedThisRun = generatedResults.filter(
    (result) => result.status === "failed"
  ).length;

  const newOrderStatus =
    remaining > 0
      ? "generating"
      : failedTotal > 0
        ? "generation_failed"
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
    generated_this_run: generatedThisRun,
    failed_this_run: failedThisRun,
    remaining,
    failed_total: failedTotal,
    status: newOrderStatus,
  });
}
