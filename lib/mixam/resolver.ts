import { getMixamPagePlan, type MixamBookVariant } from "./page-layout";
import type { MixamItemSpecification, MixamProductMetadata } from "./types";

export type MixamTarget = {
  variant: MixamBookVariant;
  productType: "story_book" | "colouring_book";
  interiorColours: "PROCESS" | "GRAYSCALE";
  preferredWidthMm: number;
  preferredHeightMm: number;
  fallbackWidthMm?: number;
  fallbackHeightMm?: number;
  interiorStockTerms: string[];
  interiorGsm: number;
  coverGsm: number;
  preferredBindings: string[];
  coverLamination: "MATT";
};

const story = (variant: MixamBookVariant): MixamTarget => ({ variant, productType: "story_book", interiorColours: "PROCESS", preferredWidthMm: 210, preferredHeightMm: 297, fallbackWidthMm: 210, fallbackHeightMm: 297, interiorStockTerms: ["silk", "coated"], interiorGsm: 150, coverGsm: 300, preferredBindings: ["PUR", "PERFECT"], coverLamination: "MATT" });
const colouring = (variant: MixamBookVariant): MixamTarget => ({ variant, productType: "colouring_book", interiorColours: "GRAYSCALE", preferredWidthMm: 210, preferredHeightMm: 297, interiorStockTerms: ["uncoated"], interiorGsm: 150, coverGsm: 300, preferredBindings: ["PUR", "PERFECT"], coverLamination: "MATT" });

export const MIXAM_TARGETS: Record<MixamBookVariant, MixamTarget> = {
  story_20: story("story_20"), story_32: story("story_32"), story_40: story("story_40"),
  colouring_20: colouring("colouring_20"), colouring_32: colouring("colouring_32"), colouring_40: colouring("colouring_40"),
};

function text(value: unknown) { return String(value ?? "").toLowerCase(); }
function pathOptions(metadata: MixamProductMetadata, path: string) {
  return path.split(".").reduce<unknown>((value, key) => value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined, metadata) as Array<Record<string, unknown>> | undefined;
}

export type MixamResolution = {
  target: MixamTarget;
  compatible: boolean;
  candidateBodyPages: number;
  diagnostics: string[];
  initialSpecification?: MixamItemSpecification;
};

/** Validates only evidence returned by Mixam metadata; it never invents enum IDs. */
export function inspectMixamMetadata(target: MixamTarget, metadata: MixamProductMetadata): MixamResolution {
  const diagnostics: string[] = [];
  const pageIncrement = Number(metadata.boundMetadata?.pagesIncrement || 0) || 2;
  const pagePlan = getMixamPagePlan(target.variant, pageIncrement);
  const sizes = metadata.standardSizes || [];
  const hasPreferred = sizes.some((size) => Number(size.width) === target.preferredWidthMm && Number(size.height) === target.preferredHeightMm);
  const hasFallback = Boolean(target.fallbackWidthMm && target.fallbackHeightMm && sizes.some((size) => Number(size.width) === target.fallbackWidthMm && Number(size.height) === target.fallbackHeightMm));
  if (!hasPreferred && !hasFallback) diagnostics.push("No preferred or fallback trim size exposed.");
  if (!hasPreferred && hasFallback) diagnostics.push("Preferred trim unavailable; fallback trim is available.");
  const colours = pathOptions(metadata, "coloursMetadata.coloursOptions") || [];
  if (!colours.some((option) => text(option.colours) === target.interiorColours.toLowerCase())) diagnostics.push(`Interior ${target.interiorColours} is unavailable.`);
  const innerCover = pathOptions(metadata, "coloursMetadata.innerCoverColoursOptions") || [];
  if (!innerCover.some((option) => text(option.colours) === "none")) diagnostics.push("No-inner-cover-printing option is unavailable.");
  const bindings = pathOptions(metadata, "boundMetadata.bindingTypeOptions") || [];
  if (!bindings.some((binding) => target.preferredBindings.some((expected) => text(binding.bindingType).includes(expected.toLowerCase()) || text(binding.label).includes(expected.toLowerCase())))) diagnostics.push(`No requested binding exposed: ${target.preferredBindings.join(" or ")}.`);
  const laminations = pathOptions(metadata, "laminationMetadata.coverOptions") || [];
  if (!laminations.some((option) => text(option.lamination) === "matt" || text(option.label).includes("matt"))) diagnostics.push("Matt cover lamination is unavailable.");
  const substrateText = JSON.stringify(metadata.substrateTypes || []).toLowerCase();
  if (!target.interiorStockTerms.some((term) => substrateText.includes(term))) diagnostics.push(`Interior stock does not advertise ${target.interiorStockTerms.join("/")}.`);
  if (!text(metadata.substrateWeights).includes(String(target.interiorGsm))) diagnostics.push(`Interior ${target.interiorGsm}gsm is unavailable.`);
  if (!text(metadata.substrateWeights).includes(String(target.coverGsm))) diagnostics.push(`Cover ${target.coverGsm}gsm is unavailable or requires separate cover metadata review.`);
  if (!metadata.initialSpecification) diagnostics.push("Mixam returned no initialSpecification to safely derive an item specification.");
  return { target, compatible: diagnostics.length === 0, candidateBodyPages: pagePlan.candidateBodyPages, diagnostics, initialSpecification: metadata.initialSpecification };
}
