import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";

const GEMINI_IMAGE_MODEL = "gemini-3-pro-image";
const MEMORY_BOOKS_PROMPT_VERSION = "premium_people_first_v1";
const MAX_REGENERATION_INSTRUCTION_LENGTH = 800;

const MEMORY_BOOKS_PROMPT = `
Create a finished, premium, printable adult colouring-book page from the uploaded customer photo.

This is for a personalised colouring-book product. The result must feel like a polished commercial colouring-book illustration, not a filter, not a faint trace, not a rough sketch, and not a children's cartoon.

ABSOLUTE OUTPUT STYLE:
- pure black ink line art on a pure white background
- bold, confident, clean outlines
- crisp high-contrast printable lines
- smooth professional line weight
- clean vector-like colouring-book illustration style
- detailed enough to feel premium, but still clean and easy to colour
- elegant adult colouring-book style
- open white spaces suitable for colouring with markers
- print-ready composition

LINE QUALITY REQUIREMENTS:
- lines must be dark black, not pale grey
- outlines must be visibly strong when printed
- use confident contour lines around people, clothing, hair, objects, and important background elements
- use smaller detail lines only where useful, such as hair, facial features, clothing folds, shoes, and key objects
- avoid overly thin, weak, faded, sketchy, or hesitant lines
- avoid visual noise and scratchy texture

PEOPLE-FIRST COMPOSITION:
- the people are the most important part of the image
- make the main people large, clear, attractive, and central enough to be the focus of the page
- if the original photo has too much empty sky, ceiling, driveway, floor, wall, table, or blank background, reframe/crop/zoom the scene into a better colouring-book composition
- do not preserve bad phone-camera framing if it makes the people too small or the page feel empty
- preserve the important feeling and setting of the photo, but improve the framing for a beautiful colouring-book page
- if the people are distant, enlarge them enough that faces and body poses are readable
- keep group photos balanced so every main person remains visible and recognisable
- do not crop off heads, faces, hands, or important body parts unless they were already clearly cut off in the original

LIKENESS AND SUBJECT PRESERVATION:
- preserve the real number of main people
- preserve each person's approximate facial likeness, expression, hairstyle, body proportions, pose, and clothing silhouette
- preserve important objects being held or worn
- preserve the general location and scene context
- keep faces clean, readable, and natural
- keep hands simple, clean, and believable
- do not add extra people
- do not remove main people
- do not merge people together
- do not turn people into caricatures
- do not make faces creepy, distorted, overly stylised, or generic

BACKGROUND AND SETTING PRESERVATION:
- preserve the recognisable identity and overall structure of the original setting
- retain the major environmental anchors that explain where the people are, such as walls, windows, doors, furniture, booths, tables, chairs, framed pictures, aircraft seats, cabin windows, ceiling patterns, crowds, paths, road edges, buildings, skylines, and horizon lines
- preserve the approximate position, scale, perspective, and spatial relationship of important background elements
- simplify fine texture, photographic noise, repetitive clutter, tiny decorations, and irrelevant micro-detail, but do not erase meaningful scene structure
- convert important background features into clean, colourable outlines with open white interior space
- do not replace a meaningful background with large empty white areas merely because the source is dark, blurry, crowded, or low contrast
- for dark or low-light photographs, carefully infer visible scene boundaries and preserve useful environmental cues as simplified outlines, including distant lights, architecture, paths, crowd placement, furniture, and room geometry
- preserve background people when they contribute meaningfully to the scene, but render them with less detail than the main subjects so they do not compete with the faces
- remove photographic darkness, haze, flash glare, colour casts, grain, blur, and muddy shadows without removing the objects or structures they belong to
- maintain a clear depth hierarchy: main people most detailed, important setting elements moderately detailed, minor clutter simplified
- the background must support the people without dominating them, but the finished page should still clearly feel like the same real place and moment
- prioritise structural accuracy and setting identity over decorative detail

STRICTLY DO NOT CREATE:
- colour
- grey shading
- pencil shading
- soft gradients
- faint grey lines
- pale sketch lines
- washed-out tracing
- rough draft appearance
- messy crosshatching
- photographic shadows
- blurry or low-contrast lines
- filled black shadow areas unless absolutely necessary for tiny details
- text, captions, labels, logos, watermarks, signatures, or brand names
- random extra objects
- random extra people
- warped faces
- broken hands
- missing limbs
- distorted bodies
- oversexualised bodies
- childish cartoon style
- anime style
- comic-book superhero style
- hyper-realistic shaded portrait style

QUALITY DECISION RULES:
- If choosing between exact photo framing and a better colouring-book page, choose the better colouring-book page.
- If choosing between preserving clutter and creating a clean product, choose the clean product.
- If choosing between extreme detail and print clarity, choose print clarity.
- If choosing between realism and colourability, choose colourability.
- If choosing between faint accuracy and bold attractive line art, choose bold attractive line art.
- The final page should look sellable, finished, premium, and ready to include in a printed personalised colouring book.
`.trim();

