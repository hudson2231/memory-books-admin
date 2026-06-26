import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";

const GEMINI_IMAGE_MODEL = "gemini-3-pro-image";
const MEMORY_BOOKS_PROMPT_VERSION = "premium_people_first_v1";

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

BACKGROUND HANDLING:
- keep background details that make the scene recognisable and interesting
- simplify messy or distracting clutter
- convert background structures into clean, colourable outlines
- remove photographic darkness, haze, flash glare, grain, blur, and muddy shadows
- do not leave huge empty blank areas unless the original composition genuinely needs breathing room
- background should support the people, not dominate them
- use clean architectural/object outlines where useful, but avoid excessive background detail that competes with faces

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

const MAX_REGENERATION_INSTRUCTION_LENGTH = 800;

function buildRegenerationPrompt(instruction: string | null) {
  if (!instruction) {
    return MEMORY_BOOKS_PROMPT;
  }

  return `${MEMORY_BOOKS_PROMPT}

SCOPED REGENERATION REQUEST:
The instruction below applies only to this single page and this single regeneration attempt.

Make only the requested correction.
Preserve every successful element from the existing result.
Preserve facial identity, facial proportions, expressions, pose, body proportions, composition, clothing, perspective, and the number of people.
Do not redesign unrelated areas.
Do not weaken or replace any requirement in the master prompt above.
If the requested correction conflicts with the master prompt, follow the master prompt.
Return one complete finished colouring-book page, not an explanation.

Requested correction:
${instruction}`;
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

    if (regenerationInstruction && image.generated_url) {
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
                  text: "SOURCE CUSTOMER PHOTO — preserve identity and factual content from this image.",
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
                        text: "CURRENT GENERATED PAGE — use this only to identify the requested defect and preserve everything that already works.",
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

    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
