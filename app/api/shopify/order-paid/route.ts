import { NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const runtime = "nodejs";

type ShopifyLineItemProperty = {
  name?: string;
  value?: unknown;
};

type ShopifyLineItem = {
  id?: number;
  title?: string;
  variant_title?: string | null;
  quantity?: number;
  properties?: ShopifyLineItemProperty[];
};

type ShopifyCustomer = {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
};

type ShopifyOrderPayload = {
  id?: number;
  name?: string;
  email?: string | null;
  contact_email?: string | null;
  customer?: ShopifyCustomer | null;
  line_items?: ShopifyLineItem[];
  shipping_address?: {
    name?: string | null;
    first_name?: string | null;
    last_name?: string | null;
  } | null;
  billing_address?: {
    name?: string | null;
    first_name?: string | null;
    last_name?: string | null;
  } | null;
};

const EXTENSION_TO_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  avif: "image/avif",
  gif: "image/gif",
  bmp: "image/bmp",
  dib: "image/bmp",
  tif: "image/tiff",
  tiff: "image/tiff",
  jfif: "image/jpeg",
  pjpeg: "image/jpeg",
  pjp: "image/jpeg",
};

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function timingSafeEqualString(a: string, b: string) {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);

  if (aBuffer.length !== bBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(aBuffer, bBuffer);
}

function verifyShopifyWebhook(rawBody: string, hmacHeader: string | null) {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET?.trim();

  if (!secret || secret === "replace_this_later") {
    throw new Error("Missing SHOPIFY_WEBHOOK_SECRET.");
  }

  if (!hmacHeader) {
    throw new Error("Missing Shopify HMAC header.");
  }

  const digest = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("base64");

  if (!timingSafeEqualString(digest, hmacHeader)) {
    throw new Error("Invalid Shopify webhook signature.");
  }
}

