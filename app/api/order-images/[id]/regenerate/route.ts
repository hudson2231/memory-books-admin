import { NextResponse } from "next/server";
import {
  generateColoringWithFal,
  generateStorybookWithGemini,
  getAspectRatioForImage,
  getMimeTypeFromUrl,
  getProductType,
  getPromptForOrder,
  getPromptVersionForOrder,
  slugify,
  uploadGeneratedBuffer,
} from "../../../../../lib/image-generation";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";

const MAX_REGENERATION_INSTRUCTION_LENGTH = 800;

function buildColouringRegenerationBooster(instruction: string | null) {
  const normalized = (instruction || "").toLowerCase();

  const rules: string[] = [
    "- Preserve all successful facial identity, expressions, pose, composition, perspective, clothing silhouette, and overall scene layout unless the correction explicitly requires a change.",
    "- Apply the correction strongly and visibly for this regeneration attempt.",
    "- Do not make the page worse in unrelated areas while fixing the requested defect.",
    "- Rebuild weak areas cleanly instead of tracing or patching them in a messy way.",
    "- Keep the result premium, clean, bold, colourable, and print-ready.",
    "- Use confident black ink lines, stronger outer contours, and clean white colourable spaces.",
    "- Do not use large solid black filled regions in hair, clothing, skin, furniture, objects, or background areas.",
    "- Tiny controlled black accents are allowed only where genuinely useful, such as pupils, eyelashes, nostrils, eyebrow mass, and very small moustache or beard accents.",
  ];

  if (/(hair|filled|fill|black|dark|shadow)/.test(normalized)) {
    rules.push(
      "- Replace any filled black hair, clothing, or shadow blocks with clean outer contours and interior detail lines, leaving most of the area white and colourable."
    );
  }

  if (/(background|clutter|busy|messy|wall|ceiling|room|plane|cabin|table|seat|window|interior)/.test(normalized)) {
    rules.push(
      "- Simplify background clutter while preserving key scene-defining structures and objects as clean outline shapes that support the people."
    );
  }

  if (/(hand|hands|finger|fingers|arm|arms|anatomy|body|limb)/.test(normalized)) {
    rules.push(
      "- Correct anatomy issues, especially hands, fingers, arms, and overlapping body shapes, so they read clearly and naturally."
    );
  }

  if (/(face|eyes|nose|mouth|likeness|expression)/.test(normalized)) {
    rules.push(
      "- Preserve the face likeness extremely closely and do not stylise, age, beautify, or distort the expressions."
    );
  }

  return rules.join("\n");
}

function buildStoryBookRegenerationBooster(instruction: string | null) {
  const normalized = (instruction || "").toLowerCase();

  const rules: string[] = [
    "- Preserve the strongest existing facial likeness, expressions, pose, clothing silhouette, composition, and setting identity.",
    "- Apply the correction strongly and visibly for this single story-book page.",
    "- Keep the page as a polished modern clip-art / storybook illustration.",
    "- Do not turn the page into colouring-book line art.",
    "- Do not render caption text inside the image.",
    "- Do not make the page worse in unrelated areas while fixing the requested defect.",
  ];

  if (/(background|setting|clutter|busy|messy|place|scene)/.test(normalized)) {
    rules.push(
      "- Preserve the meaningful setting anchors while simplifying visual clutter into clean storybook shapes."
    );
  }

  if (/(face|eyes|nose|mouth|likeness|expression)/.test(normalized)) {
    rules.push(
      "- Preserve the existing face likeness extremely closely and do not stylise, age, beautify, or distort the expressions."
    );
  }

  return rules.join("\n");
}

