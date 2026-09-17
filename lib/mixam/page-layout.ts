export type MixamBookVariant =
  | "story_20"
  | "story_32"
  | "story_40"
  | "colouring_20"
  | "colouring_32"
  | "colouring_40";

export type MixamPagePlan = {
  variant: MixamBookVariant;
  contentPages: number;
  requiredBodyPages: number;
  candidateBodyPages: number;
  paddingPages: number;
  rationale: string;
};

const FINAL_BODY_PAGE_COUNTS: Record<MixamBookVariant, number> = {
  story_20: 32,
  story_32: 36,
  story_40: 44,
  colouring_20: 44,
  colouring_32: 68,
  colouring_40: 84,
};

function roundUp(value: number, increment: number) {
  return Math.ceil(value / increment) * increment;
}

/**
 * Mixam receives separate cover and body files. Cover/endpaper surfaces are
 * excluded here because product metadata determines how each binding handles
 * them. This produces only a candidate for metadata validation.
 */
export function getMixamPagePlan(
  variant: MixamBookVariant,
  pagesIncrement = 2,
  minimumPages = 0
): MixamPagePlan {
  if (!Number.isInteger(pagesIncrement) || pagesIncrement < 1) {
    throw new Error("Mixam pagesIncrement must be a positive integer.");
  }

  const match = variant.match(/(story|colouring)_(20|32|40)/);
  if (!match) throw new Error(`Unsupported Mixam variant: ${variant}`);

  const kind = match[1];
  const contentPages = Number(match[2]);
  const requiredBodyPages =
    kind === "colouring"
      ? contentPages * 2 + 2
      : contentPages + 2;
  const candidateBodyPages = Math.max(
    FINAL_BODY_PAGE_COUNTS[variant],
    roundUp(Math.max(requiredBodyPages, minimumPages), pagesIncrement)
  );

  return {
    variant,
    contentPages,
    requiredBodyPages,
    candidateBodyPages,
    paddingPages: candidateBodyPages - requiredBodyPages,
    rationale:
      kind === "colouring"
        ? "Grace plus blank reverse, then every artwork page followed by a blank reverse."
        : "Grace plus blank reverse, followed by double-sided story pages and supplier-required padding.",
  };
}
