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
    // Colouring Book PDF structure:
    // front cover + grace page + each artwork page + blank back for each artwork + back cover
    // Example: 20 artwork pages = 1 + 1 + 20 + 20 + 1 = 43 pages.
    return artworkPages * 2 + 3;
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

function normaliseCountryCode(country: unknown) {
  const value = String(country || "").trim();

  const countryMap: Record<string, string> = {
    australia: "AU",
    au: "AU",
    "united states": "US",
    usa: "US",
    us: "US",
    "united kingdom": "GB",
    uk: "GB",
    gb: "GB",
    canada: "CA",
    ca: "CA",
    "new zealand": "NZ",
    nz: "NZ",
  };

  return countryMap[value.toLowerCase()] || value;
}

function normaliseRegionForGelato(country: unknown, region: unknown) {
  const countryCode = normaliseCountryCode(country);
  const value = String(region || "").trim();

  if (!value) return "";

  const upper = value.toUpperCase();

  if (countryCode === "AU") {
    const auStates: Record<string, string> = {
      "AUSTRALIAN CAPITAL TERRITORY": "ACT",
      ACT: "ACT",
      "NEW SOUTH WALES": "NSW",
      NSW: "NSW",
      "NORTHERN TERRITORY": "NT",
      NT: "NT",
      QUEENSLAND: "QLD",
      QLD: "QLD",
      "SOUTH AUSTRALIA": "SA",
      SA: "SA",
      TASMANIA: "TAS",
      TAS: "TAS",
      VICTORIA: "VIC",
      VIC: "VIC",
      "WESTERN AUSTRALIA": "WA",
      WA: "WA",
    };

    return auStates[upper] || value;
  }

  if (countryCode === "US") {
    const usStates: Record<string, string> = {
      ALABAMA: "AL",
      ALASKA: "AK",
      ARIZONA: "AZ",
      ARKANSAS: "AR",
      CALIFORNIA: "CA",
      COLORADO: "CO",
      CONNECTICUT: "CT",
      DELAWARE: "DE",
      FLORIDA: "FL",
      GEORGIA: "GA",
      HAWAII: "HI",
      IDAHO: "ID",
      ILLINOIS: "IL",
      INDIANA: "IN",
      IOWA: "IA",
      KANSAS: "KS",
      KENTUCKY: "KY",
      LOUISIANA: "LA",
      MAINE: "ME",
      MARYLAND: "MD",
      MASSACHUSETTS: "MA",
      MICHIGAN: "MI",
      MINNESOTA: "MN",
      MISSISSIPPI: "MS",
      MISSOURI: "MO",
      MONTANA: "MT",
      NEBRASKA: "NE",
      NEVADA: "NV",
      "NEW HAMPSHIRE": "NH",
      "NEW JERSEY": "NJ",
      "NEW MEXICO": "NM",
      "NEW YORK": "NY",
      "NORTH CAROLINA": "NC",
      "NORTH DAKOTA": "ND",
      OHIO: "OH",
      OKLAHOMA: "OK",
      OREGON: "OR",
      PENNSYLVANIA: "PA",
      "RHODE ISLAND": "RI",
      "SOUTH CAROLINA": "SC",
      "SOUTH DAKOTA": "SD",
      TENNESSEE: "TN",
      TEXAS: "TX",
      UTAH: "UT",
      VERMONT: "VT",
      VIRGINIA: "VA",
      WASHINGTON: "WA",
      "WEST VIRGINIA": "WV",
      WISCONSIN: "WI",
      WYOMING: "WY",
    };

    return usStates[upper] || upper;
  }

  if (countryCode === "CA") {
    const caProvinces: Record<string, string> = {
      ALBERTA: "AB",
      "BRITISH COLUMBIA": "BC",
      MANITOBA: "MB",
      "NEW BRUNSWICK": "NB",
      NEWFOUNDLAND: "NL",
      "NEWFOUNDLAND AND LABRADOR": "NL",
      "NORTHWEST TERRITORIES": "NT",
      "NOVA SCOTIA": "NS",
      NUNAVUT: "NU",
      ONTARIO: "ON",
      "PRINCE EDWARD ISLAND": "PE",
      QUEBEC: "QC",
      SASKATCHEWAN: "SK",
      YUKON: "YT",
    };

    return caProvinces[upper] || upper;
  }

  return value;
}

export function getShippingAddress(order: Record<string, any>) {
  const name = splitName(order.shipping_name || order.customer_name);

  const rawCountry =
    order.shipping_country_code ||
    order.country_code ||
    order.shipping_country ||
    order.country;

  const country = normaliseCountryCode(rawCountry);

  const addressLine1 = order.shipping_address1 || order.address1;
  const city = order.shipping_city || order.city;
  const postCode = order.shipping_zip || order.zip || order.postcode;

  const rawState =
    order.shipping_province_code ||
    order.province_code ||
    order.shipping_province ||
    order.province ||
    "";

  const state = normaliseRegionForGelato(country, rawState);

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
    state,
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
