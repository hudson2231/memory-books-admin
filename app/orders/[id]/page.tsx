"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

type Order = {
  id: string;
  customer_name: string;
  customer_email: string;
  page_count: number;
  status: string;
  created_at: string;
  pdf_url: string | null;
  pdf_status: string | null;
  exported_at: string | null;
};

type OrderImage = {
  id: string;
  order_id: string;
  original_url: string;
  original_filename: string | null;
  mime_type: string | null;
  generated_url: string | null;
  status: string;
  page_number: number;
  approved: boolean;
  error_message: string | null;
};

function canPreviewInBrowser(image: OrderImage) {
  const mimeType = image.mime_type || "";
  const url = image.original_url.toLowerCase();

  if (mimeType.includes("heic") || mimeType.includes("heif")) {
    return false;
  }

  if (url.includes(".heic") || url.includes(".heif")) {
    return false;
  }

  return true;
}

export default function OrderDetailPage() {
  const params = useParams();
  const orderId = params.id as string;

  const [order, setOrder] = useState<Order | null>(null);
  const [images, setImages] = useState<OrderImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [approvingAll, setApprovingAll] = useState(false);
  const [regeneratingImageId, setRegeneratingImageId] = useState<string | null>(null);
  const [updatingApprovalId, setUpdatingApprovalId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const generatedCount = images.filter((image) => image.generated_url).length;
  const approvedCount = images.filter((image) => image.approved).length;
  const failedCount = images.filter((image) => image.status === "failed").length;

  async function loadOrder() {
    setLoading(true);
    setMessage("");

    try {
      const response = await fetch(`/api/orders/${orderId}`);
      const data = await response.json();

      if (!response.ok) {
        setMessage(data.error || "Failed to load order.");
        return;
      }

      setOrder(data.order);
      setImages(data.images || []);
    } catch {
      setMessage("Failed to load order.");
    } finally {
      setLoading(false);
    }
  }

  async function generatePages() {
    setGenerating(true);
    setMessage("Generating all pages. This can take a little while...");

    try {
      const response = await fetch(`/api/orders/${orderId}/generate`, {
        method: "POST",
      });

      const data = await response.json();

      if (!response.ok) {
        setMessage(data.error || "Generation failed.");
        return;
      }

      setMessage(`Generation finished for ${data.images.length} image(s).`);
      await loadOrder();
    } catch {
      setMessage("Generation failed.");
    } finally {
      setGenerating(false);
    }
  }

  async function regenerateSinglePage(imageId: string, pageNumber: number) {
    setRegeneratingImageId(imageId);
    setMessage(`Regenerating page ${pageNumber}...`);

    try {
      const response = await fetch(`/api/order-images/${imageId}/regenerate`, {
        method: "POST",
      });

      const data = await response.json();

      if (!response.ok) {
        setMessage(data.error || `Page ${pageNumber} regeneration failed.`);
        await loadOrder();
        return;
      }

      setMessage(`Page ${pageNumber} regenerated successfully.`);
      await loadOrder();
    } catch {
      setMessage(`Page ${pageNumber} regeneration failed.`);
    } finally {
      setRegeneratingImageId(null);
    }
  }

  async function updateApproval(imageId: string, approved: boolean, pageNumber: number) {
    setUpdatingApprovalId(imageId);
    setMessage(approved ? `Approving page ${pageNumber}...` : `Rejecting page ${pageNumber}...`);

    try {
      const response = await fetch(`/api/order-images/${imageId}/approve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ approved }),
      });

      const data = await response.json();

      if (!response.ok) {
        setMessage(data.error || "Approval update failed.");
        return;
      }

      setMessage(approved ? `Page ${pageNumber} approved.` : `Page ${pageNumber} marked as not approved.`);
      await loadOrder();
    } catch {
      setMessage("Approval update failed.");
    } finally {
      setUpdatingApprovalId(null);
    }
  }

  async function approveAllGenerated() {
    setApprovingAll(true);
    setMessage("Approving all generated pages...");

    try {
      const response = await fetch(`/api/orders/${orderId}/approve-all`, {
        method: "POST",
      });

      const data = await response.json();

      if (!response.ok) {
        setMessage(data.error || "Approve all failed.");
        return;
      }

      setMessage(`Approved ${data.approved_count} generated page(s).`);
      await loadOrder();
    } catch {
      setMessage("Approve all failed.");
    } finally {
      setApprovingAll(false);
    }
  }

  async function exportPdf() {
    setExportingPdf(true);
    setMessage("Exporting approved pages to PDF...");

    try {
      const response = await fetch(`/api/orders/${orderId}/export-pdf`, {
        method: "POST",
      });

      const data = await response.json();

      if (!response.ok) {
        setMessage(data.error || "PDF export failed.");
        return;
      }

      setMessage(`PDF exported successfully with ${data.exported_pages} page(s).`);
      await loadOrder();

      if (data.pdf_url) {
        window.open(data.pdf_url, "_blank");
      }
    } catch {
      setMessage("PDF export failed.");
    } finally {
      setExportingPdf(false);
    }
  }

  useEffect(() => {
    if (orderId) {
      loadOrder();
    }
  }, [orderId]);

  if (loading) {
    return (
      <main className="min-h-screen bg-neutral-950 p-10 text-white">
        <p className="text-neutral-400">Loading order...</p>
      </main>
    );
  }

  if (!order) {
    return (
      <main className="min-h-screen bg-neutral-950 p-10 text-white">
        <Link href="/" className="text-sm text-neutral-400 hover:text-white">
          ← Back to dashboard
        </Link>
        <p className="mt-6 text-red-400">{message || "Order not found."}</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-neutral-950 text-white">
      <div className="mx-auto max-w-7xl px-6 py-10">
        <div className="mb-8">
          <Link href="/" className="text-sm text-neutral-400 hover:text-white">
            ← Back to dashboard
          </Link>

          <div className="mt-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm uppercase tracking-[0.3em] text-neutral-500">
                Order Detail
              </p>
              <h1 className="mt-3 text-4xl font-semibold">
                {order.customer_name}
              </h1>
              <p className="mt-2 text-neutral-400">
                {order.customer_email}
              </p>
            </div>

            <div className="rounded-2xl border border-neutral-800 bg-neutral-900 px-5 py-4 text-sm text-neutral-300">
              <p>{order.page_count} page book</p>
              <p>Status: {order.status}</p>
              <p>Images: {images.length}</p>
              <p>Generated: {generatedCount}/{images.length}</p>
              <p>Approved: {approvedCount}/{images.length}</p>
              <p>Failed: {failedCount}</p>
              <p>PDF: {order.pdf_status || "not_exported"}</p>

              {order.pdf_url && (
                <a
                  href={order.pdf_url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-block rounded-xl bg-white px-4 py-2 text-sm font-medium text-black hover:bg-neutral-200"
                >
                  Open PDF
                </a>
              )}
            </div>
          </div>
        </div>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-2xl font-medium">Production Images</h2>
              <p className="mt-2 text-neutral-400">
                Generate, review, approve, regenerate, and export approved pages.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={generatePages}
                disabled={generating || images.length === 0 || regeneratingImageId !== null || exportingPdf || approvingAll}
                className="rounded-xl bg-white px-5 py-3 text-sm font-medium text-black hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {generating ? "Generating..." : "Generate All Pages"}
              </button>

              <button
                onClick={approveAllGenerated}
                disabled={approvingAll || generatedCount === 0 || generating || regeneratingImageId !== null || exportingPdf}
                className="rounded-xl border border-green-900 px-5 py-3 text-sm font-medium text-green-300 hover:border-green-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {approvingAll ? "Approving..." : "Approve All Generated"}
              </button>

              <button
                onClick={exportPdf}
                disabled={exportingPdf || approvedCount === 0 || generating || regeneratingImageId !== null || approvingAll}
                className="rounded-xl border border-neutral-700 px-5 py-3 text-sm font-medium text-neutral-100 hover:border-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {exportingPdf ? "Exporting PDF..." : "Export Approved PDF"}
              </button>
            </div>
          </div>

          {message && (
            <p className="mt-4 text-sm text-neutral-300">
              {message}
            </p>
          )}

          {images.length === 0 ? (
            <div className="mt-6 rounded-xl border border-neutral-800 bg-neutral-950 p-5 text-neutral-500">
              No uploaded images found for this order.
            </div>
          ) : (
            <div className="mt-6 space-y-6">
              {images.map((image) => {
                const previewable = canPreviewInBrowser(image);
                const isRegeneratingThisImage = regeneratingImageId === image.id;
                const isUpdatingThisApproval = updatingApprovalId === image.id;

                return (
                  <div
                    key={image.id}
                    className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4"
                  >
                    <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <p className="font-medium">Page {image.page_number}</p>
                        <p className="text-sm text-neutral-500">
                          Status: {image.status}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full px-3 py-1 text-xs ${
                            image.approved
                              ? "bg-green-950 text-green-300"
                              : "bg-neutral-800 text-neutral-300"
                          }`}
                        >
                          {image.approved ? "approved" : "not approved"}
                        </span>

                        <button
                          onClick={() =>
                            updateApproval(image.id, true, image.page_number)
                          }
                          disabled={!image.generated_url || image.approved || isUpdatingThisApproval || generating || regeneratingImageId !== null || exportingPdf || approvingAll}
                          className="rounded-xl border border-green-900 px-4 py-2 text-sm text-green-300 hover:border-green-400 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isUpdatingThisApproval ? "Updating..." : "Approve"}
                        </button>

                        <button
                          onClick={() =>
                            updateApproval(image.id, false, image.page_number)
                          }
                          disabled={!image.generated_url || !image.approved || isUpdatingThisApproval || generating || regeneratingImageId !== null || exportingPdf || approvingAll}
                          className="rounded-xl border border-red-900 px-4 py-2 text-sm text-red-300 hover:border-red-400 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Reject
                        </button>

                        <button
                          onClick={() =>
                            regenerateSinglePage(image.id, image.page_number)
                          }
                          disabled={generating || regeneratingImageId !== null || exportingPdf || approvingAll}
                          className="rounded-xl border border-neutral-700 px-4 py-2 text-sm text-neutral-200 hover:border-white disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isRegeneratingThisImage
                            ? "Regenerating..."
                            : image.generated_url
                              ? "Regenerate Page"
                              : "Generate Page"}
                        </button>
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <p className="mb-2 text-sm text-neutral-400">
                          Original
                        </p>

                        <div className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900">
                          {previewable ? (
                            <img
                              src={image.original_url}
                              alt={`Original page ${image.page_number}`}
                              className="h-auto w-full"
                            />
                          ) : (
                            <div className="flex aspect-[4/5] flex-col items-center justify-center p-6 text-center">
                              <p className="text-lg font-medium text-white">
                                HEIC original uploaded
                              </p>
                              <p className="mt-2 max-w-sm text-sm text-neutral-400">
                                This file uploaded correctly, but your browser
                                cannot preview HEIC originals directly.
                              </p>

                              <div className="mt-4 rounded-xl bg-neutral-800 px-4 py-3 text-left text-xs text-neutral-300">
                                <p>
                                  Filename:{" "}
                                  {image.original_filename || "Unknown"}
                                </p>
                                <p>
                                  Type: {image.mime_type || "Unknown"}
                                </p>
                              </div>

                              <a
                                href={image.original_url}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-5 rounded-xl bg-white px-4 py-2 text-sm font-medium text-black hover:bg-neutral-200"
                              >
                                Open original file
                              </a>
                            </div>
                          )}
                        </div>
                      </div>

                      <div>
                        <p className="mb-2 text-sm text-neutral-400">
                          Generated Colouring Page
                        </p>

                        <div className="overflow-hidden rounded-xl border border-neutral-800 bg-white">
                          {image.generated_url ? (
                            <img
                              src={image.generated_url}
                              alt={`Generated page ${image.page_number}`}
                              className="h-auto w-full"
                            />
                          ) : (
                            <div className="flex aspect-[4/5] items-center justify-center text-sm text-neutral-500">
                              Not generated yet
                            </div>
                          )}
                        </div>

                        {image.error_message && (
                          <p className="mt-2 text-sm text-red-400">
                            {image.error_message}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
