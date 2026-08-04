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

const MAX_IMAGES_PER_REQUEST = 2;

function isGenerated(image: Record<string, any>) {
  return Boolean(image.generated_url) || image.status === "generated";
}

function isFailed(image: Record<string, any>) {
  return image.status === "failed";
}

function isNormallyPending(image: Record<string, any>) {
  return !isGenerated(image) && !isFailed(image);
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: orderId } = await context.params;

  console.log(`[generate] Starting order generation: ${orderId}`);

  const { data: order, error: orderError } = await supabaseAdmin
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .single();

  if (orderError || !order) {
    console.error(`[generate] Order not found: ${orderId}`, orderError);
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

  const { data: allImages, error: imagesError } = await supabaseAdmin
    .from("order_images")
    .select("*")
    .eq("order_id", orderId)
    .order("page_number", { ascending: true });

  if (imagesError) {
    console.error(`[generate] Could not load images for order ${orderId}`, imagesError);
    return NextResponse.json({ error: imagesError.message }, { status: 500 });
  }

  const images = allImages || [];

  const normalPendingImages = images.filter(isNormallyPending);
  const failedImages = images.filter(
    (image) => !isGenerated(image) && isFailed(image)
  );

  /*
    Important:
    - Generate normal uploaded/not-generated pages first.
    - Only retry failed pages if there are no normal pending pages left.
    This prevents 1 bad page from blocking the remaining 18 pages.
  */
  const selectedImages =
    normalPendingImages.length > 0
      ? normalPendingImages.slice(0, MAX_IMAGES_PER_REQUEST)
      : failedImages.slice(0, MAX_IMAGES_PER_REQUEST);

  if (selectedImages.length === 0) {
    return NextResponse.json(
      { error: "No ungenerated pages left for this order." },
      { status: 400 }
    );
  }

  const orderSlug = slugify(order.customer_name || "order");
  const shortOrderId = order.id.slice(0, 8);
  const orderFolder = `${orderSlug}-${shortOrderId}`;

  const generatedResults = [];

  for (const image of selectedImages) {
    const pageNumber = image.page_number;

    try {
      console.log(
        `[generate] Generating order ${orderId}, page ${pageNumber}, image ${image.id}`
      );

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

      console.log(
        `[generate] Generated order ${orderId}, page ${pageNumber}`
      );

      generatedResults.push(updatedImage);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown generation error.";

      console.error(
        `[generate] Failed order ${orderId}, page ${pageNumber}: ${message}`
      );

      await supabaseAdmin
        .from("order_images")
        .update({
          status: "failed",
          error_message: message,
        })
        .eq("id", image.id);

      generatedResults.push({
        id: image.id,
        page_number: pageNumber,
        status: "failed",
        error_message: message,
      });
    }
  }

  const { data: refreshedImages, error: refreshedError } = await supabaseAdmin
    .from("order_images")
    .select("id,page_number,status,generated_url")
    .eq("order_id", orderId)
    .order("page_number", { ascending: true });

  if (refreshedError) {
    return NextResponse.json({ error: refreshedError.message }, { status: 500 });
  }

  const refreshed = refreshedImages || [];

  const remainingNormal = refreshed.filter(isNormallyPending).length;
  const failedTotal = refreshed.filter(
    (image) => !isGenerated(image) && isFailed(image)
  ).length;

  const generatedThisRun = generatedResults.filter(
    (result) => result.status === "generated"
  ).length;

  const failedThisRun = generatedResults.filter(
    (result) => result.status === "failed"
  ).length;

  const newOrderStatus =
    remainingNormal > 0
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

  console.log(
    `[generate] Finished batch for ${orderId}. generated_this_run=${generatedThisRun}, failed_this_run=${failedThisRun}, remaining=${remainingNormal}, failed_total=${failedTotal}`
  );

  return NextResponse.json({
    provider: productType === "story_book" ? "gemini" : "fal",
    product_type: productType,
    images: generatedResults,
    generated_this_run: generatedThisRun,
    failed_this_run: failedThisRun,
    remaining: remainingNormal,
    failed_total: failedTotal,
    status: newOrderStatus,
    message:
      remainingNormal > 0
        ? `Generated this batch. ${remainingNormal} page(s) still remaining.`
        : failedTotal > 0
          ? `Generation finished with ${failedTotal} failed page(s).`
          : "All pages generated. Ready for review.",
  });
}
