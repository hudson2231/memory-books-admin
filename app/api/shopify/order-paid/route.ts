import { NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

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

function mimeFromUrl(uploadUrl: string) {
  try {
    const url = new URL(uploadUrl);
    const encodedMime = url.searchParams.get("mi");
    const decodedMime = decodeBase64UrlParam(encodedMime);

    if (decodedMime) {
      return decodedMime;
    }
  } catch {
    // ignore
  }

  return null;
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

function collectUploadUrls(input: unknown, urls = new Set<string>()) {
  if (input === null || input === undefined) {
    return urls;
  }

  if (typeof input === "string") {
    for (const url of extractUrlsFromText(input)) {
      const lower = url.toLowerCase();

      if (
        lower.includes("uploadkit") ||
        lower.includes("cdn.shopify") ||
        lower.includes("supabase.co/storage") ||
        lower.includes("/storage/v1/object/public/originals/") ||
        lower.includes("image=true") ||
        lower.includes("download.html")
      ) {
        urls.add(url);
      }
    }

    try {
      const parsed = JSON.parse(input);
      collectUploadUrls(parsed, urls);
    } catch {
      // normal plain string
    }

    return urls;
  }

  if (Array.isArray(input)) {
    for (const item of input) {
      collectUploadUrls(item, urls);
    }

    return urls;
  }

  if (typeof input === "object") {
    for (const value of Object.values(input as Record<string, unknown>)) {
      collectUploadUrls(value, urls);
    }
  }

  return urls;
}

function buildUploadUrlCandidates(uploadUrl: string) {
  const candidates = new Set<string>();
  candidates.add(uploadUrl);

  try {
    const url = new URL(uploadUrl);

    if (url.pathname.endsWith("/download.html")) {
      const direct = new URL(url.toString());
      direct.pathname = direct.pathname.replace(/\/download\.html$/, "/download");
      candidates.add(direct.toString());
    }

    const raw = new URL(url.toString());
    raw.searchParams.set("download", "1");
    candidates.add(raw.toString());

    const original = new URL(url.toString());
    original.searchParams.set("raw", "1");
    candidates.add(original.toString());
  } catch {
    // ignore
  }

  return Array.from(candidates);
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

  const fallbackFilename =
    filenameFromUrl(uploadUrl, `shopify-upload-page-${fallbackIndex}.jpg`) ||
    `shopify-upload-page-${fallbackIndex}.jpg`;

  const urlMime = mimeFromUrl(uploadUrl);

  while (queue.length > 0) {
    const candidate = queue.shift();

    if (!candidate || visited.has(candidate)) {
      continue;
    }

    visited.add(candidate);

    const response = await fetch(candidate, {
      redirect: "follow",
      headers: {
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        "User-Agent": "MemoryBooksWebhook/1.0",
      },
    });

    if (!response.ok) {
      continue;
    }

    const contentType = response.headers.get("content-type") || "";

    if (contentType.toLowerCase().startsWith("image/")) {
      const arrayBuffer = await response.arrayBuffer();

      return {
        buffer: Buffer.from(arrayBuffer),
        contentType: contentType.split(";")[0],
        filename: filenameFromUrl(candidate, fallbackFilename),
        sourceUrl: candidate,
      };
    }

    if (contentType.toLowerCase().includes("text/html")) {
      const html = await response.text();
      const htmlCandidates = extractCandidatesFromHtml(html, response.url || candidate);

      for (const htmlCandidate of htmlCandidates) {
        if (!visited.has(htmlCandidate)) {
          queue.push(htmlCandidate);
        }
      }

      continue;
    }

    if (
      urlMime?.startsWith("image/") &&
      contentType.toLowerCase().includes("application/octet-stream")
    ) {
      const arrayBuffer = await response.arrayBuffer();

      return {
        buffer: Buffer.from(arrayBuffer),
        contentType: urlMime,
        filename: fallbackFilename,
        sourceUrl: candidate,
      };
    }
  }

  throw new Error(`Could not resolve UploadKit image file from ${uploadUrl}`);
}

function getCustomerName(order: Record<string, any>) {
  const shipping = order.shipping_address || {};
  const customer = order.customer || {};

  return (
    safeText(shipping.name) ||
    safeText(`${customer.first_name || ""} ${customer.last_name || ""}`) ||
    safeText(order.email) ||
    "Shopify Customer"
  );
}

function getCustomerEmail(order: Record<string, any>) {
  return (
    safeText(order.email) ||
    safeText(order.contact_email) ||
    safeText(order.customer?.email) ||
    "unknown@email.com"
  );
}

function getPrimaryLineItem(order: Record<string, any>) {
  const lineItems = Array.isArray(order.line_items) ? order.line_items : [];
  return lineItems[0] || {};
}

function getShippingPrice(order: Record<string, any>) {
  const shippingLines = Array.isArray(order.shipping_lines)
    ? order.shipping_lines
    : [];

  if (shippingLines[0]?.price) {
    return String(shippingLines[0].price);
  }

  return safeText(order.total_shipping_price_set?.shop_money?.amount);
}

function inferPageCount(order: Record<string, any>) {
  const lineItem = getPrimaryLineItem(order);

  const variantTitle = safeText(lineItem.variant_title);
  const title = safeText(lineItem.title);
  const name = safeText(lineItem.name);
  const combined = `${variantTitle || ""} ${title || ""} ${name || ""}`;

  const match = combined.match(/(\d+)\s*(page|pages)/i);

  if (match) {
    return Number(match[1]);
  }

  return 20;
}

function mapAddress(address: ShopifyAddress | null | undefined, prefix: "shipping" | "billing") {
  return {
    [`${prefix}_name`]: safeText(address?.name),
    [`${prefix}_address1`]: safeText(address?.address1),
    [`${prefix}_address2`]: safeText(address?.address2),
    [`${prefix}_city`]: safeText(address?.city),
    [`${prefix}_province`]: safeText(address?.province),
    [`${prefix}_zip`]: safeText(address?.zip),
    [`${prefix}_country`]: safeText(address?.country),
    [`${prefix}_phone`]: safeText(address?.phone),
    ...(prefix === "shipping"
      ? { shipping_country_code: safeText(address?.country_code) }
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
    const hmacHeader = request.headers.get("x-shopify-hmac-sha256");

    verifyShopifyHmac(rawBody, hmacHeader);

    const order = JSON.parse(rawBody);
    const shopifyOrderId = String(order.id || "");
    const shopifyOrderName = safeText(order.name) || safeText(order.order_number) || shopifyOrderId;

    if (!shopifyOrderId) {
      return NextResponse.json(
        { error: "Missing Shopify order ID." },
        { status: 400 }
      );
    }

    const { data: existingOrder } = await supabaseAdmin
      .from("orders")
      .select("id")
      .eq("shopify_order_id", shopifyOrderId)
      .maybeSingle();

    if (existingOrder) {
      return NextResponse.json({
        ok: true,
        duplicate: true,
        order_id: existingOrder.id,
      });
    }

    const customerName = getCustomerName(order);
    const customerEmail = getCustomerEmail(order);
    const lineItem = getPrimaryLineItem(order);
    const pageCount = inferPageCount(order);

    const uploadUrls = Array.from(collectUploadUrls(order.line_items || []));

    const orderInsert = {
      customer_name: customerName,
      customer_email: customerEmail,
      page_count: pageCount,
      status: uploadUrls.length > 0 ? "shopify_imported" : "missing_uploads",
      shopify_order_id: shopifyOrderId,
      shopify_order_name: shopifyOrderName,
      shopify_raw: order,

      ...mapAddress(order.shipping_address, "shipping"),
      ...mapAddress(order.billing_address, "billing"),

      product_title: safeText(lineItem.title) || safeText(lineItem.name),
      variant_title: safeText(lineItem.variant_title),
      quantity: Number(lineItem.quantity || 1),
      currency: safeText(order.currency) || safeText(order.presentment_currency),
      subtotal_price: safeText(order.subtotal_price),
      shipping_price: getShippingPrice(order),
      total_price: safeText(order.total_price),
      financial_status: safeText(order.financial_status),
      payment_gateway: Array.isArray(order.payment_gateway_names)
        ? order.payment_gateway_names.join(", ")
        : safeText(order.payment_gateway_names),
      pod_status: "not_submitted",
    };

    const { data: createdOrder, error: orderError } = await supabaseAdmin
      .from("orders")
      .insert(orderInsert)
      .select("*")
      .single();

    if (orderError || !createdOrder) {
      throw new Error(orderError?.message || "Failed to create Shopify order.");
    }

    const orderSlug = slugify(customerName || "shopify-order");
    const shortOrderId = createdOrder.id.slice(0, 8);
    const orderFolder = `${orderSlug}-${shortOrderId}`;

    const uploadedImages = [];
    const failedUploads = [];

    for (let index = 0; index < uploadUrls.length; index += 1) {
      const uploadUrl = uploadUrls[index];

      try {
        const file = await downloadUploadFile(uploadUrl, index + 1);

        const safeFilename = slugify(file.filename.replace(/\.[^.]+$/, "")) || `page-${index + 1}`;
        const extension =
          file.filename.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") ||
          file.contentType.split("/")[1] ||
          "jpg";

        const storagePath = `${orderFolder}/page-${index + 1}-${safeFilename}.${extension}`;

        const { error: uploadError } = await supabaseAdmin.storage
          .from("originals")
          .upload(storagePath, file.buffer, {
            contentType: file.contentType,
            upsert: true,
          });

        if (uploadError) {
          throw new Error(uploadError.message);
        }

        const { data: publicUrlData } = supabaseAdmin.storage
          .from("originals")
          .getPublicUrl(storagePath);

        const { data: imageRow, error: imageError } = await supabaseAdmin
          .from("order_images")
          .insert({
            order_id: createdOrder.id,
            original_url: publicUrlData.publicUrl,
            original_filename: file.filename,
            mime_type: file.contentType,
            page_number: index + 1,
            status: "uploaded",
            approved: false,
            error_message: null,
          })
          .select("*")
          .single();

        if (imageError) {
          throw new Error(imageError.message);
        }

        uploadedImages.push(imageRow);
      } catch (error) {
        failedUploads.push({
          url: uploadUrl,
          error: error instanceof Error ? error.message : "Upload import failed.",
        });
      }
    }

    if (failedUploads.length > 0 && uploadedImages.length === 0) {
      await supabaseAdmin
        .from("orders")
        .update({
          status: "upload_import_failed",
        })
        .eq("id", createdOrder.id);
    }

    return NextResponse.json({
      ok: true,
      order_id: createdOrder.id,
      uploaded_images: uploadedImages.length,
      failed_uploads: failedUploads,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Shopify webhook failed.";

    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
