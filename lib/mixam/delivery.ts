export type FulfilmentRecipient = {
  firstName: string; lastName: string; company?: string;
  address1: string; address2?: string; city: string;
  state: string; stateCode?: string; postcode: string;
  countryName: string; countryCode: string; email: string; phone: string;
};

export type MixamDeliveryAddress = {
  company?: string;
  firstName: string;
  lastName: string;
  postcode: string;
  line1: string;
  line2?: string;
  town: string;
  county: string;
  country: string;
  phoneNumber: string;
  emailAddress: string;
};

export type ShopifyShippingPreference = {
  title: string | null;
  code: string | null;
  customerPaidShipping: string | null;
  requestedService: "standard" | "express" | "unknown";
};

type RecordLike = Record<string, unknown>;

export class MixamDeliveryValidationError extends Error {
  readonly fields: string[];

  constructor(fields: string[]) {
    super(`Missing required Mixam delivery field${fields.length === 1 ? "" : "s"}: ${fields.join(", ")}.`);
    this.name = "MixamDeliveryValidationError";
    this.fields = fields;
  }
}

function record(value: unknown): RecordLike {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as RecordLike
    : {};
}

function text(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" || typeof value === "number") {
      const candidate = String(value).trim();
      if (candidate) return candidate;
    }
  }
  return "";
}

function splitName(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] || "", lastName: parts.slice(1).join(" ") };
}

function rawShopifyOrder(order: RecordLike) {
  return record(order.shopify_raw);
}

function rawShippingAddress(order: RecordLike) {
  return record(rawShopifyOrder(order).shipping_address);
}

function rawCustomer(order: RecordLike) {
  return record(rawShopifyOrder(order).customer);
}

/**
 * Mixam requires an ISO-3166 alpha-2 country code. Shopify supplies this as
 * shipping_address.country_code; never silently convert a free-form country
 * name for a supplier order.
 */
function countryCode(...values: unknown[]) {
  const value = text(...values).toUpperCase();
  return /^[A-Z]{2}$/.test(value) ? value : "";
}

/**
 * Resolve the recipient from the shipping destination only. Billing data is
 * deliberately excluded: a fulfilment address must never fall back to billing
 * without an explicit operator decision.
 */
export function getFulfilmentRecipient(order: RecordLike): FulfilmentRecipient {
  const rawShipping = rawShippingAddress(order);
  const rawCustomerRecord = rawCustomer(order);
  const shippingName = text(order.shipping_name, rawShipping.name);
  const splitShippingName = splitName(shippingName);
  const recipient: FulfilmentRecipient = {
    company: text(order.shipping_company, rawShipping.company) || undefined,
    firstName: text(order.shipping_first_name, rawShipping.first_name, splitShippingName.firstName),
    lastName: text(order.shipping_last_name, rawShipping.last_name, splitShippingName.lastName),
    address1: text(order.shipping_address1, rawShipping.address1),
    address2: text(order.shipping_address2, rawShipping.address2) || undefined,
    city: text(order.shipping_city, rawShipping.city),
    state: text(order.shipping_province, rawShipping.province, order.shipping_province_code, rawShipping.province_code),
    stateCode: text(order.shipping_province_code, rawShipping.province_code) || undefined,
    postcode: text(order.shipping_zip, rawShipping.zip),
    countryName: text(order.shipping_country, rawShipping.country),
    countryCode: countryCode(order.shipping_country_code, rawShipping.country_code),
    email: text(order.customer_email, order.email, rawShopifyOrder(order).contact_email, rawShopifyOrder(order).email, rawCustomerRecord.email),
    phone: text(order.shipping_phone, rawShipping.phone, order.phone, rawShopifyOrder(order).phone, rawCustomerRecord.phone),
  };
  const required: Array<[keyof FulfilmentRecipient, string]> = [
    ["firstName", "recipient first name"],
    ["lastName", "recipient last name"],
    ["address1", "shipping address line 1"],
    ["city", "shipping city/suburb"],
    ["state", "shipping state/province"],
    ["postcode", "shipping postcode"],
    ["countryCode", "ISO-2 shipping country code"],
    ["email", "recipient email"],
    ["phone", "recipient phone"],
  ];
  const missing = required.filter(([key]) => !recipient[key]).map(([, label]) => label);
  if (missing.length) throw new MixamDeliveryValidationError(missing);
  return recipient;
}

export function toMixamDeliveryAddress(recipient: FulfilmentRecipient): MixamDeliveryAddress {
  return { company: recipient.company, firstName: recipient.firstName, lastName: recipient.lastName, postcode: recipient.postcode, line1: recipient.address1, line2: recipient.address2, town: recipient.city, county: recipient.stateCode || recipient.state, country: recipient.countryCode, phoneNumber: recipient.phone, emailAddress: recipient.email };
}

export function getMixamDeliveryAddress(order: RecordLike): MixamDeliveryAddress {
  return toMixamDeliveryAddress(getFulfilmentRecipient(order));
}

/**
 * Records the customer's Shopify shipping choice without assuming it maps to
 * a Mixam service ID. Mixam rates are discovered only after its order/delivery
 * group exists, so a future selector must choose from that returned list.
 */
export function getShopifyShippingPreference(order: RecordLike): ShopifyShippingPreference {
  const raw = rawShopifyOrder(order);
  const lines = Array.isArray(raw.shipping_lines) ? raw.shipping_lines : [];
  const line = record(lines[0]);
  const title = text(line.title) || null;
  const code = text(line.code) || null;
  const totalShipping = record(record(raw.total_shipping_price_set).shop_money).amount;
  const requested = `${title || ""} ${code || ""}`.toLowerCase();
  return {
    title,
    code,
    customerPaidShipping: text(order.shipping_price, line.price, totalShipping) || null,
    requestedService: /express|expedited|priority|fast/.test(requested) ? "express" : title || code ? "standard" : "unknown",
  };
}
