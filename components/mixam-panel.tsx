"use client";

import { useEffect, useState } from "react";

type MixamFulfillment = {
  cover_pdf_url?: string | null; body_pdf_url?: string | null; supplier_status?: string | null;
  artwork_validation_status?: string | null; supplier_order_id?: string | null; quote_total?: number | null;
  quote_currency?: string | null; quote_print_price?: number | null; quote_shipping_price?: number | null; quote_tax?: number | null; tracking_url?: string | null; tracking_number?: string | null; tracking_company?: string | null; delivery_courier?: string | null; delivery_service?: string | null; delivery_days_in_transit?: number | null; expected_dispatch_at?: string | null; expected_delivery_at?: string | null; error?: string | null; test_order?: boolean | null; submission_state?: string | null; submission_claimed_at?: string | null; submission_error_code?: string | null; submission_error_message?: string | null;
  supplier_product_configurations?: { configuration_key?: string; universal_key?: string; spine_mm?: number; price?: number; currency?: string; turnaround_days?: number; country_of_origin?: string } | null;
};
type ApiData = Record<string, unknown>;
type Recipient = { firstName: string; lastName: string; company?: string; address1: string; address2?: string; city: string; state: string; postcode: string; countryName: string; countryCode: string; email: string; phone: string };
type CustomerShipping = { title: string | null; code: string | null; customerPaidShipping: string | null; requestedService: string };
type RatePreview = { recommendation?: { rate?: { serviceId?: string; courier?: string; service?: string; cost?: number; daysInTransit?: number }; reason?: string; requiresOperatorReview?: boolean }; dispatchDate?: string | null };

async function readJson(response: Response): Promise<ApiData> {
  const text = await response.text();
  try { return JSON.parse(text) as ApiData; }
  catch { return { ok: false, message: `Backend returned HTTP ${response.status} without JSON.` }; }
}

