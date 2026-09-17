import { getMixamOffer, getMixamProductMetadata } from "./client";
import type { MixamItemSpecification, MixamOfferResponse, MixamProductMetadata } from "./types";
import type { MixamBookVariant } from "./page-layout";

export type MixamFinalConfiguration = {
  key: MixamBookVariant;
  productId: number;
  subProductId: number;
  productName: string;
  quoteType: "QUOTE";
  bodyPageCount: number;
  productType: "story_book" | "colouring_book";
};

export const MIXAM_FINAL_CONFIGURATIONS: Record<MixamBookVariant, MixamFinalConfiguration> = {
  story_20: { key: "story_20", productId: 1, subProductId: 100002, productName: "Paperback Photo Quality Books", quoteType: "QUOTE", bodyPageCount: 32, productType: "story_book" },
  story_32: { key: "story_32", productId: 1, subProductId: 100002, productName: "Paperback Photo Quality Books", quoteType: "QUOTE", bodyPageCount: 36, productType: "story_book" },
  story_40: { key: "story_40", productId: 1, subProductId: 100002, productName: "Paperback Photo Quality Books", quoteType: "QUOTE", bodyPageCount: 44, productType: "story_book" },
  colouring_20: { key: "colouring_20", productId: 1, subProductId: 100017, productName: "Paperback Colouring Book", quoteType: "QUOTE", bodyPageCount: 44, productType: "colouring_book" },
  colouring_32: { key: "colouring_32", productId: 1, subProductId: 100017, productName: "Paperback Colouring Book", quoteType: "QUOTE", bodyPageCount: 68, productType: "colouring_book" },
  colouring_40: { key: "colouring_40", productId: 1, subProductId: 100017, productName: "Paperback Colouring Book", quoteType: "QUOTE", bodyPageCount: 84, productType: "colouring_book" },
};

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

function getComponent(specification: MixamItemSpecification, type: string) {
  const component = specification.components.find((item) => item.componentType === type);
  if (!component) throw new Error(`Mixam metadata did not provide a ${type} component.`);
  return component;
}

export function buildFinalMixamItemSpecification(configuration: MixamFinalConfiguration, metadata: MixamProductMetadata, coverFallback?: Record<string, unknown>): MixamItemSpecification {
  if (!metadata.initialSpecification) throw new Error("Mixam metadata did not provide initialSpecification.");
  const specification = clone(metadata.initialSpecification);
  const bound = getComponent(specification, "BOUND");
  const sourceCover = metadata.initialSpecification.components.find((item) => item.componentType === "COVER") || coverFallback;
  if (!sourceCover) throw new Error("Mixam metadata did not provide a cover component.");
  const cover = clone(sourceCover) as typeof bound;
  const story = configuration.productType === "story_book";
  Object.assign(bound, {
    format: 4, standardSize: "NONE", orientation: "PORTRAIT", colours: story ? "PROCESS" : "GRAYSCALE",
    substrate: story ? { typeId: 1, weightId: 4, colourId: 0, design: "NONE" } : { typeId: 3, weightId: 104, colourId: 0, design: "NONE" },
    pages: configuration.bodyPageCount, lamination: "NONE",
    binding: { ...(bound.binding || {}), type: "PUR", edge: "LEFT_RIGHT", sewn: false, colour: "BLACK", loops: "TWO_LOOPS", headAndTailBands: "NONE" },
  });
  Object.assign(cover, {
    componentType: "COVER", format: 4, standardSize: "NONE", orientation: "PORTRAIT", colours: "PROCESS",
    substrate: { typeId: 1, weightId: 8, colourId: 0, design: "NONE" }, lamination: "MATT",
    backColours: "NONE", backLamination: "NONE", coverArea: "FRONT_AND_BACK",
  });
  specification.copies = 1;
  specification.components = [bound, cover];
  return specification;
}

export async function resolveFinalMixamConfiguration(key: MixamBookVariant) {
  const configuration = MIXAM_FINAL_CONFIGURATIONS[key];
  const metadata = await getMixamProductMetadata(configuration.productId, configuration.subProductId, configuration.quoteType);
  let coverFallback: Record<string, unknown> | undefined;
  if (configuration.productType === "colouring_book") {
    const storyMetadata = await getMixamProductMetadata(1, 100002, "QUOTE");
    coverFallback = clone(storyMetadata.initialSpecification?.components.find((item) => item.componentType === "COVER") || {}) as Record<string, unknown>;
  }
  const itemSpecification = buildFinalMixamItemSpecification(configuration, metadata, coverFallback);
  const offer = await getMixamOffer({ ...configuration, itemSpecification });
  return { configuration, metadata, itemSpecification, offer } as { configuration: MixamFinalConfiguration; metadata: MixamProductMetadata; itemSpecification: MixamItemSpecification; offer: MixamOfferResponse };
}

export function selectStandardAustralianOffer(offer: MixamOfferResponse) {
  if (!offer.printOnDemandAvailable) throw new Error("Mixam configuration is not available for print on demand.");
  const all = Array.isArray(offer.offers) ? offer.offers : [];
  const australian = all.filter((candidate) => candidate.countryOfOrigin === "AU");
  const standard = australian.filter((candidate) => candidate.express !== true);
  const pool = standard.length ? standard : australian.length ? australian : all;
  const selected = [...pool].sort((left, right) => Number(left.price || Infinity) - Number(right.price || Infinity))[0];
  if (!selected) throw new Error("Mixam did not return an offer for this configuration.");
  return selected;
}

export function getMixamVariantForOrder(order: Record<string, unknown>): MixamBookVariant {
  const kind = order.product_type === "story_book" ? "story" : "colouring";
  const candidates = [order.page_count, order.pages, order.product_title, order.variant_title, order.title];
  let contentPages = 20;
  for (const value of candidates) {
    if (typeof value === "number" && Number.isInteger(value) && [20, 32, 40].includes(value)) { contentPages = value; break; }
    if (typeof value === "string") {
      const match = value.match(/\b(20|32|40)\s*(?:page|pages)\b/i);
      if (match) { contentPages = Number(match[1]); break; }
    }
  }
  const key = `${kind}_${contentPages}` as MixamBookVariant;
  if (!MIXAM_FINAL_CONFIGURATIONS[key]) {
    throw new Error(`MIXAM_CONFIG_RESOLVED: Unsupported Memory Books page variant ${kind}_${contentPages}.`);
  }
  return key;
}