function buildRegenerationPrompt(
  order: Record<string, any>,
  image: Record<string, any>,
  instruction: string | null
) {
  const isStoryBook = getProductType(order) === "story_book";
  const basePrompt = getPromptForOrder(order, image);

  if (!instruction) {
    return `${basePrompt}

REGENERATION MODE:
You are revising a previously generated ${isStoryBook ? "story-book illustration" : "colouring-book page"}.
Use the original customer photo as the ground truth.
Use the previous generated page only as a continuity reference for what already works.

NON-NEGOTIABLE REGENERATION RULES:
- Preserve the strongest existing facial likeness, expressions, composition, and pose.
- Fix weak areas cleanly without degrading successful areas.
- Keep the page premium, finished, and print-ready.
${isStoryBook ? "- Keep the result as a clean modern clip-art / storybook illustration. Do not draw the caption text inside the image." : "- Use stronger commercial colouring-book ink lines. Avoid large solid black filled areas. Keep the page clean and colourable."}

Return one complete finished page only.`;
  }

  const booster = isStoryBook
    ? buildStoryBookRegenerationBooster(instruction)
    : buildColouringRegenerationBooster(instruction);

  return `${basePrompt}

REGENERATION MODE:
You are revising a previously generated ${isStoryBook ? "story-book illustration" : "colouring-book page"}.
Use the original customer photo as the ground truth.
Use the previous generated page only as a continuity reference for what already works.

NON-NEGOTIABLE REGENERATION RULES:
${booster}

SCOPED FIX REQUEST:
${instruction}

EXECUTION INSTRUCTIONS:
- Apply the requested fix strongly and visibly.
- Do not leave the defect partially fixed.
- Preserve all successful areas unless they must be adjusted to complete the fix.
- If the user request is short or vague, infer the most direct correction and apply it decisively.
- Return one complete finished page only.`;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: imageId } = await context.params;

  let regenerationInstruction: string | null = null;

  try {
    const body = await request.json();
    const rawInstruction =
      typeof body?.instruction === "string" ? body.instruction.trim() : "";

    if (rawInstruction.length > MAX_REGENERATION_INSTRUCTION_LENGTH) {
      return NextResponse.json(
        {
          error: `Regeneration instruction must be ${MAX_REGENERATION_INSTRUCTION_LENGTH} characters or fewer.`,
        },
        { status: 400 }
      );
    }

    regenerationInstruction = rawInstruction || null;
  } catch {
    regenerationInstruction = null;
  }

  const { data: image, error: imageError } = await supabaseAdmin
    .from("order_images")
    .select("*")
    .eq("id", imageId)
    .single();

  if (imageError || !image) {
    return NextResponse.json({ error: "Image row not found." }, { status: 404 });
  }

  const { data: order, error: orderError } = await supabaseAdmin
    .from("orders")
    .select("*")
    .eq("id", image.order_id)
    .single();

  if (orderError || !order) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  const productType = getProductType(order);

  if (productType === "story_book" && !process.env.GEMINI_API_KEY?.trim()) {
    return NextResponse.json(
      { error: "Missing GEMINI_API_KEY." },
      { status: 500 }
    );
  }

  if (productType === "colouring_book" && !process.env.FAL_KEY?.trim()) {
    return NextResponse.json(
      { error: "Missing FAL_KEY." },
      { status: 500 }
    );
  }

  try {
    await supabaseAdmin
      .from("order_images")
      .update({
        status: "generating",
        error_message: null,
      })
      .eq("id", image.id);

    const promptText = buildRegenerationPrompt(
      order,
      image,
      regenerationInstruction
    );
    const promptVersion = getPromptVersionForOrder(order);

    const generated =
      productType === "story_book"
        ? await generateStorybookWithGemini({
            promptText,
            originalUrl: image.original_url,
            mimeType: image.mime_type || getMimeTypeFromUrl(image.original_url),
            previousGeneratedUrl: image.generated_url || null,
          })
        : await generateColoringWithFal({
            promptText,
            originalUrl: image.original_url,
            previousGeneratedUrl: image.generated_url || null,
            aspectRatio: getAspectRatioForImage(image),
          });

    const orderSlug = slugify(order.customer_name || "order");
    const shortOrderId = order.id.slice(0, 8);
    const orderFolder = `${orderSlug}-${shortOrderId}`;

    const generatedUrl = await uploadGeneratedBuffer({
      buffer: generated.buffer,
      contentType: generated.contentType,
      orderFolder,
      pageNumber: image.page_number,
      suffix: `${Date.now()}`,
    });

    const existingHistory = Array.isArray(image.regeneration_history)
      ? image.regeneration_history
      : [];

    const regenerationHistory = regenerationInstruction
      ? [
          ...existingHistory,
          {
            instruction: regenerationInstruction,
            created_at: new Date().toISOString(),
            previous_generated_url: image.generated_url || null,
            new_generated_url: generatedUrl,
            model: generated.modelUsed,
            prompt_version: promptVersion,
          },
        ]
      : existingHistory;

    const { data: updatedImage, error: updateError } = await supabaseAdmin
      .from("order_images")
      .update({
        generated_url: generatedUrl,
        status: "generated",
        approved: false,
        error_message: null,
        model_used: generated.modelUsed,
        prompt_version: promptVersion,
        generated_at: new Date().toISOString(),
        last_regeneration_instruction: regenerationInstruction,
        regeneration_history: regenerationHistory,
      })
      .eq("id", image.id)
      .select("*")
      .single();

    if (updateError) throw new Error(updateError.message);

    await supabaseAdmin
      .from("orders")
      .update({
        status: "needs_review",
        pdf_status: "not_exported",
      })
      .eq("id", order.id);

    return NextResponse.json({
      image: updatedImage,
      provider: productType === "story_book" ? "gemini" : "fal",
      model: generated.modelUsed,
      regeneration_instruction: regenerationInstruction,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown generation error.";

    await supabaseAdmin
      .from("order_images")
      .update({
        status: "failed",
        error_message: message,
      })
      .eq("id", image.id);

    await supabaseAdmin
      .from("orders")
      .update({
        status: "generation_failed",
      })
      .eq("id", order.id);

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