function buildRegenerationBooster(instruction: string | null) {
  const normalized = (instruction || "").toLowerCase();

  const rules: string[] = [
    "- Preserve all successful facial identity, expressions, pose, composition, perspective, clothing silhouette, and overall scene layout from the current best result unless the correction explicitly requires a change.",
    "- Apply the correction strongly and visibly for this regeneration attempt.",
    "- Do not make the page worse in unrelated areas while fixing the requested defect.",
    "- Rebuild weak areas cleanly instead of tracing or patching them in a messy way.",
    "- Keep the result premium, clean, colourable, and print-ready.",
    "- Do not use large solid black filled regions in hair, clothing, skin, furniture, objects, or background areas.",
    "- Use colourable white space with black outlines and selective interior detail lines instead of heavy black fill.",
    "- Tiny controlled black accents are allowed only where genuinely useful, such as pupils, eyelashes, nostrils, eyebrow mass, and very small moustache or beard accents.",
  ];

  if (/(hair|filled|fill|black|dark|shadow)/.test(normalized)) {
    rules.push(
      "- Replace any filled black hair or shadow blocks with clean outer contours and a few interior strand/detail lines, leaving most of the area white and colourable."
    );
  }

  if (/(background|clutter|busy|messy|wall|ceiling|room|plane|cabin|table|seat|window|interior)/.test(normalized)) {
    rules.push(
      "- Simplify background clutter aggressively. Keep only the key scene-defining structures and objects as clean outline shapes that support the people."
    );
  }

  if (/(hand|hands|finger|fingers|arm|arms|anatomy|body|limb)/.test(normalized)) {
    rules.push(
      "- Correct anatomy issues, especially hands, fingers, arms, and overlapping body shapes, so they read clearly and naturally."
    );
  }

  if (/(face|eyes|nose|mouth|likeness|expression)/.test(normalized)) {
    rules.push(
      "- Preserve the existing face likeness extremely closely and do not stylise, age, beautify, or distort the expressions."
    );
  }

  return rules.join("\n");
}