export function MixamPanel({ orderId, canExport }: { orderId: string; canExport: boolean }) {
  const [fulfillment, setFulfillment] = useState<MixamFulfillment | null>(null);
  const [busy, setBusy] = useState<"quote" | "export" | "send" | "rates" | null>(null);
  const [message, setMessage] = useState("");
  const [recipient, setRecipient] = useState<Recipient | null>(null);
  const [customerShipping, setCustomerShipping] = useState<CustomerShipping | null>(null);
  const [deliveryValidation, setDeliveryValidation] = useState<{ valid: boolean; message?: string } | null>(null);
  const [ratePreview, setRatePreview] = useState<RatePreview | null>(null);
  const load = async () => {
    const response = await fetch(`/api/orders/${orderId}/mixam/status`, { cache: "no-store" });
    const data = await readJson(response);
    if (response.ok) {
      setFulfillment((data.fulfillment || null) as MixamFulfillment | null); setRecipient((data.recipient || null) as Recipient | null);
      setCustomerShipping((data.customerShipping || null) as CustomerShipping | null); setDeliveryValidation((data.deliveryValidation || null) as { valid: boolean; message?: string } | null);
    }
  };
  useEffect(() => {
    let active = true;
    void fetch(`/api/orders/${orderId}/mixam/status`, { cache: "no-store" })
      .then(readJson)
      .then((data) => { if (active) {
        setFulfillment((data.fulfillment || null) as MixamFulfillment | null); setRecipient((data.recipient || null) as Recipient | null);
        setCustomerShipping((data.customerShipping || null) as CustomerShipping | null); setDeliveryValidation((data.deliveryValidation || null) as { valid: boolean; message?: string } | null);
      } })
      .catch(() => { if (active) setFulfillment(null); });
    return () => { active = false; };
  }, [orderId]);
  const run = async (action: "quote" | "export" | "send") => {
    setBusy(action); setMessage(action === "send" ? "Submitting Mixam TEST_ORDER…" : `${action === "quote" ? "Refreshing" : "Exporting"} Mixam assets…`);
    try {
      const suffix = action === "quote" ? "quote" : action === "export" ? "export-pdf" : "send";
      const response = await fetch(`/api/orders/${orderId}/mixam/${suffix}`, { method: "POST", cache: "no-store" });
      const data = await readJson(response);
      if (!response.ok || !data.ok) { setMessage(`${String(data.stage || "MIXAM")}: ${String(data.message || "Request failed.")}`); return; }
      const quote = data.quote as Record<string, unknown> | undefined;
      setMessage(action === "quote" && quote ? `Mixam standard print quote: ${String(quote.currency || "")} ${Number(quote.printPrice || 0).toFixed(2)}. Shipping is not included.` : action === "send" ? "Mixam TEST_ORDER created; awaiting artwork validation callback." : "Mixam PDFs exported.");
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Mixam request failed."); }
    finally { setBusy(null); }
  };
  const previewRates = async () => {
    setBusy("rates");
    setMessage("Loading Mixam delivery rates without selecting one…");
    try {
      const response = await fetch(`/api/orders/${orderId}/mixam/shipping-rates`, { cache: "no-store" });
      const data = await readJson(response);
      if (!response.ok || !data.ok) { setMessage(`${String(data.stage || "MIXAM_DELIVERY_RATES")}: ${String(data.message || "Rate preview failed.")}`); return; }
      setRatePreview(data as RatePreview);
      const recommendation = data.recommendation as RatePreview["recommendation"];
      setMessage(recommendation?.rate ? `Read-only recommendation: ${String(recommendation.rate.courier || "Mixam")} ${String(recommendation.rate.service || "service")} (${Number(recommendation.rate.cost || 0).toFixed(2)}). No rate was selected.` : String(recommendation?.reason || "No safe delivery recommendation is available."));
    } catch (error) { setMessage(error instanceof Error ? error.message : "Delivery-rate preview failed."); }
    finally { setBusy(null); }
  };
  const config = fulfillment?.supplier_product_configurations;
  const submissionState = fulfillment?.submission_state || (fulfillment?.supplier_order_id ? "supplier_confirmed" : "not_sent");
  const submissionBlocked = submissionState !== "not_sent";
  return <section className="mt-6 rounded-2xl border border-cyan-900/70 bg-cyan-950/20 p-5">
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div><p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300">Mixam migration</p><h3 className="mt-1 text-xl font-medium text-white">Mixam Test Mode</h3><p className="mt-1 text-sm text-cyan-100/70">TEST_ORDER only. No paid Mixam orders can be sent from this panel.</p></div>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => void run("quote")} disabled={busy !== null} className="rounded-xl border border-cyan-700 px-4 py-2 text-sm text-cyan-200 disabled:opacity-50">{busy === "quote" ? "Quoting…" : "Get Mixam Quote"}</button>
        <button onClick={() => void run("export")} disabled={busy !== null || !canExport} className="rounded-xl border border-cyan-700 px-4 py-2 text-sm text-cyan-200 disabled:opacity-50">{busy === "export" ? "Exporting…" : "Export for Mixam"}</button>
        <button onClick={() => void previewRates()} disabled={busy !== null || !fulfillment?.supplier_order_id} className="rounded-xl border border-cyan-700 px-4 py-2 text-sm text-cyan-200 disabled:opacity-50">{busy === "rates" ? "Loading rates…" : "Preview Delivery Rates"}</button>
        <button onClick={() => void run("send")} disabled={busy !== null || !fulfillment?.cover_pdf_url || !fulfillment?.body_pdf_url || submissionBlocked} className="rounded-xl bg-cyan-300 px-4 py-2 text-sm font-semibold text-cyan-950 disabled:opacity-50">{busy === "send" ? "Submitting…" : submissionState === "supplier_confirmed" ? "Mixam Test Order Submitted" : submissionState === "submission_unknown" ? "Mixam Submission Needs Review" : submissionState === "submitting" ? "Mixam Submission In Progress" : "Send Mixam Test Order"}</button>
      </div>
    </div>
    <div className="mt-4 grid gap-2 text-sm text-cyan-50/85 sm:grid-cols-2">
      <p>Status: {fulfillment?.supplier_status || "not exported"}</p><p>Submission: {submissionState === "not_sent" ? "Not sent" : submissionState === "submitting" ? "Submitting" : submissionState === "submission_unknown" ? "Outcome unknown — do not retry automatically" : "Supplier confirmed"}</p><p>Artwork validation: {fulfillment?.artwork_validation_status || "not submitted"}</p>
      <p>Config: {config?.configuration_key || "quote required"}</p><p>Print: {config?.currency || ""} {config?.price ?? "—"} {config ? "(shipping excluded)" : ""}</p>
      <p>Spine: {config?.spine_mm ?? "—"} mm · {config?.country_of_origin || "—"}</p><p>Turnaround: {config?.turnaround_days ?? "—"} production days</p>
      {fulfillment?.supplier_order_id && <p>Mixam order ID: {fulfillment.supplier_order_id}</p>}
      {fulfillment?.tracking_url && <a className="underline text-cyan-200" target="_blank" rel="noreferrer" href={fulfillment.tracking_url}>Open tracking</a>}
      <p>Print cost: {fulfillment?.quote_currency || config?.currency || ""} {fulfillment?.quote_print_price ?? "—"}</p><p>Supplier shipping: {fulfillment?.quote_currency || config?.currency || ""} {fulfillment?.quote_shipping_price ?? "—"}</p>
      <p>GST/tax: {fulfillment?.quote_currency || config?.currency || ""} {fulfillment?.quote_tax ?? "—"}</p><p>Total fulfilment cost: {fulfillment?.quote_currency || config?.currency || ""} {fulfillment?.quote_total ?? "—"}</p>
      {fulfillment?.delivery_service && <p>Delivery: {fulfillment.delivery_courier || "Mixam"} · {fulfillment.delivery_service}{fulfillment.delivery_days_in_transit ? ` · ${fulfillment.delivery_days_in_transit} transit days` : ""}</p>}
      {fulfillment?.tracking_number && <p>Tracking number: {fulfillment.tracking_number}{fulfillment.tracking_company ? ` · ${fulfillment.tracking_company}` : ""}</p>}
      {fulfillment?.expected_dispatch_at && <p>Estimated dispatch: {new Date(fulfillment.expected_dispatch_at).toLocaleDateString()}</p>}
      {fulfillment?.expected_delivery_at && <p>Estimated delivery: {new Date(fulfillment.expected_delivery_at).toLocaleDateString()}</p>}
    </div>
    <details className="mt-4 rounded-lg border border-cyan-900/70 p-3 text-sm text-cyan-100/85">
      <summary className="cursor-pointer font-medium text-cyan-200">Recipient and Shopify shipping</summary>
      {deliveryValidation && <p className="mt-2">Delivery validation: {deliveryValidation.valid ? "valid" : deliveryValidation.message || "invalid"}</p>}
      {recipient && <div className="mt-2"><p>{recipient.firstName} {recipient.lastName}{recipient.company ? ` · ${recipient.company}` : ""}</p><p>{recipient.city}, {recipient.state} {recipient.postcode}, {recipient.countryCode}</p><p>{recipient.email} · {recipient.phone}</p><p className="mt-1 text-cyan-100/60">Full address: {recipient.address1}{recipient.address2 ? `, ${recipient.address2}` : ""}</p></div>}
      {customerShipping && <p className="mt-2">Shopify shipping: {customerShipping.title || customerShipping.code || "unknown"} · preference {customerShipping.requestedService} · customer paid {customerShipping.customerPaidShipping ?? "unknown"}</p>}
    </details>
    {ratePreview?.recommendation && <p className="mt-3 rounded-lg border border-cyan-900 bg-cyan-950/50 p-3 text-sm text-cyan-100">Delivery preview: {ratePreview.recommendation.rate ? `${ratePreview.recommendation.rate.courier || "Mixam"} ${ratePreview.recommendation.rate.service || "service"} · ${Number(ratePreview.recommendation.rate.cost || 0).toFixed(2)}${ratePreview.recommendation.rate.daysInTransit ? ` · ${ratePreview.recommendation.rate.daysInTransit} days` : ""}` : ratePreview.recommendation.reason} {ratePreview.recommendation.requiresOperatorReview ? "Operator review required." : "No rate was selected."}</p>}
    <div className="mt-3 flex gap-3 text-sm">{fulfillment?.cover_pdf_url && <a className="underline text-cyan-200" target="_blank" rel="noreferrer" href={fulfillment.cover_pdf_url}>Open cover PDF</a>}{fulfillment?.body_pdf_url && <a className="underline text-cyan-200" target="_blank" rel="noreferrer" href={fulfillment.body_pdf_url}>Open body PDF</a>}</div>
    {submissionState === "submission_unknown" && <p className="mt-4 rounded-lg border border-amber-800 bg-amber-950/30 p-3 text-sm text-amber-100">Supplier submission outcome is unknown. Do not retry automatically. Review Mixam status/webhook evidence or contact support before any manual resend.</p>}
    {message && <p className="mt-4 rounded-lg border border-cyan-900 bg-cyan-950/50 p-3 text-sm text-cyan-100">{message}</p>}
    {fulfillment?.error && <p className="mt-3 rounded-lg border border-red-900 bg-red-950/30 p-3 text-sm text-red-200">Mixam: {fulfillment.error}</p>}
  </section>;
}
