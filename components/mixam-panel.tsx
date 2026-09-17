"use client";

import { useEffect, useState } from "react";

type MixamFulfillment = {
  cover_pdf_url?: string | null; body_pdf_url?: string | null; supplier_status?: string | null;
  artwork_validation_status?: string | null; supplier_order_id?: string | null; quote_total?: number | null;
  quote_currency?: string | null; tracking_url?: string | null; error?: string | null; test_order?: boolean | null;
  supplier_product_configurations?: { configuration_key?: string; universal_key?: string; spine_mm?: number; price?: number; currency?: string; turnaround_days?: number; country_of_origin?: string } | null;
};
type ApiData = Record<string, unknown>;

async function readJson(response: Response): Promise<ApiData> {
  const text = await response.text();
  try { return JSON.parse(text) as ApiData; }
  catch { return { ok: false, message: `Backend returned HTTP ${response.status} without JSON.` }; }
}

export function MixamPanel({ orderId, canExport }: { orderId: string; canExport: boolean }) {
  const [fulfillment, setFulfillment] = useState<MixamFulfillment | null>(null);
  const [busy, setBusy] = useState<"quote" | "export" | "send" | null>(null);
  const [message, setMessage] = useState("");
  const load = async () => {
    const response = await fetch(`/api/orders/${orderId}/mixam/status`, { cache: "no-store" });
    const data = await readJson(response);
    if (response.ok) setFulfillment((data.fulfillment || null) as MixamFulfillment | null);
  };
  useEffect(() => {
    let active = true;
    void fetch(`/api/orders/${orderId}/mixam/status`, { cache: "no-store" })
      .then(readJson)
      .then((data) => { if (active) setFulfillment((data.fulfillment || null) as MixamFulfillment | null); })
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
  const config = fulfillment?.supplier_product_configurations;
  return <section className="mt-6 rounded-2xl border border-cyan-900/70 bg-cyan-950/20 p-5">
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div><p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300">Mixam migration</p><h3 className="mt-1 text-xl font-medium text-white">Mixam Test Mode</h3><p className="mt-1 text-sm text-cyan-100/70">TEST_ORDER only. No paid Mixam orders can be sent from this panel.</p></div>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => void run("quote")} disabled={busy !== null} className="rounded-xl border border-cyan-700 px-4 py-2 text-sm text-cyan-200 disabled:opacity-50">{busy === "quote" ? "Quoting…" : "Get Mixam Quote"}</button>
        <button onClick={() => void run("export")} disabled={busy !== null || !canExport} className="rounded-xl border border-cyan-700 px-4 py-2 text-sm text-cyan-200 disabled:opacity-50">{busy === "export" ? "Exporting…" : "Export for Mixam"}</button>
        <button onClick={() => void run("send")} disabled={busy !== null || !fulfillment?.cover_pdf_url || !fulfillment?.body_pdf_url || Boolean(fulfillment?.supplier_order_id)} className="rounded-xl bg-cyan-300 px-4 py-2 text-sm font-semibold text-cyan-950 disabled:opacity-50">{busy === "send" ? "Submitting…" : fulfillment?.supplier_order_id ? "Mixam Test Order Submitted" : "Send Mixam Test Order"}</button>
      </div>
    </div>
    <div className="mt-4 grid gap-2 text-sm text-cyan-50/85 sm:grid-cols-2">
      <p>Status: {fulfillment?.supplier_status || "not exported"}</p><p>Artwork validation: {fulfillment?.artwork_validation_status || "not submitted"}</p>
      <p>Config: {config?.configuration_key || "quote required"}</p><p>Print: {config?.currency || ""} {config?.price ?? "—"} {config ? "(shipping excluded)" : ""}</p>
      <p>Spine: {config?.spine_mm ?? "—"} mm · {config?.country_of_origin || "—"}</p><p>Turnaround: {config?.turnaround_days ?? "—"} production days</p>
      {fulfillment?.supplier_order_id && <p>Mixam order ID: {fulfillment.supplier_order_id}</p>}
      {fulfillment?.tracking_url && <a className="underline text-cyan-200" target="_blank" rel="noreferrer" href={fulfillment.tracking_url}>Open tracking</a>}
    </div>
    <div className="mt-3 flex gap-3 text-sm">{fulfillment?.cover_pdf_url && <a className="underline text-cyan-200" target="_blank" rel="noreferrer" href={fulfillment.cover_pdf_url}>Open cover PDF</a>}{fulfillment?.body_pdf_url && <a className="underline text-cyan-200" target="_blank" rel="noreferrer" href={fulfillment.body_pdf_url}>Open body PDF</a>}</div>
    {message && <p className="mt-4 rounded-lg border border-cyan-900 bg-cyan-950/50 p-3 text-sm text-cyan-100">{message}</p>}
    {fulfillment?.error && <p className="mt-3 rounded-lg border border-red-900 bg-red-950/30 p-3 text-sm text-red-200">Mixam: {fulfillment.error}</p>}
  </section>;
}
