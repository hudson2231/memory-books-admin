export const GELATO_QUOTE_URL = "https://order.gelatoapis.com/v3/orders:quote";
export const GELATO_CREATE_ORDER_URL = "https://order.gelatoapis.com/v4/orders";

export function getGelatoApiKey() {
  const apiKey = process.env.GELATO_API_KEY;

  if (!apiKey) {
    throw new Error("GELATO_API_KEY is not set.");
  }

  return apiKey;
}

export function getColouringBookProductUid() {
  const productUid = process.env.GELATO_COLOURING_BOOK_PRODUCT_UID;

  if (!productUid) {
    throw new Error("GELATO_COLOURING_BOOK_PRODUCT_UID is not set.");
  }

  return productUid;
}

export function getStoryBookProductUid() {
  return process.env.GELATO_STORY_BOOK_PRODUCT_UID || "";
}

export function getProductType(order: Record<string, any>) {
  return order.product_type === "story_book" ? "story_book" : "colouring_book";
}

export function getExpectedArtworkPages(order: Record<string, any>, fallback = 20) {
  const candidates = [
    order.page_count,
    order.pages,
    order.product_title,
    order.variant_title,
    order.title,
  ];

  for (const value of candidates) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return value;
    }

    if (typeof value === "string") {
      const match = value.match(/(\d+)\s*(page|pages)/i);
      if (match?.[1]) return Number(match[1]);
    }
  }

  return fallback;
}

export function getGelatoPageCountForOrder(order: Record<string, any>) {
  const productType = getProductType(order);
  const artworkPages = getExpectedArtworkPages(order, 20);

  if (productType === "colouring_book") {
    return artworkPages * 2 + 2;
  }

  // Story Book currently uses:
  // front cover + grace page + story artwork pages + possible blank + back cover.
  // We are not sending Story Books to Gelato yet unless its product UID is confirmed.
  return null;
}

export function getGelatoProductUidForOrder(order: Record<string, any>) {
  const productType = getProductType(order);

  if (productType === "colouring_book") {
    return getColouringBookProductUid();
  }

  const storyUid = getStoryBookProductUid();

  if (!storyUid) {
    throw new Error("Story Book Gelato product UID is not configured yet.");
  }

  return storyUid;
}

export function splitName(fullName: unknown) {
  const clean = typeof fullName === "string" ? fullName.trim() : "";

  if (!clean) {
    return {
      firstName: "Customer",
      lastName: "",
    };
  }

  const parts = clean.split(/\s+/);

  return {
    firstName: parts[0] || "Customer",
    lastName: parts.slice(1).join(" "),
  };
}

export function getCurrency(order: Record<string, any>) {
  return (
    order.currency ||
    order.presentment_currency ||
    order.shopify_currency ||
    "AUD"
  );
}

export function getShippingAddress(order: Record<string, any>) {
  const name = splitName(order.shipping_name || order.customer_name);

  const country =
    order.shipping_country_code ||
    order.shipping_country ||
    order.country_code ||
    order.country;

  const addressLine1 = order.shipping_address1 || order.address1;
  const city = order.shipping_city || order.city;
  const postCode = order.shipping_zip || order.zip || order.postcode;

  if (!country || !addressLine1 || !city || !postCode) {
    throw new Error(
      "Missing shipping address. Required: country, addressLine1, city, postCode."
    );
  }

  return {
    firstName: name.firstName,
    lastName: name.lastName,
    companyName: order.shipping_company || "",
    addressLine1,
    addressLine2: order.shipping_address2 || "",
    state: order.shipping_province || order.province || "",
    city,
    postCode,
    country,
    email: order.customer_email || order.email || "",
    phone: order.shipping_phone || order.phone || "",
  };
}

export async function callGelatoApi(url: string, payload: Record<string, any>) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": getGelatoApiKey(),
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();

  let json: any = null;

  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }

  if (!response.ok) {
    throw new Error(
      `Gelato API failed. HTTP ${response.status}. ${JSON.stringify(json)}`
    );
  }

  return json;
}

export function pickBestShipmentMethod(quoteResponse: any) {
  const quote = quoteResponse?.quotes?.[0];

  if (!quote) {
    throw new Error(`Gelato quote returned no quotes. ${JSON.stringify(quoteResponse)}`);
  }

  const shipmentMethods = Array.isArray(quote.shipmentMethods)
    ? quote.shipmentMethods
    : [];

  if (shipmentMethods.length === 0) {
    throw new Error(`Gelato quote returned no shipment methods. ${JSON.stringify(quoteResponse)}`);
  }

  const normalMethods = shipmentMethods.filter((method: any) =>
    ["normal", "standard"].includes(String(method.type || "").toLowerCase())
  );

  const candidates = normalMethods.length > 0 ? normalMethods : shipmentMethods;

  const sorted = [...candidates].sort((a: any, b: any) => {
    const aPrice = Number(a.price ?? Number.MAX_SAFE_INTEGER);
    const bPrice = Number(b.price ?? Number.MAX_SAFE_INTEGER);
    return aPrice - bPrice;
  });

  return sorted[0];
}
