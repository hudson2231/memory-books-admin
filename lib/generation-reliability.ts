import { supabaseAdmin } from "./supabaseAdmin";

export const GENERATION_PAGE_CLAIM_STALE_AFTER_MS = 15 * 60 * 1000;
export const GENERATION_PROVIDER_LEASE_MS = 6 * 60 * 1000;

export type GenerationProvider = "gemini" | "fal";
export type GenerationMode = "normal" | "regenerate";
export type GenerationClaimReason =
  | "claimed"
  | "generated"
  | "in_progress"
  | "stale_claim_resolved"
  | "not_retryable";

export type GenerationPageClaim = {
  claimId: string;
  claimed: boolean;
  reason: GenerationClaimReason;
  previousStatus: string | null;
  hadGeneratedOutput: boolean;
};

function uuid() { return crypto.randomUUID(); }
function text(value: unknown) { return typeof value === "string" ? value : ""; }

export function providerForProductType(productType: string): GenerationProvider {
  return productType === "story_book" ? "gemini" : "fal";
}

export function isTransientProviderError(message: string) {
  return /\b429\b|rate.?limit|\b5\d\d\b|timeout|timed out|econnreset|eai_again|network/i.test(message);
}

export async function claimOrderImageGeneration(imageId: string, mode: GenerationMode): Promise<GenerationPageClaim> {
  const claimId = uuid();
  const { data, error } = await supabaseAdmin.rpc("claim_order_image_generation", {
    p_image_id: imageId,
    p_claim_id: claimId,
    p_allow_regenerate: mode === "regenerate",
    p_stale_before: new Date(Date.now() - GENERATION_PAGE_CLAIM_STALE_AFTER_MS).toISOString(),
  });
  if (error) throw new Error(`GENERATION_CLAIM: ${error.message}`);
  const result = (data || {}) as Record<string, unknown>;
  const reason = text(result.reason) as GenerationClaimReason;
  return { claimId, claimed: result.claimed === true, reason: reason || "not_retryable", previousStatus: typeof result.previous_status === "string" ? result.previous_status : null, hadGeneratedOutput: result.had_generated_output === true };
}

export async function markGenerationAttempted(imageId: string, claimId: string) {
  const { data, error } = await supabaseAdmin.from("order_images").update({ generation_attempted_at: new Date().toISOString() }).eq("id", imageId).eq("status", "generating").eq("generation_claim_id", claimId).select("id").maybeSingle();
  if (error || !data) throw new Error(`GENERATION_ATTEMPT: ${error?.message || "page claim is no longer active."}`);
}

export async function releaseGenerationClaimWithoutAttempt(imageId: string, claim: GenerationPageClaim) {
  const status = claim.hadGeneratedOutput ? "generated" : claim.previousStatus === "failed" ? "failed" : "uploaded";
  const { error } = await supabaseAdmin.from("order_images").update({ status, generation_claim_id: null, generation_claimed_at: null, generation_attempted_at: null }).eq("id", imageId).eq("status", "generating").eq("generation_claim_id", claim.claimId).is("generation_attempted_at", null);
  if (error) throw new Error(`GENERATION_RELEASE: ${error.message}`);
}

export async function markGenerationSuccess(imageId: string, claimId: string, input: Record<string, unknown>) {
  const { data, error } = await supabaseAdmin.from("order_images").update({ ...input, status: "generated", generation_claim_id: null, generation_claimed_at: null, generation_attempted_at: null, generation_error_code: null, error_message: null }).eq("id", imageId).eq("status", "generating").eq("generation_claim_id", claimId).select("*").maybeSingle();
  if (error) throw new Error(`GENERATION_SUCCESS: ${error.message}`);
  if (!data) throw new Error("GENERATION_SUCCESS: page claim no longer belongs to this worker.");
  return data;
}

export async function markGenerationFailure(imageId: string, claim: GenerationPageClaim, errorCode: string, errorMessage: string) {
  const status = claim.hadGeneratedOutput ? "generated" : "failed";
  const { data, error } = await supabaseAdmin.from("order_images").update({ status, generation_claim_id: null, generation_claimed_at: null, generation_attempted_at: null, generation_error_code: errorCode, error_message: errorMessage }).eq("id", imageId).eq("status", "generating").eq("generation_claim_id", claim.claimId).select("*").maybeSingle();
  if (error) throw new Error(`GENERATION_FAILURE: ${error.message}`);
  return data;
}

export async function acquireGenerationProviderSlot(provider: GenerationProvider) {
  const leaseId = uuid();
  const { data, error } = await supabaseAdmin.rpc("claim_generation_provider_slot", { p_provider: provider, p_lease_id: leaseId, p_lease_expires_at: new Date(Date.now() + GENERATION_PROVIDER_LEASE_MS).toISOString() });
  if (error) throw new Error(`GENERATION_PROVIDER_SLOT: ${error.message}`);
  const result = (data || {}) as Record<string, unknown>;
  if (result.claimed !== true || typeof result.slot_number !== "number") return null;
  return { provider, leaseId, slotNumber: result.slot_number };
}

export async function releaseGenerationProviderSlot(slot: { provider: GenerationProvider; leaseId: string; slotNumber: number }) {
  const { error } = await supabaseAdmin.from("generation_provider_slots").update({ lease_id: null, claimed_at: null, lease_expires_at: null }).eq("provider", slot.provider).eq("slot_number", slot.slotNumber).eq("lease_id", slot.leaseId);
  if (error) throw new Error(`GENERATION_PROVIDER_SLOT_RELEASE: ${error.message}`);
}

export async function withBoundedProviderRetry<T>(run: () => Promise<T>, retries = 1): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try { return await run(); } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : "Unknown provider error.";
      if (attempt === retries || !isTransientProviderError(message)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1) + Math.floor(Math.random() * 250)));
    }
  }
  throw lastError;
}
