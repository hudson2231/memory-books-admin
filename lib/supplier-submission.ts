import { supabaseAdmin } from "./supabaseAdmin";

export const SUPPLIER_SUBMISSION_STATES = [
  "not_sent",
  "submitting",
  "submission_unknown",
  "supplier_confirmed",
] as const;

export type SupplierSubmissionState = (typeof SUPPLIER_SUBMISSION_STATES)[number];
export const SUPPLIER_SUBMISSION_STALE_AFTER_MS = 10 * 60 * 1000;
export type SupplierName = "mixam" | "gelato";
type RecordLike = Record<string, unknown>;

export function submissionState(row: RecordLike | null | undefined): SupplierSubmissionState {
  const value = typeof row?.submission_state === "string" ? row.submission_state : "";
  if ((SUPPLIER_SUBMISSION_STATES as readonly string[]).includes(value)) {
    return value as SupplierSubmissionState;
  }
  return row?.supplier_order_id ? "supplier_confirmed" : "not_sent";
}

export function mayClaimSupplierSubmission(row: RecordLike | null | undefined) {
  return submissionState(row) === "not_sent" && !row?.supplier_order_id;
}

export function isSupplierSubmissionClaimStale(
  row: RecordLike | null | undefined,
  nowMs = Date.now()
) {
  if (submissionState(row) !== "submitting") return false;
  const claimedAt = typeof row?.submission_claimed_at === "string"
    ? Date.parse(row.submission_claimed_at)
    : Number.NaN;
  // A submitting row without a readable claim time cannot be proved safe to retry.
  return !Number.isFinite(claimedAt) || nowMs - claimedAt >= SUPPLIER_SUBMISSION_STALE_AFTER_MS;
}

export async function resolveStaleSupplierSubmission(
  row: RecordLike | null | undefined,
  supplier: SupplierName,
  nowMs = Date.now()
) {
  if (!row || !isSupplierSubmissionClaimStale(row, nowMs)) {
    return { fulfillment: row, transitioned: false, state: submissionState(row) };
  }
  const orderId = typeof row.order_id === "string" ? row.order_id : "";
  if (!orderId) throw new Error("SUPPLIER_SUBMISSION_STALE: fulfillment row has no order ID.");
  const claimedAt = typeof row.submission_claimed_at === "string"
    ? row.submission_claimed_at
    : null;
  let update = supabaseAdmin
    .from("supplier_fulfillments")
    .update({
      submission_state: "submission_unknown",
      submission_error_code: "stale_submission_claim",
      submission_error_message: "Supplier submission claim exceeded 10 minutes; the original request outcome cannot be proven. Reconciliation is required before any resend.",
      error: "Supplier submission claim is stale; reconciliation is required before any resend.",
      supplier_status: "submission_unknown",
    })
    .eq("id", row.id)
    .eq("supplier", supplier)
    .eq("submission_state", "submitting")
    .is("supplier_order_id", null);
  update = claimedAt === null
    ? update.is("submission_claimed_at", null)
    : update.eq("submission_claimed_at", claimedAt);
  const { data, error } = await update.select("*").maybeSingle();
  if (error) throw new Error("SUPPLIER_SUBMISSION_STALE: " + error.message);
  if (data) return { fulfillment: data, transitioned: true, state: "submission_unknown" as const };

  // A confirmation or another resolver may have won the race; report its current state.
  const { data: current, error: currentError } = await supabaseAdmin
    .from("supplier_fulfillments")
    .select("*")
    .eq("id", row.id)
    .maybeSingle();
  if (currentError || !current) {
    throw new Error("SUPPLIER_SUBMISSION_STALE_RELOAD: " + (currentError?.message || "Fulfillment row disappeared."));
  }
  return { fulfillment: current, transitioned: false, state: submissionState(current) };
}

export function failureSubmissionState(input: {
  requestAttempted: boolean;
  definitivelyNotSent?: boolean;
}): "not_sent" | "submission_unknown" {
  return !input.requestAttempted || input.definitivelyNotSent
    ? "not_sent"
    : "submission_unknown";
}

export function submissionStateLabel(state: SupplierSubmissionState) {
  if (state === "not_sent") return "Not sent";
  if (state === "submitting") return "Submitting";
  if (state === "submission_unknown") return "Submission outcome unknown — do not retry automatically";
  return "Supplier confirmed";
}

