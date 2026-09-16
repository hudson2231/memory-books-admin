export const STORY_GELATO_MIN_PRINTABLE_PAGE_COUNT = 28;

function assertPositiveInteger(value: number, label: string) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
}

export function makeEvenPageCount(value: number) {
  return value % 2 === 0 ? value : value + 1;
}

export function getColouringBookPagePlan(artworkPages: number) {
  assertPositiveInteger(artworkPages, "Colouring artwork page count");

  // Physical product sides:
  // outer covers (2)
  // inside-cover endpapers (2)
  // grace + blank reverse (2)
  // artwork pages + blank reverses (artworkPages * 2)
  const productPageCount = artworkPages * 2 + 6;

  // The exterior front and back covers are combined into one PDF spread,
  // so the uploaded file has one fewer page than the physical product count.
  return {
    artworkPages,
    productPageCount,
    filePageCount: productPageCount - 1,
  };
}

export function getStoryBookPagePlan(storyPages: number) {
  assertPositiveInteger(storyPages, "Story page count");

  // Gelato's Story Book pageCount is the number of printable interior pages.
  // Reserve two of those pages for grace + its blank reverse, then pad to an
  // even page count and the product minimum.
  const requiredPrintablePages = storyPages + 2;
  const productPageCount = Math.max(
    STORY_GELATO_MIN_PRINTABLE_PAGE_COUNT,
    makeEvenPageCount(requiredPrintablePages)
  );

  // PDF = exterior cover spread + front endpaper + printable interiors
  // + back endpaper.
  return {
    storyPages,
    productPageCount,
    printablePageCount: productPageCount,
    paddingPageCount: productPageCount - requiredPrintablePages,
    filePageCount: productPageCount + 3,
  };
}
