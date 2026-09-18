export type MemoryBooksProductType = "story_book" | "colouring_book";

export type ShopifyBookPlan = {
  lineItem: Record<string, unknown>;
  lineItemId: string;
  productType: MemoryBooksProductType;
  pageCount: 20 | 32 | 40;
  quantity: number;
  productTitle: string | null;
  variantTitle: string | null;
  customizationId: string | null;
  uploadUrls: string[];
  captionsByPage: Record<number, string>;
  graceRecipient: string | null;
  graceFrom: string | null;
  graceMessage: string | null;
};

function text(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

export function lineItemProperties(lineItem: Record<string, unknown>) {
  const properties = lineItem.properties;
  const entries: Array<{ name: string; value: string }> = [];
  if (Array.isArray(properties)) {
    for (const property of properties) {
      const record = property && typeof property === "object" ? property as Record<string, unknown> : {};
      const name = text(record.name);
      const value = text(record.value);
      if (name && value) entries.push({ name, value });
    }
  } else if (properties && typeof properties === "object") {
    for (const [name, value] of Object.entries(properties as Record<string, unknown>)) {
      const normalizedName = text(name);
      const normalizedValue = text(value);
      if (normalizedName && normalizedValue) entries.push({ name: normalizedName, value: normalizedValue });
    }
  }
  return entries;
}

function urlsFromText(value: string) {
  const matches = value.replace(/&amp;/g, "&").match(/https?:\/\/[^\s"'<>]+/g) || [];
  return matches.map((url) => url.replace(/[),.;]+$/g, ""));
}

function isUploadUrl(url: string) {
  const lower = url.toLowerCase();
  return lower.includes("uploadkit") ||
    lower.includes("cdn.shopify") ||
    lower.includes("supabase.co/storage") ||
    lower.includes("/storage/v1/object/public/originals/") ||
    lower.includes("image=true") ||
    lower.includes("download.html");
}

function collectUrls(value: unknown, output: Set<string>) {
  if (value === null || value === undefined) return;
  if (typeof value === "string") {
    for (const url of urlsFromText(value)) if (isUploadUrl(url)) output.add(url);
    try { collectUrls(JSON.parse(value), output); } catch { /* ordinary text */ }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectUrls(item, output);
    return;
  }
  if (typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) collectUrls(child, output);
  }
}

function productType(lineItem: Record<string, unknown>): MemoryBooksProductType | null {
  const combined = [lineItem.variant_title, lineItem.title, lineItem.name, lineItem.product_type].map(text).join(" ").toLowerCase();
  if (/story\s*book|storybook|story-book|clip\s*art|caption/.test(combined)) return "story_book";
  if (/colou?ring\s*book|colou?ring/.test(combined)) return "colouring_book";
  return null;
}

function pageCount(lineItem: Record<string, unknown>): 20 | 32 | 40 | null {
  const combined = [lineItem.variant_title, lineItem.title, lineItem.name].map(text).join(" ");
  const match = combined.match(/\b(20|32|40)\s*pages?\b/i);
  return match ? Number(match[1]) as 20 | 32 | 40 : null;
}

function normalizeCaption(value: string) {
  const result = value.replace(/\s+/g, " ").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim().slice(0, 180);
  return result || null;
}

function captions(entries: Array<{ name: string; value: string }>, count: number) {
  const output: Record<number, string> = {};
  for (const entry of entries) {
    const match = entry.name.toLowerCase().match(/(?:caption|page)[#\s_-]*(\d+)/i);
    const caption = normalizeCaption(entry.value);
    const page = match ? Number(match[1]) : 0;
    if (caption && page >= 1 && page <= count) output[page] = caption;
  }
  return output;
}

function grace(entries: Array<{ name: string; value: string }>) {
  let graceRecipient: string | null = null;
  let graceFrom: string | null = null;
  let graceMessage: string | null = null;
  for (const entry of entries) {
    const key = entry.name.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
    if (/upload|image|photo|caption|page\s*\d+/.test(key)) continue;
    const value = entry.value.replace(/\s+/g, " ").trim();
    if (!value) continue;
    if (!graceRecipient && /^(to|for|recipient|gift recipient|gift to|who is this for)$/.test(key)) graceRecipient = value.slice(0, 80);
    else if (!graceFrom && /^(from|sender|gift from|made by|from name|your name|who is this from)$/.test(key)) graceFrom = value.slice(0, 80);
    else if (!graceMessage && /^(message|gift message|personal message|personalised message|personalized message|note|optional message|short message|dedication)$/.test(key)) graceMessage = value.slice(0, 240);
  }
  return { graceRecipient, graceFrom, graceMessage };
}

function customizationId(entries: Array<{ name: string; value: string }>) {
  const values = new Set<string>();
  for (const entry of entries) {
    const key = entry.name.toLowerCase().replace(/[_\s-]+/g, "");
    if (["uploadbatchid", "uploadbatch", "customizationid", "customisationid", "memorybookscustomizationid", "memorybooksuploadbatchid"].includes(key)) values.add(entry.value);
  }
  if (values.size > 1) throw new Error("SHOPIFY_CUSTOMIZATION_AMBIGUOUS: one line item has multiple customization identities.");
  return Array.from(values)[0] || null;
}

export function buildMemoryBooksLineItemPlans(order: Record<string, unknown>) {
  const rawItems = Array.isArray(order.line_items) ? order.line_items : [];
  const plans: ShopifyBookPlan[] = [];
  const skipped: Array<{ lineItemId: string | null; reason: string }> = [];
  for (const rawItem of rawItems) {
    const lineItem = rawItem && typeof rawItem === "object" ? rawItem as Record<string, unknown> : {};
    const type = productType(lineItem);
    if (!type) continue;
    const lineItemId = text(lineItem.id);
    const count = pageCount(lineItem);
    const quantity = Number(lineItem.quantity || 1);
    if (!lineItemId) { skipped.push({ lineItemId: null, reason: "Memory Books line item has no Shopify line-item ID." }); continue; }
    if (!count) { skipped.push({ lineItemId, reason: "Memory Books line item has no supported 20/32/40-page variant." }); continue; }
    if (!Number.isInteger(quantity) || quantity < 1) { skipped.push({ lineItemId, reason: "Memory Books line item has invalid quantity." }); continue; }
    const entries = lineItemProperties(lineItem);
    const urls = new Set<string>();
    collectUrls(lineItem.properties, urls);
    const identity = customizationId(entries);
    const graceFields = grace(entries);
    plans.push({
      lineItem, lineItemId, productType: type, pageCount: count, quantity,
      productTitle: text(lineItem.title) || text(lineItem.name) || null,
      variantTitle: text(lineItem.variant_title) || null,
      customizationId: identity,
      uploadUrls: Array.from(urls),
      captionsByPage: captions(entries, count),
      ...graceFields,
    });
  }
  const customizationCounts = new Map<string, number>();
  for (const plan of plans) if (plan.customizationId) customizationCounts.set(plan.customizationId, (customizationCounts.get(plan.customizationId) || 0) + 1);
  const duplicateCustomizationIds = new Set(Array.from(customizationCounts).filter(([, count]) => count > 1).map(([id]) => id));
  for (const plan of plans) {
    if (plan.customizationId && duplicateCustomizationIds.has(plan.customizationId)) skipped.push({ lineItemId: plan.lineItemId, reason: "Customization identity is reused by multiple Memory Books line items; resolve in Shopify before import." });
  }
  const invalidLineIds = new Set(skipped.map((item) => item.lineItemId).filter((id): id is string => Boolean(id)));
  return { plans: plans.filter((plan) => !invalidLineIds.has(plan.lineItemId)), skipped };
}