export async function ensureSupplierFulfillment(
  orderId: string,
  supplier: SupplierName,
  input: RecordLike = {}
) {
  const { data: existing, error: existingError } = await supabaseAdmin
    .from("supplier_fulfillments")
    .select("*")
    .eq("order_id", orderId)
    .eq("supplier", supplier)
    .maybeSingle();
  if (existingError) throw new Error("SUPPLIER_FULFILLMENT_LOOKUP: " + existingError.message);
  if (existing) return existing;

  const { data, error } = await supabaseAdmin
    .from("supplier_fulfillments")
    .insert({
      order_id: orderId,
      supplier,
      submission_state: "not_sent",
      supplier_status: "not_sent",
      ...input,
    })
    .select("*")
    .single();

  if (!error && data) return data;

  const { data: raced, error: racedError } = await supabaseAdmin
    .from("supplier_fulfillments")
    .select("*")
    .eq("order_id", orderId)
    .eq("supplier", supplier)
    .maybeSingle();
  if (racedError || !raced) {
    throw new Error("SUPPLIER_FULFILLMENT_ENSURE: " + (error?.message || racedError?.message || "Unable to create supplier fulfillment."));
  }
  return raced;
}

export async function claimSupplierSubmission(orderId: string, supplier: SupplierName) {
  const claimedAt = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("supplier_fulfillments")
    .update({
      submission_state: "submitting",
      submission_claimed_at: claimedAt,
      submission_attempted_at: null,
      submission_error_code: null,
      submission_error_message: null,
      error: null,
      supplier_status: "submitting",
    })
    .eq("order_id", orderId)
    .eq("supplier", supplier)
    .eq("submission_state", "not_sent")
    .is("supplier_order_id", null)
    .select("*")
    .maybeSingle();
  if (error) throw new Error("SUPPLIER_SUBMISSION_CLAIM: " + error.message);
  if (!data) {
    throw new Error("SUPPLIER_SUBMISSION_BLOCKED: another submission is active, unknown, or already confirmed.");
  }
  return data;
}

export async function markSupplierSubmissionAttempted(orderId: string, supplier: SupplierName) {
  const { data, error } = await supabaseAdmin
    .from("supplier_fulfillments")
    .update({ submission_attempted_at: new Date().toISOString() })
    .eq("order_id", orderId)
    .eq("supplier", supplier)
    .eq("submission_state", "submitting")
    .select("*")
    .maybeSingle();
  if (error || !data) throw new Error("SUPPLIER_SUBMISSION_ATTEMPT: " + (error?.message || "Claim is no longer active."));
  return data;
}

export async function releaseSupplierSubmissionWithoutAttempt(
  orderId: string,
  supplier: SupplierName,
  errorCode: string,
  errorMessage: string
) {
  const { error } = await supabaseAdmin
    .from("supplier_fulfillments")
    .update({
      submission_state: "not_sent",
      submission_claimed_at: null,
      submission_error_code: errorCode,
      submission_error_message: errorMessage,
      error: errorMessage,
      supplier_status: "not_sent",
    })
    .eq("order_id", orderId)
    .eq("supplier", supplier)
    .eq("submission_state", "submitting")
    .is("submission_attempted_at", null);
  if (error) throw new Error("SUPPLIER_SUBMISSION_RELEASE: " + error.message);
}

export async function markSupplierSubmissionUnknown(
  orderId: string,
  supplier: SupplierName,
  errorCode: string,
  errorMessage: string
) {
  const { error } = await supabaseAdmin
    .from("supplier_fulfillments")
    .update({
      submission_state: "submission_unknown",
      submission_error_code: errorCode,
      submission_error_message: errorMessage,
      error: errorMessage,
      supplier_status: "submission_unknown",
    })
    .eq("order_id", orderId)
    .eq("supplier", supplier)
    .eq("submission_state", "submitting")
    .is("supplier_order_id", null);
  if (error) throw new Error("SUPPLIER_SUBMISSION_UNKNOWN: " + error.message);
}

export async function confirmSupplierSubmission(
  orderId: string,
  supplier: SupplierName,
  supplierOrderId: string,
  input: RecordLike = {}
) {
  if (!supplierOrderId) throw new Error("SUPPLIER_SUBMISSION_CONFIRM: supplier order ID is required.");
  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("supplier_fulfillments")
    .update({
      submission_state: "supplier_confirmed",
      submission_confirmed_at: now,
      supplier_order_id: supplierOrderId,
      submission_error_code: null,
      submission_error_message: null,
      error: null,
      ...input,
    })
    .eq("order_id", orderId)
    .eq("supplier", supplier)
    .select("*")
    .single();
  if (error || !data) throw new Error("SUPPLIER_SUBMISSION_CONFIRM: " + (error?.message || "Fulfillment row disappeared."));
  return data;
}