function buildRegenerationPrompt(instruction: string | null) {
  if (!instruction) {
    return `${MEMORY_BOOKS_PROMPT}

REGENERATION MODE:
You are revising a previously generated colouring-book page.
Use the original customer photo as the ground truth.
Use the previous generated page only as a continuity reference for what already works.

NON-NEGOTIABLE REGENERATION RULES:
- Preserve the strongest existing facial likeness, expressions, composition, and pose.
- Fix weak areas cleanly without degrading successful areas.
- Avoid large solid black filled areas.
- Keep the page clean, colourable, premium, and print-ready.

Return one complete finished colouring-book page only.`;
  }

  return `${MEMORY_BOOKS_PROMPT}

REGENERATION MODE:
You are revising a previously generated colouring-book page.
Use the original customer photo as the ground truth.
Use the previous generated page only as a continuity reference for what already works.

NON-NEGOTIABLE REGENERATION RULES:
${buildRegenerationBooster(instruction)}

SCOPED FIX REQUEST:
${instruction}

EXECUTION INSTRUCTIONS:
- Apply the requested fix strongly and visibly.
- Do not leave the defect partially fixed.
- Preserve all successful areas unless they must be adjusted to complete the fix.
- If the user request is short or vague, infer the most direct correction and apply it decisively.
- Return one complete finished colouring-book page only.`;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function getMimeTypeFromUrl(url: string) {
  const lower = url.toLowerCase();

  if (lower.includes(".png")) return "image/png";
  if (lower.includes(".webp")) return "image/webp";
  if (lower.includes(".heic")) return "image/heic";
  if (lower.includes(".heif")) return "image/heif";
  if (lower.includes(".avif")) return "image/avif";
  if (lower.includes(".gif")) return "image/gif";
  if (lower.includes(".bmp")) return "image/bmp";
  if (lower.includes(".dib")) return "image/bmp";
  if (lower.includes(".tif")) return "image/tiff";
  if (lower.includes(".tiff")) return "image/tiff";
  if (lower.includes(".jfif")) return "image/jpeg";
  if (lower.includes(".pjpeg")) return "image/jpeg";
  if (lower.includes(".pjp")) return "image/jpeg";

  return "image/jpeg";
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

  const apiKey = process.env.GEMINI_API_KEY?.trim();

  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing GEMINI_API_KEY." },
      { status: 500 }
    );
  }

  const { data: image, error: imageError } = await supabaseAdmin
    .from("order_images")
    .select("*")
    .eq("id", imageId)
    .single();

  if (imageError || !image) {
    return NextResponse.json(
      { error: "Image row not found." },
      { status: 404 }
    );
  }

  const { data: order, error: orderError } = await supabaseAdmin
    .from("orders")
    .select("*")
    .eq("id", image.order_id)
    .single();

  if (orderError || !order) {
    return NextResponse.json(
      { error: "Order not found." },
      { status: 404 }
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

    const originalResponse = await fetch(image.original_url);

    if (!originalResponse.ok) {
      throw new Error("Failed to download original image.");
    }

    const originalArrayBuffer = await originalResponse.arrayBuffer();
    const originalBase64 = Buffer.from(originalArrayBuffer).toString("base64");

    const mimeType = image.mime_type || getMimeTypeFromUrl(image.original_url);
    const promptText = buildRegenerationPrompt(regenerationInstruction);

    let previousGeneratedPart:
      | {
          inline_data: {
            mime_type: string;
            data: string;
          };
        }
      | null = null;

    if (image.generated_url) {
      try {
        const previousResponse = await fetch(image.generated_url);

        if (previousResponse.ok) {
          const previousArrayBuffer = await previousResponse.arrayBuffer();
          const previousBase64 = Buffer.from(previousArrayBuffer).toString(
            "base64"
          );

          previousGeneratedPart = {
            inline_data: {
              mime_type: "image/png",
              data: previousBase64,
            },
          };
        }
      } catch {
        previousGeneratedPart = null;
      }
    }

    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: promptText,
                },
                {
                  text: "SOURCE CUSTOMER PHOTO — this is the ground truth. Preserve the real people, likeness, scene, and important content from this image.",
                },
                {
                  inline_data: {
                    mime_type: mimeType,
                    data: originalBase64,
                  },
                },
                ...(previousGeneratedPart
                  ? [
                      {
                        text: "CURRENT GENERATED PAGE — use this only as a continuity reference for what already works, especially facial likeness, composition, and pose. Fix the requested defect without degrading successful areas.",
                      },
                      previousGeneratedPart,
                    ]
                  : []),
              ],
            },
          ],
        }),
      }
    );

    const geminiData = await geminiResponse.json();

    if (!geminiResponse.ok) {
      throw new Error(
        geminiData?.error?.message || "Gemini generation failed."
      );
    }

    const parts = geminiData?.candidates?.[0]?.content?.parts || [];

    const imagePart = parts.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (part: any) => part.inlineData?.data || part.inline_data?.data
    );

    const generatedBase64 =
      imagePart?.inlineData?.data || imagePart?.inline_data?.data;

    if (!generatedBase64) {
      throw new Error("Gemini did not return an image.");
    }

    const generatedBuffer = Buffer.from(generatedBase64, "base64");

    const orderSlug = slugify(order.customer_name || "order");
    const shortOrderId = order.id.slice(0, 8);
    const orderFolder = `${orderSlug}-${shortOrderId}`;
    const generatedPath = `${orderFolder}/page-${image.page_number}-generated-${Date.now()}.png`;

    const { error: uploadError } = await supabaseAdmin.storage
      .from("generated")
      .upload(generatedPath, generatedBuffer, {
        contentType: "image/png",
        upsert: true,
      });

    if (uploadError) {
      throw new Error(uploadError.message);
    }

    const { data: publicUrlData } = supabaseAdmin.storage
      .from("generated")
      .getPublicUrl(generatedPath);

    const generatedUrl = publicUrlData.publicUrl;

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
            model: GEMINI_IMAGE_MODEL,
            prompt_version: MEMORY_BOOKS_PROMPT_VERSION,
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
        model_used: GEMINI_IMAGE_MODEL,
        prompt_version: MEMORY_BOOKS_PROMPT_VERSION,
        generated_at: new Date().toISOString(),
        last_regeneration_instruction: regenerationInstruction,
        regeneration_history: regenerationHistory,
      })
      .eq("id", image.id)
      .select("*")
      .single();

    if (updateError) {
      throw new Error(updateError.message);
    }

    await supabaseAdmin
      .from("orders")
      .update({
        status: "needs_review",
        pdf_status: "not_exported",
      })
      .eq("id", order.id);

    return NextResponse.json({
      image: updatedImage,
      model: GEMINI_IMAGE_MODEL,
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