function getCustomerName(order: ShopifyOrderPayload) {
  const customerName = [
    order.customer?.first_name,
    order.customer?.last_name,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();

  if (customerName) return customerName;

  if (order.shipping_address?.name) return order.shipping_address.name;
  if (order.billing_address?.name) return order.billing_address.name;

  const shippingName = [
    order.shipping_address?.first_name,
    order.shipping_address?.last_name,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();

  if (shippingName) return shippingName;

  const billingName = [
    order.billing_address?.first_name,
    order.billing_address?.last_name,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();

  if (billingName) return billingName;

  return `Shopify Customer ${order.name || order.id || ""}`.trim();
}

function getCustomerEmail(order: ShopifyOrderPayload) {
  return (
    order.email ||
    order.contact_email ||
    order.customer?.email ||
    "unknown@email.com"
  );
}

function getFileExtensionFromUrl(url: string) {
  const cleanUrl = url.split("?")[0].toLowerCase();
  const fileName = cleanUrl.split("/").pop() || "";
  const parts = fileName.split(".");

  return parts.length > 1 ? parts.pop() || "" : "jpg";
}

function getMimeTypeFromUrl(url: string) {
  const extension = getFileExtensionFromUrl(url);
  return EXTENSION_TO_MIME[extension] || "image/jpeg";
}

function extractUrlsFromText(value: string) {
  const matches = value.match(/https?:\/\/[^\s"'<>]+/g) || [];

  return matches.map((url) =>
    url
      .replace(/&amp;/g, "&")
      .replace(/[),.;]+$/g, "")
      .trim()
  );
}

function extractUrlsDeep(value: unknown): string[] {
  if (!value) return [];

  if (typeof value === "string") {
    const directUrls = extractUrlsFromText(value);

    try {
      const parsed = JSON.parse(value);
      return [...directUrls, ...extractUrlsDeep(parsed)];
    } catch {
      return directUrls;
    }
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => extractUrlsDeep(item));
  }

  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap((item) =>
      extractUrlsDeep(item)
    );
  }

  return [];
}

function extractUploadUrls(order: ShopifyOrderPayload) {
  const urls: string[] = [];

  for (const lineItem of order.line_items || []) {
    for (const property of lineItem.properties || []) {
      urls.push(...extractUrlsDeep(property.value));
    }
  }

  const uniqueUrls = Array.from(new Set(urls));

  return uniqueUrls.filter((url) => {
    const lower = url.toLowerCase();

    const looksLikeImage =
      lower.includes(".jpg") ||
      lower.includes(".jpeg") ||
      lower.includes(".png") ||
      lower.includes(".webp") ||
      lower.includes(".heic") ||
      lower.includes(".heif") ||
      lower.includes(".avif") ||
      lower.includes(".gif") ||
      lower.includes(".bmp") ||
      lower.includes(".tif") ||
      lower.includes(".tiff");

    const looksLikeUploadKit =
      lower.includes("uploadkit") ||
      lower.includes("uploadcare") ||
      lower.includes("cloudfront") ||
      lower.includes("cdn.shopify") ||
      lower.includes("shopify");

    return looksLikeImage || looksLikeUploadKit;
  });
}

function extractPageCount(order: ShopifyOrderPayload) {
  const textParts: string[] = [];

  for (const lineItem of order.line_items || []) {
    if (lineItem.title) textParts.push(lineItem.title);
    if (lineItem.variant_title) textParts.push(lineItem.variant_title);

    for (const property of lineItem.properties || []) {
      if (property.name) textParts.push(property.name);
      if (typeof property.value === "string") textParts.push(property.value);
    }
  }

  const joinedText = textParts.join(" ").toLowerCase();

  const match =
    joinedText.match(/(\d+)\s*pages?/) ||
    joinedText.match(/pages?\s*[:\-]?\s*(\d+)/);

  if (match?.[1]) {
    const parsed = Number(match[1]);

    if ([10, 20, 30, 40].includes(parsed)) {
      return parsed;
    }

    if (parsed > 0 && parsed <= 100) {
      return parsed;
    }
  }

  return 20;
}

async function uploadOriginalImageFromUrl({
  url,
  orderId,
  orderFolder,
  pageNumber,
}: {
  url: string;
  orderId: string;
  orderFolder: string;
  pageNumber: number;
}) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to download uploaded image ${pageNumber}.`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const contentType =
    response.headers.get("content-type") ||
    getMimeTypeFromUrl(url);

  const extension =
    getFileExtensionFromUrl(url) ||
    contentType.split("/")[1] ||
    "jpg";

  const safeExtension = extension.replace(/[^a-z0-9]/gi, "").toLowerCase() || "jpg";

  const originalPath = `${orderFolder}/page-${pageNumber}-original.${safeExtension}`;

  const { error: uploadError } = await supabaseAdmin.storage
    .from("originals")
    .upload(originalPath, buffer, {
      contentType,
      upsert: true,
    });

  if (uploadError) {
    throw new Error(uploadError.message);
  }

  const { data: publicUrlData } = supabaseAdmin.storage
    .from("originals")
    .getPublicUrl(originalPath);

  const originalUrl = publicUrlData.publicUrl;

  const { data: imageRow, error: imageRowError } = await supabaseAdmin
    .from("order_images")
    .insert({
      order_id: orderId,
      original_url: originalUrl,
      original_filename: `shopify-upload-page-${pageNumber}.${safeExtension}`,
      mime_type: contentType,
      page_number: pageNumber,
      status: "uploaded",
    })
    .select("*")
    .single();

  if (imageRowError) {
    throw new Error(imageRowError.message);
  }

  return imageRow;
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    route: "/api/shopify/order-paid",
    message: "Shopify paid-order webhook endpoint is ready. Use POST from Shopify.",
  });
}

export async function POST(request: Request) {
  const rawBody = await request.text();

  try {
    verifyShopifyWebhook(
      rawBody,
      request.headers.get("x-shopify-hmac-sha256")
    );

    const order = JSON.parse(rawBody) as ShopifyOrderPayload;

    if (!order.id) {
      return NextResponse.json(
        { error: "Missing Shopify order ID." },
        { status: 400 }
      );
    }

    const shopifyOrderId = String(order.id);
    const shopifyOrderName = order.name || shopifyOrderId;

    const { data: existingOrder } = await supabaseAdmin
      .from("orders")
      .select("*")
      .eq("shopify_order_id", shopifyOrderId)
      .maybeSingle();

    if (existingOrder) {
      return NextResponse.json({
        ok: true,
        duplicate: true,
        order: existingOrder,
      });
    }

    const customerName = getCustomerName(order);
    const customerEmail = getCustomerEmail(order);
    const pageCount = extractPageCount(order);
    const uploadUrls = extractUploadUrls(order);

    const initialStatus =
      uploadUrls.length > 0 ? "shopify_imported" : "shopify_no_images_found";

    const { data: createdOrder, error: createOrderError } = await supabaseAdmin
      .from("orders")
      .insert({
        customer_name: customerName,
        customer_email: customerEmail,
        page_count: pageCount,
        status: initialStatus,
        pdf_status: "not_exported",
        shopify_order_id: shopifyOrderId,
        shopify_order_name: shopifyOrderName,
        shopify_raw: order,
      })
      .select("*")
      .single();

    if (createOrderError || !createdOrder) {
      return NextResponse.json(
        { error: createOrderError?.message || "Failed to create order." },
        { status: 500 }
      );
    }

    const orderSlug = slugify(customerName || "shopify-order");
    const shortOrderId = createdOrder.id.slice(0, 8);
    const orderFolder = `${orderSlug}-${shortOrderId}`;

    const uploadedImages = [];

    for (let index = 0; index < uploadUrls.length; index++) {
      const imageRow = await uploadOriginalImageFromUrl({
        url: uploadUrls[index],
        orderId: createdOrder.id,
        orderFolder,
        pageNumber: index + 1,
      });

      uploadedImages.push(imageRow);
    }

    return NextResponse.json({
      ok: true,
      order: createdOrder,
      upload_urls_found: uploadUrls.length,
      images_uploaded: uploadedImages.length,
      images: uploadedImages,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Shopify webhook failed.";

    console.error("Shopify webhook failed:", message);

    return NextResponse.json(
      { error: message },
      { status: 401 }
    );
  }
}
