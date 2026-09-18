import { NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { buildMemoryBooksLineItemPlans } from "../../../../lib/shopify/line-item-import";
import { validateImageBuffer } from "../../../../lib/image-validation";
import { fetchApprovedRemoteUpload } from "../../../../lib/remote-upload-fetch";

type ShopifyAddress = {
  name?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  province?: string | null;
  zip?: string | null;
  country?: string | null;
  country_code?: string | null;
  phone?: string | null;
};

type UploadFile = {
  buffer: Buffer;
  contentType: string;
  filename: string;
  sourceUrl: string;
  previewUrl: string | null;
};

function verifyShopifyHmac(rawBody: string, hmacHeader: string | null) {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET || "";

  if (!secret) {
    throw new Error("SHOPIFY_WEBHOOK_SECRET is not configured.");
  }

  if (!hmacHeader) {
    throw new Error("Missing Shopify HMAC header.");
  }

  const digest = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("base64");

  const expected = Buffer.from(digest, "utf8");
  const actual = Buffer.from(hmacHeader, "utf8");

  if (expected.length !== actual.length) {
    throw new Error("Invalid Shopify HMAC.");
  }

  if (!crypto.timingSafeEqual(expected, actual)) {
    throw new Error("Invalid Shopify HMAC.");
  }
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function safeText(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function decodeBase64UrlParam(value: string | null) {
  if (!value) {
    return null;
  }

  try {
    return Buffer.from(value, "base64").toString("utf8");
  } catch {
    return null;
  }
}

function filenameFromUrl(uploadUrl: string, fallback: string) {
  try {
    const url = new URL(uploadUrl);
    const encodedFilename = url.searchParams.get("fi");
    const decodedFilename = decodeBase64UrlParam(encodedFilename);

    if (decodedFilename) {
      return decodedFilename;
    }

    const pathnameFilename = decodeURIComponent(
      url.pathname.split("/").filter(Boolean).pop() || ""
    );

    if (pathnameFilename && pathnameFilename.includes(".")) {
      return pathnameFilename;
    }
  } catch {
    // ignore
  }

  return fallback;
}


function uploadcarePreviewUrl(sourceUrl: string, contentType: string) {
  const normalizedType = contentType.toLowerCase();

  if (!normalizedType.includes("heic") && !normalizedType.includes("heif")) {
    return null;
  }

  try {
    const url = new URL(sourceUrl);

    if (!url.hostname.includes("ucarecdn.com")) {
      return null;
    }

    const uuid = url.pathname.split("/").filter(Boolean)[0];

    if (
      !uuid ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        uuid
      )
    ) {
      return null;
    }

    return `https://ucarecdn.com/${uuid}/-/preview/1600x1600/-/format/jpeg/`;
  } catch {
    return null;
  }
}

function extractUrlsFromText(value: string) {
  const urls = new Set<string>();
  const decoded = value.replace(/&amp;/g, "&");

  const matches = decoded.match(/https?:\/\/[^\s"'<>]+/g) || [];

  for (const match of matches) {
    urls.add(match.replace(/[),.;]+$/g, ""));
  }

  return Array.from(urls);
}

function buildUploadUrlCandidates(uploadUrl: string) {
  const candidates: string[] = [];

  function addCandidate(value: string | null | undefined) {
    if (value && !candidates.includes(value)) {
      candidates.push(value);
    }
  }

  try {
    const url = new URL(uploadUrl);

    const uploadcareUuid = url.searchParams.get("uu");
    const decodedFilename = decodeBase64UrlParam(
      url.searchParams.get("fi")
    );

    if (
      uploadcareUuid &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        uploadcareUuid
      )
    ) {
      if (decodedFilename) {
        addCandidate(
          `https://ucarecdn.com/${uploadcareUuid}/${encodeURIComponent(
            decodedFilename
          )}`
        );
      }

      addCandidate(`https://ucarecdn.com/${uploadcareUuid}/`);
    }

    if (url.pathname.endsWith("/download.html")) {
      const direct = new URL(url.toString());
      direct.pathname = direct.pathname.replace(
        /\/download\.html$/,
        "/download"
      );
      addCandidate(direct.toString());
    }

    const raw = new URL(url.toString());
    raw.searchParams.set("download", "1");
    addCandidate(raw.toString());

    const original = new URL(url.toString());
    original.searchParams.set("raw", "1");
    addCandidate(original.toString());
  } catch {
    // Keep the original URL as the final fallback.
  }

  addCandidate(uploadUrl);

  return candidates;
}

function extractCandidatesFromHtml(html: string, baseUrl: string) {
  const candidates = new Set<string>();
  const decodedHtml = html.replace(/&amp;/g, "&");

  const attrRegex = /(href|src)=["']([^"']+)["']/gi;
  let attrMatch: RegExpExecArray | null;

  while ((attrMatch = attrRegex.exec(decodedHtml))) {
    try {
      const absoluteUrl = new URL(attrMatch[2], baseUrl).toString();
      candidates.add(absoluteUrl);
    } catch {
      // ignore invalid
    }
  }

  for (const url of extractUrlsFromText(decodedHtml)) {
    candidates.add(url);
  }

  return Array.from(candidates).filter((candidate) => {
    const lower = candidate.toLowerCase();

    if (
      lower.endsWith(".css") ||
      lower.endsWith(".js") ||
      lower.includes("stylesheet") ||
      lower.includes("javascript:")
    ) {
      return false;
    }

    return (
      lower.includes("uploadkit") ||
      lower.includes("cdn.shopify") ||
      lower.includes("supabase.co/storage") ||
      lower.includes("/storage/v1/object/public/originals/") ||
      lower.includes("image") ||
      /\.(jpg|jpeg|png|webp|heic|heif|gif|bmp|tif|tiff|avif)(\?|$)/i.test(lower)
    );
  });
}

async function downloadUploadFile(uploadUrl: string, fallbackIndex: number): Promise<UploadFile> {
  const queue = buildUploadUrlCandidates(uploadUrl);
  const visited = new Set<string>();
  let lastFailureCode = "REMOTE_SOURCE_UNRESOLVED";

  const fallbackFilename =
    filenameFromUrl(uploadUrl, "shopify-upload-page-" + fallbackIndex + ".jpg") ||
    "shopify-upload-page-" + fallbackIndex + ".jpg";

  while (queue.length > 0) {
    const candidate = queue.shift();

    if (!candidate || visited.has(candidate)) {
      continue;
    }

    visited.add(candidate);

    try {
      const remote = await fetchApprovedRemoteUpload({ url: candidate });
      const contentType = remote.contentType.toLowerCase();

      if (
        contentType.startsWith("image/") ||
        contentType.includes("application/octet-stream")
      ) {
        const validated = await validateImageBuffer(
          remote.bytes,
          fallbackFilename
        );
        const sourceFilename = filenameFromUrl(remote.finalUrl, fallbackFilename);
        const filenameBase =
          sourceFilename.replace(/\.[^.]+$/, "") ||
          "shopify-upload-page-" + fallbackIndex;

        return {
          buffer: remote.bytes,
          contentType: validated.mimeType,
          filename: filenameBase + "." + validated.extension,
          sourceUrl: remote.finalUrl,
          previewUrl: uploadcarePreviewUrl(
            remote.finalUrl,
            validated.mimeType
          ),
        };
      }

      if (contentType.includes("text/html")) {
        const htmlCandidates = extractCandidatesFromHtml(
          remote.bytes.toString("utf8"),
          remote.finalUrl
        );

        for (const htmlCandidate of htmlCandidates) {
          if (!visited.has(htmlCandidate)) {
            queue.push(htmlCandidate);
          }
        }
      }
    } catch (error) {
      if (error && typeof error === "object" && "code" in error) {
        lastFailureCode = String((error as { code?: unknown }).code || lastFailureCode);
      }
      // Candidate failures are isolated to this upload source. Try another
      // allowlisted direct-download candidate before reporting this book error.
    }
  }

  throw new Error(
    "Shopify upload source was rejected or could not be resolved: " +
      lastFailureCode
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function getCustomerName(order: Record<string, unknown>) {
  const shipping = asRecord(order.shipping_address);
  const customer = asRecord(order.customer);
  const name = [safeText(customer.first_name), safeText(customer.last_name)].filter(Boolean).join(" ");
  return safeText(shipping.name) || safeText(name) || safeText(order.email) || "Shopify Customer";
}

function getCustomerEmail(order: Record<string, unknown>) {
  return safeText(order.email) || safeText(order.contact_email) || safeText(asRecord(order.customer).email) || "unknown@email.com";
}

function getShippingPrice(order: Record<string, unknown>) {
  const shippingLines = Array.isArray(order.shipping_lines) ? order.shipping_lines : [];
  const first = asRecord(shippingLines[0]);
  if (first.price) return String(first.price);
  return safeText(asRecord(asRecord(order.total_shipping_price_set).shop_money).amount);
}
function mapAddress(address: unknown, prefix: "shipping" | "billing") {
  const value = asRecord(address) as ShopifyAddress;
  return {
    [`${prefix}_name`]: safeText(value.name),
    [`${prefix}_address1`]: safeText(value.address1),
    [`${prefix}_address2`]: safeText(value.address2),
    [`${prefix}_city`]: safeText(value.city),
    [`${prefix}_province`]: safeText(value.province),
    [`${prefix}_zip`]: safeText(value.zip),
    [`${prefix}_country`]: safeText(value.country),
    [`${prefix}_phone`]: safeText(value.phone),
    ...(prefix === "shipping"
      ? { shipping_country_code: safeText(value.country_code) }
      : {}),
  };
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    route: "/api/shopify/order-paid",
    message: "Shopify paid-order webhook endpoint is ready. Use POST from Shopify.",
  });
}

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    verifyShopifyHmac(rawBody, request.headers.get("x-shopify-hmac-sha256"));

    const order = JSON.parse(rawBody) as Record<string, unknown>;
    const shopifyOrderId = String(order.id || "");
    const shopifyOrderName = safeText(order.name) || safeText(order.order_number) || shopifyOrderId;
    if (!shopifyOrderId) return NextResponse.json({ error: "Missing Shopify order ID." }, { status: 400 });

    const { plans, skipped } = buildMemoryBooksLineItemPlans(order);
    const customerName = getCustomerName(order);
    const customerEmail = getCustomerEmail(order);
    const jobs: Array<Record<string, unknown>> = [];

    for (const plan of plans) {
      const { data: exactExisting, error: exactError } = await supabaseAdmin
        .from("orders").select("*")
        .eq("shopify_order_id", shopifyOrderId)
        .eq("shopify_line_item_id", plan.lineItemId)
        .maybeSingle();
      if (exactError) throw new Error(`SHOPIFY_LINE_ITEM_LOOKUP: ${exactError.message}`);

      let bookJob = exactExisting;
      // Historical single-book imports did not always have a persisted line ID.
      // Reuse only when this webhook contains exactly one supported Memory Books line.
      if (!bookJob && plans.length === 1) {
        const { data: legacy, error: legacyError } = await supabaseAdmin
          .from("orders").select("*")
          .eq("shopify_order_id", shopifyOrderId)
          .is("shopify_line_item_id", null)
          .maybeSingle();
        if (legacyError) throw new Error(`SHOPIFY_LEGACY_LOOKUP: ${legacyError.message}`);
        bookJob = legacy;
      }

      if (!bookJob) {
        const orderInsert = {
          customer_name: customerName,
          customer_email: customerEmail,
          page_count: plan.pageCount,
          product_type: plan.productType,
          status: plan.uploadUrls.length ? "shopify_imported" : "missing_uploads",
          shopify_order_id: shopifyOrderId,
          shopify_order_name: shopifyOrderName,
          shopify_line_item_id: plan.lineItemId,
          shopify_customization_id: plan.customizationId,
          shopify_raw: order,
          grace_recipient: plan.graceRecipient,
          grace_from: plan.graceFrom,
          grace_message: plan.graceMessage,
          ...mapAddress(order.shipping_address, "shipping"),
          ...mapAddress(order.billing_address, "billing"),
          product_title: plan.productTitle,
          variant_title: plan.variantTitle,
          quantity: plan.quantity,
          currency: safeText(order.currency) || safeText(order.presentment_currency),
          subtotal_price: safeText(order.subtotal_price),
          shipping_price: getShippingPrice(order),
          total_price: safeText(order.total_price),
          financial_status: safeText(order.financial_status),
          payment_gateway: Array.isArray(order.payment_gateway_names) ? order.payment_gateway_names.join(", ") : safeText(order.payment_gateway_names),
          pod_status: "not_submitted",
        };
        const { data, error } = await supabaseAdmin.from("orders").insert(orderInsert).select("*").single();
        if (error || !data) {
          // With the planned composite unique index, a concurrent duplicate webhook
          // can lose the insert race and safely load the already-created book job.
          const { data: raced } = await supabaseAdmin.from("orders").select("*")
            .eq("shopify_order_id", shopifyOrderId).eq("shopify_line_item_id", plan.lineItemId).maybeSingle();
          if (!raced) throw new Error(error?.message || "Failed to create Shopify line-item book job.");
          bookJob = raced;
        } else bookJob = data;
      }

      const { data: existingImages, error: imagesError } = await supabaseAdmin
        .from("order_images").select("page_number")
        .eq("order_id", bookJob.id);
      if (imagesError) throw new Error(`SHOPIFY_LINE_ITEM_IMAGES: ${imagesError.message}`);
      const importedPages = new Set((existingImages || []).map((image) => Number(image.page_number)));
      const orderFolder = `${slugify(customerName || "shopify-order")}-${bookJob.id.slice(0, 8)}`;
      const failedUploads: Array<{ page: number; error: string }> = [];
      let newlyImported = 0;

      for (let index = 0; index < plan.uploadUrls.length; index += 1) {
        const pageNumber = index + 1;
        if (importedPages.has(pageNumber)) continue;
        try {
          const file = await downloadUploadFile(plan.uploadUrls[index], pageNumber);
          const extension = file.filename.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || file.contentType.split("/")[1] || "jpg";
          const storagePath = orderFolder + "/shopify-import/page-" + pageNumber + "-" + crypto.randomUUID() + "." + extension;
          const { error: uploadError } = await supabaseAdmin.storage.from("originals").upload(storagePath, file.buffer, { contentType: file.contentType, upsert: false });
          if (uploadError) throw new Error(uploadError.message);
          const { data: publicUrlData } = supabaseAdmin.storage.from("originals").getPublicUrl(storagePath);
          const { error: imageError } = await supabaseAdmin.from("order_images").insert({
            order_id: bookJob.id,
            original_url: publicUrlData.publicUrl,
            preview_url: file.previewUrl,
            original_filename: file.filename,
            mime_type: file.contentType,
            page_number: pageNumber,
            caption_text: plan.captionsByPage[pageNumber] || null,
            caption_source: plan.captionsByPage[pageNumber] ? "shopify" : "admin",
            status: "uploaded",
            approved: false,
            error_message: null,
          });
          if (imageError) throw new Error(imageError.message);
          newlyImported += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : "Upload import failed.";
          console.warn("[shopify-upload-import]", {
            orderId: bookJob.id,
            lineItemId: plan.lineItemId,
            pageNumber,
            message,
          });
          failedUploads.push({ page: pageNumber, error: message });
        }
      }

      if (plan.uploadUrls.length === 0 || failedUploads.length > 0) {
        const status = plan.uploadUrls.length === 0 ? "missing_uploads" : newlyImported ? "upload_import_partial" : "upload_import_failed";
        await supabaseAdmin.from("orders").update({ status }).eq("id", bookJob.id);
      }

      jobs.push({
        order_id: bookJob.id,
        shopify_line_item_id: plan.lineItemId,
        customization_id: plan.customizationId,
        quantity: plan.quantity,
        product_type: plan.productType,
        page_count: plan.pageCount,
        uploaded_images: newlyImported,
        existing_images: importedPages.size,
        failed_uploads: failedUploads,
      });
    }

    return NextResponse.json({ ok: true, shopify_order_id: shopifyOrderId, jobs, skipped_line_items: skipped });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Shopify webhook failed." }, { status: 500 });
  }
}
