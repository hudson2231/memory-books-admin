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
import {
  acquireGenerationProviderSlot,
  claimOrderImageGeneration,
  markGenerationAttempted,
  markGenerationFailure,
  markGenerationSuccess,
  providerForProductType,
  releaseGenerationClaimWithoutAttempt,
  releaseGenerationProviderSlot,
  withBoundedProviderRetry,
} from "../../../../../lib/generation-reliability";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

// These remain per-invocation work bounds. Provider calls are additionally
// limited across every Vercel instance by generation_provider_slots.
const COLOURING_MAX_IMAGES_PER_REQUEST = 5;
const STORY_MAX_IMAGES_PER_REQUEST = 3;

function getGenerationInputUrl(image: Record<string, unknown>) {
  return image.preview_url || image.normalised_url || image.normalized_url || image.converted_url || image.original_url;
}

function hasGeneratedOutput(image: Record<string, unknown>) {
  return Boolean(image.generated_url);
}

function retryableNormalImage(image: Record<string, unknown>) {
  return !hasGeneratedOutput(image) && typeof image.status === "string" && ["uploaded", "failed", "not_generated"].includes(image.status);
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id: orderId } = await context.params;
  let mode: "normal" | "regenerate_all" = "normal";
  try {
    const body = await request.json();
    if (body?.mode === "regenerate_all") mode = "regenerate_all";
  } catch { /* normal empty POST */ }

  const { data: order, error: orderError } = await supabaseAdmin.from("orders").select("*").eq("id", orderId).single();
  if (orderError || !order) return NextResponse.json({ error: "Order not found." }, { status: 404 });

  const productType = getProductType(order);
  if (productType === "story_book" && !process.env.GEMINI_API_KEY?.trim()) return NextResponse.json({ error: "Missing GEMINI_API_KEY." }, { status: 500 });
  if (productType === "colouring_book" && !process.env.FAL_KEY?.trim()) return NextResponse.json({ error: "Missing FAL_KEY." }, { status: 500 });

  const { data: allImages, error: imagesError } = await supabaseAdmin.from("order_images").select("*").eq("order_id", orderId).order("page_number", { ascending: true });
  if (imagesError) return NextResponse.json({ error: imagesError.message }, { status: 500 });
  const images = allImages || [];
  const maxImages = productType === "story_book" ? STORY_MAX_IMAGES_PER_REQUEST : COLOURING_MAX_IMAGES_PER_REQUEST;
  const selected = mode === "regenerate_all"
    ? images.filter((image) => hasGeneratedOutput(image)).slice(0, maxImages)
    : images.filter((image) => retryableNormalImage(image) && image.status !== "failed").slice(0, maxImages);
  const regularCandidates = selected.length > 0 || mode === "regenerate_all"
    ? selected
    : images.filter((image) => retryableNormalImage(image) && image.status === "failed").slice(0, maxImages);
  // Include claimed pages only for stale-claim resolution. A fresh claim returns
  // in_progress and never makes another provider call.
  const staleCheckCandidates = mode === "normal"
    ? images.filter((image) => image.status === "generating").slice(0, maxImages)
    : [];
  const candidates = [...regularCandidates, ...staleCheckCandidates.filter((image) => !regularCandidates.some((candidate) => candidate.id === image.id))];

  const claims = await Promise.all(candidates.map(async (image) => ({ image, claim: await claimOrderImageGeneration(image.id, mode === "regenerate_all" ? "regenerate" : "normal") })));
  const claimed = claims.filter((entry) => entry.claim.claimed);
  const inProgressElsewhere = claims.filter((entry) => entry.claim.reason === "in_progress").length;
  const staleClaimsResolved = claims.filter((entry) => entry.claim.reason === "stale_claim_resolved").length;
  const alreadyGenerated = claims.filter((entry) => entry.claim.reason === "generated").length;

  const orderSlug = slugify(order.customer_name || "order");
  const orderFolder = `${orderSlug}-${order.id.slice(0, 8)}`;
  const provider = providerForProductType(productType);

  async function generateOne(entry: (typeof claimed)[number]) {
    const { image, claim } = entry;
    let slot: Awaited<ReturnType<typeof acquireGenerationProviderSlot>> = null;
    try {
      const inputUrl = getGenerationInputUrl(image);
      if (!inputUrl || typeof inputUrl !== "string") throw new Error(`No usable input image URL found for page ${image.page_number}.`);

      slot = await acquireGenerationProviderSlot(provider);
      if (!slot) {
        await releaseGenerationClaimWithoutAttempt(image.id, claim);
        return { id: image.id, page_number: image.page_number, status: "deferred_capacity" };
      }

      await markGenerationAttempted(image.id, claim.claimId);
      const promptText = getPromptForOrder(order, image);
      const promptVersion = getPromptVersionForOrder(order);
      const generated = await withBoundedProviderRetry(() => productType === "story_book"
        ? generateStorybookWithGemini({ promptText, originalUrl: inputUrl, mimeType: image.mime_type || getMimeTypeFromUrl(inputUrl) })
        : generateColoringWithFal({ promptText, originalUrl: inputUrl, aspectRatio: "3:4" }));
      await releaseGenerationProviderSlot(slot).catch((releaseError) => console.error("[generate] provider slot release failed:", releaseError));
      slot = null;

      const generatedUrl = await uploadGeneratedBuffer({ buffer: generated.buffer, contentType: generated.contentType, orderFolder, pageNumber: image.page_number });
      const updated = await markGenerationSuccess(image.id, claim.claimId, {
        generated_url: generatedUrl,
        model_used: generated.modelUsed,
        prompt_version: promptVersion,
        generated_at: new Date().toISOString(),
        replaced_manually: false,
      });
      return updated;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown generation error.";
      console.error(`[generate] failed order=${orderId} page=${image.page_number}: ${message}`);
      await markGenerationFailure(image.id, claim, "generation_failed", message).catch((failureError) => console.error(`[generate] unable to persist failure page=${image.page_number}: ${failureError instanceof Error ? failureError.message : "unknown"}`));
      return { id: image.id, page_number: image.page_number, status: "failed", error_message: message };
    } finally {
      if (slot) await releaseGenerationProviderSlot(slot).catch((releaseError) => console.error(`[generate] provider slot release failed: ${releaseError instanceof Error ? releaseError.message : "unknown"}`));
    }
  }

  const results = await Promise.all(claimed.map(generateOne));
  const { data: refreshedImages, error: refreshError } = await supabaseAdmin.from("order_images").select("id,status,generated_url").eq("order_id", orderId);
  if (refreshError) return NextResponse.json({ error: refreshError.message }, { status: 500 });
  const refreshed = refreshedImages || [];
  const remaining = refreshed.filter((image) => !image.generated_url && !["failed", "generating"].includes(image.status)).length;
  const failedTotal = refreshed.filter((image) => !image.generated_url && image.status === "failed").length;
  const inProgressTotal = refreshed.filter((image) => image.status === "generating").length;
  const generatedThisRun = results.filter((result) => result.status === "generated").length;
  const failedThisRun = results.filter((result) => result.status === "failed").length;
  const deferredCapacity = results.filter((result) => result.status === "deferred_capacity").length;
  const newOrderStatus = remaining > 0 || inProgressTotal > 0 ? "generating" : failedTotal > 0 ? "generation_failed" : "needs_review";
  await supabaseAdmin.from("orders").update({ status: newOrderStatus, pdf_status: "not_exported" }).eq("id", orderId);

  return NextResponse.json({
    provider,
    product_type: productType,
    mode,
    images: results,
    total: images.length,
    already_generated: alreadyGenerated,
    claimed: claimed.length,
    in_progress_elsewhere: inProgressElsewhere,
    stale_claims_resolved: staleClaimsResolved,
    generated_this_run: generatedThisRun,
    failed_this_run: failedThisRun,
    deferred_capacity: deferredCapacity,
    remaining,
    failed_total: failedTotal,
    in_progress_total: inProgressTotal,
    status: newOrderStatus,
  });
}
