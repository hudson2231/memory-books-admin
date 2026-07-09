"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

type Order = {
  id: string;
  customer_name: string;
  customer_email: string;
  page_count: number;
  product_type: string | null;
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
  preview_url: string | null;
  original_filename: string | null;
  mime_type: string | null;
  generated_url: string | null;
  caption_text: string | null;
  caption_source: string | null;
  status: string;
  page_number: number;
  approved: boolean;
  error_message: string | null;
  model_used: string | null;
  prompt_version: string | null;
  generated_at: string | null;
  replaced_manually: boolean | null;
  last_regeneration_instruction: string | null;
  regeneration_history: Array<{
    instruction?: string;
    created_at?: string;
    previous_generated_url?: string | null;
    new_generated_url?: string | null;
  }> | null;
};


export default function OrderDetailPage() {
  const params = useParams();
  const orderId = params.id as string;

  const [order, setOrder] = useState<Order | null>(null);
  const [images, setImages] = useState<OrderImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [deletingOrder, setDeletingOrder] = useState(false);
  const [approvingAll, setApprovingAll] = useState(false);
  const [regeneratingImageId, setRegeneratingImageId] = useState<string | null>(null);
  const [updatingApprovalId, setUpdatingApprovalId] = useState<string | null>(null);
  const [manualReplacingImageId, setManualReplacingImageId] = useState<string | null>(null);
  const [regenerationInstructions, setRegenerationInstructions] = useState<Record<string, string>>({});
  const [captionDrafts, setCaptionDrafts] = useState<Record<string, string>>({});
  const [savingCaptionImageId, setSavingCaptionImageId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const generatedCount = images.filter((image) => image.generated_url).length;
  const approvedCount = images.filter((image) => image.approved).length;
  const failedCount = images.filter((image) => image.status === "failed").length;
  const productType = order?.product_type === "story_book" ? "story_book" : "colouring_book";
  const isStoryBook = productType === "story_book";
  const productLabel = isStoryBook ? "Story Book" : "Colouring Book";

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
      const loadedImages = data.images || [];
      setImages(loadedImages);
      setCaptionDrafts((current) => {
        const next = { ...current };

        for (const image of loadedImages) {
          if (next[image.id] === undefined) {
            next[image.id] = image.caption_text || "";
          }
        }

        return next;
      });
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

  async function saveCaption(imageId: string, pageNumber: number) {
    const caption = (captionDrafts[imageId] || "").trim();

    if (caption.length > 180) {
      setMessage("Caption must be 180 characters or fewer.");
      return;
    }

    setSavingCaptionImageId(imageId);
    setMessage(`Saving caption for page ${pageNumber}...`);

    try {
      const response = await fetch(`/api/order-images/${imageId}/caption`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ caption_text: caption }),
      });

      const data = await response.json();

      if (!response.ok) {
        setMessage(data.error || `Caption save failed for page ${pageNumber}.`);
        return;
      }

      setMessage(`Caption saved for page ${pageNumber}.`);
      await loadOrder();
    } catch {
      setMessage(`Caption save failed for page ${pageNumber}.`);
    } finally {
      setSavingCaptionImageId(null);
    }
  }

  async function regenerateSinglePage(imageId: string, pageNumber: number) {
    const instruction = (regenerationInstructions[imageId] || "").trim();

    if (instruction.length > 800) {
      setMessage("Regeneration instruction must be 800 characters or fewer.");
      return;
    }

    setRegeneratingImageId(imageId);
    setMessage(
      instruction
        ? `Regenerating page ${pageNumber} with your scoped correction...`
        : `Regenerating page ${pageNumber}...`
    );

    try {
      const response = await fetch(`/api/order-images/${imageId}/regenerate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ instruction }),
      });

      const data = await response.json();

      if (!response.ok) {
        setMessage(data.error || `Page ${pageNumber} regeneration failed.`);
        await loadOrder();
        return;
      }

      setMessage(
        instruction
          ? `Page ${pageNumber} regenerated with the requested correction.`
          : `Page ${pageNumber} regenerated successfully.`
      );
      setRegenerationInstructions((current) => ({
        ...current,
        [imageId]: "",
      }));
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


  async function deleteOrder() {
    const confirmed = window.confirm(
      "Delete this order from the dashboard? This removes the order rows from Supabase. Stored files may remain in Storage."
    );

    if (!confirmed) {
      return;
    }

    setDeletingOrder(true);
    setMessage("Deleting order...");

    try {
      const response = await fetch(`/api/orders/${orderId}`, {
        method: "DELETE",
      });

      const data = await response.json();

      if (!response.ok) {
        setMessage(data.error || "Delete order failed.");
        return;
      }

      window.location.href = "/";
    } catch {
      setMessage("Delete order failed.");
    } finally {
      setDeletingOrder(false);
    }
  }

  async function replaceGeneratedImage(imageId: string, fileList: FileList | null, pageNumber: number) {
    if (!fileList || fileList.length === 0) {
      return;
    }

    const file = fileList[0];

    setManualReplacingImageId(imageId);
    setMessage(`Replacing generated page ${pageNumber}...`);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch(`/api/order-images/${imageId}/replace-generated`, {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        setMessage(data.error || "Manual replacement failed.");
        return;
      }

      setMessage(`Page ${pageNumber} manually replaced. Review and approve it again.`);
      await loadOrder();
    } catch {
      setMessage("Manual replacement failed.");
    } finally {
      setManualReplacingImageId(null);
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
              <p>{order.page_count} page {productLabel}</p>
              <p>Product: {productLabel}</p>
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
                disabled={generating || images.length === 0 || regeneratingImageId !== null || exportingPdf || approvingAll || deletingOrder}
                className="rounded-xl bg-white px-5 py-3 text-sm font-medium text-black hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {generating ? "Generating..." : isStoryBook ? "Generate Story Pages" : "Generate All Pages"}
              </button>

              <button
                onClick={approveAllGenerated}
                disabled={approvingAll || generatedCount === 0 || generating || regeneratingImageId !== null || exportingPdf || deletingOrder}
                className="rounded-xl border border-green-900 px-5 py-3 text-sm font-medium text-green-300 hover:border-green-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {approvingAll ? "Approving..." : "Approve All Generated"}
              </button>

              <button
                onClick={exportPdf}
                disabled={exportingPdf || approvedCount === 0 || generating || regeneratingImageId !== null || approvingAll || deletingOrder}
                className="rounded-xl border border-neutral-700 px-5 py-3 text-sm font-medium text-neutral-100 hover:border-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {exportingPdf ? "Exporting PDF..." : isStoryBook ? "Export Story Book PDF" : "Export Approved PDF"}
              </button>

              <button
                onClick={deleteOrder}
                disabled={deletingOrder || generating || regeneratingImageId !== null || exportingPdf || approvingAll}
                className="rounded-xl border border-red-900 px-5 py-3 text-sm font-medium text-red-300 hover:border-red-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {deletingOrder ? "Deleting..." : "Delete Order"}
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
                const originalPreviewUrl =
                  image.preview_url || image.original_url;
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


                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <p className="mb-2 text-sm text-neutral-400">
                          Original
                        </p>

                        <div className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900">
                          <img
                            src={originalPreviewUrl}
                            alt={`Original page ${image.page_number}`}
                            className="h-auto w-full object-contain"
                          />
                        </div>
                      </div>

                      <div>
                        <p className="mb-2 text-sm text-neutral-400">
                          {isStoryBook ? "Generated Story Page" : "Generated Colouring Page"}
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

                        {isStoryBook && (
                          <div className="mt-4 rounded-xl border border-neutral-800 bg-neutral-900 p-4">
                            <label
                              htmlFor={`caption-${image.id}`}
                              className="text-sm font-medium text-neutral-200"
                            >
                              Story Book caption
                              <span className="ml-2 font-normal text-neutral-500">
                                optional
                              </span>
                            </label>

                            <p className="mt-1 text-xs leading-5 text-neutral-500">
                              This caption is used as context for generation and printed cleanly in the exported PDF.
                              The AI should not draw the text into the image itself.
                            </p>

                            <textarea
                              id={`caption-${image.id}`}
                              value={captionDrafts[image.id] || ""}
                              maxLength={180}
                              rows={2}
                              disabled={
                                generating ||
                                regeneratingImageId !== null ||
                                exportingPdf ||
                                approvingAll ||
                                deletingOrder ||
                                savingCaptionImageId !== null
                              }
                              onChange={(event) =>
                                setCaptionDrafts((current) => ({
                                  ...current,
                                  [image.id]: event.target.value,
                                }))
                              }
                              placeholder="Example: This was the day we had the picnic."
                              className="mt-3 w-full resize-y rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-3 text-sm text-white outline-none placeholder:text-neutral-600 focus:border-neutral-400 disabled:cursor-not-allowed disabled:opacity-50"
                            />

                            <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                              <p className="text-xs text-neutral-600">
                                {(captionDrafts[image.id] || "").length}/180
                              </p>

                              <button
                                onClick={() => saveCaption(image.id, image.page_number)}
                                disabled={
                                  generating ||
                                  regeneratingImageId !== null ||
                                  exportingPdf ||
                                  approvingAll ||
                                  deletingOrder ||
                                  savingCaptionImageId !== null
                                }
                                className="rounded-xl border border-neutral-700 px-4 py-2 text-sm text-neutral-200 hover:border-white disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {savingCaptionImageId === image.id
                                  ? "Saving..."
                                  : "Save Caption"}
                              </button>
                            </div>
                          </div>
                        )}

                        <div className="mt-4 rounded-xl border border-neutral-800 bg-neutral-900 p-4">
                          <label
                            htmlFor={`regeneration-instruction-${image.id}`}
                            className="text-sm font-medium text-neutral-200"
                          >
                            Regeneration correction
                            <span className="ml-2 font-normal text-neutral-500">
                              optional
                            </span>
                          </label>

                          <p className="mt-1 text-xs leading-5 text-neutral-500">
                            Describe only the defect that needs fixing. The master
                            prompt stays unchanged, and the correction applies only
                            to this page and this attempt.
                          </p>

                          <textarea
                            id={`regeneration-instruction-${image.id}`}
                            value={regenerationInstructions[image.id] || ""}
                            maxLength={800}
                            rows={3}
                            disabled={
                              generating ||
                              regeneratingImageId !== null ||
                              exportingPdf ||
                              approvingAll ||
                              deletingOrder
                            }
                            onChange={(event) =>
                              setRegenerationInstructions((current) => ({
                                ...current,
                                [image.id]: event.target.value,
                              }))
                            }
                            placeholder="Example: Keep every face and the composition unchanged. Remove the solid black fill from all head hair and replace it with clean outline and strand detail, leaving colourable white space."
                            className="mt-3 w-full resize-y rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-3 text-sm text-white outline-none placeholder:text-neutral-600 focus:border-neutral-400 disabled:cursor-not-allowed disabled:opacity-50"
                          />

                          <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <p className="text-xs text-neutral-600">
                              {(regenerationInstructions[image.id] || "").length}/800
                            </p>

                            <button
                              onClick={() =>
                                regenerateSinglePage(
                                  image.id,
                                  image.page_number
                                )
                              }
                              disabled={
                                generating ||
                                regeneratingImageId !== null ||
                                exportingPdf ||
                                approvingAll ||
                                deletingOrder
                              }
                              className="rounded-xl bg-white px-4 py-2 text-sm font-medium text-black hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {isRegeneratingThisImage
                                ? "Regenerating..."
                                : (regenerationInstructions[image.id] || "").trim()
                                  ? "Regenerate With Correction"
                                  : image.generated_url
                                    ? "Regenerate Page"
                                    : "Generate Page"}
                            </button>
                          </div>

                          {image.last_regeneration_instruction && (
                            <div className="mt-3 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2">
                              <p className="text-xs font-medium text-neutral-400">
                                Last correction used
                              </p>
                              <p className="mt-1 text-xs leading-5 text-neutral-500">
                                {image.last_regeneration_instruction}
                              </p>
                            </div>
                          )}
                        </div>

                        <div className="mt-3 flex flex-col gap-2">
                          <label className="w-fit cursor-pointer rounded-xl border border-neutral-700 px-4 py-2 text-sm text-neutral-200 hover:border-white">
                            {manualReplacingImageId === image.id
                              ? "Replacing..."
                              : "Manual Replace Generated Page"}
                            <input
                              type="file"
                              accept="image/*,.png,.jpg,.jpeg,.webp"
                              className="hidden"
                              disabled={manualReplacingImageId !== null || generating || regeneratingImageId !== null || exportingPdf || approvingAll || deletingOrder}
                              onChange={(event) =>
                                replaceGeneratedImage(
                                  image.id,
                                  event.target.files,
                                  image.page_number
                                )
                              }
                            />
                          </label>

                          <p className="text-xs text-neutral-500">
                            Use this if you manually fix or upscale a page outside the app.
                            Replacement pages must be reviewed and approved again.
                          </p>
                        </div>

                        {image.model_used && (
                          <p className="mt-2 text-xs text-neutral-500">
                            Model: {image.model_used} · Prompt: {image.prompt_version || "unknown"}
                            {image.replaced_manually ? " · manually replaced" : ""}
                          </p>
                        )}

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
