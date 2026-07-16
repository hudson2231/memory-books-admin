import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";

const GEMINI_IMAGE_MODEL = "gemini-3-pro-image";
const MEMORY_BOOKS_PROMPT_VERSION = "premium_people_first_v1";
const MAX_IMAGES_PER_REQUEST = 2;

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

const STORY_BOOK_PROMPT_VERSION = "storybook_clipart_v1";

const STORY_BOOK_PROMPT = `
Create a finished, premium, printable personalised story-book illustration from the uploaded customer photo.

This is for a personalised memory story book product. The result should feel like a clean, warm, modern clip-art / illustrated keepsake page, not a colouring-book page and not a rough sketch.

ABSOLUTE OUTPUT STYLE:
- polished modern clip-art / storybook illustration style
- soft, friendly, premium, giftable look
- clean simplified shapes with smooth edges
- tasteful colour palette inspired by the original photo
- clear readable people with recognisable likeness
- warm sentimental feeling
- print-ready composition on a clean page
- no messy sketch lines, no harsh photo filter, no hyper-realistic rendering

SUBJECT PRESERVATION:
- preserve the real number of main people
- preserve each person's approximate facial likeness, expression, hairstyle, body proportions, pose, and clothing silhouette
- preserve important objects being held or worn
- keep faces clean, warm, recognisable, and natural
- do not add extra main people
- do not remove main people
- do not merge people together
- do not turn people into caricatures
- do not make faces creepy, distorted, overly stylised, or generic

SETTING PRESERVATION:
- preserve the recognisable identity and structure of the original setting
- keep the main environmental anchors that explain the memory, such as rooms, furniture, tables, chairs, roads, paths, beaches, parks, buildings, skylines, cars, aircraft cabins, crowds, signs without readable text, and horizon lines
- simplify clutter and tiny details, but do not erase the place or make the people float in empty space
- make the setting support the memory without overpowering the people

STORYBOOK QUALITY RULES:
- make the page feel like a meaningful memory, not a generic stock illustration
- use the customer caption only as context for mood and scene importance
- do not render, draw, spell, or place the caption text inside the image itself
- do not add random text, labels, logos, watermarks, signatures, or brand names
- do not create a colouring-book line-art page
- do not create anime, comic superhero, or childish cartoon style
- the final page should look sellable, finished, premium, and ready to include in a printed personalised story book.
`.trim();

function getProductType(order: Record<string, any>) {
  return order.product_type === "story_book" ? "story_book" : "colouring_book";
}

function getPromptForOrder(order: Record<string, any>, image: Record<string, any>) {
  if (getProductType(order) === "story_book") {
    const caption = typeof image.caption_text === "string" ? image.caption_text.trim() : "";

    if (!caption) {
      return STORY_BOOK_PROMPT;
    }

    return `${STORY_BOOK_PROMPT}

CUSTOMER CAPTION FOR THIS PAGE:
${caption}

Use this caption as emotional and contextual guidance only. Do not render the caption text inside the illustration.`;
  }

  return MEMORY_BOOKS_PROMPT;
}

function getPromptVersionForOrder(order: Record<string, any>) {
  return getProductType(order) === "story_book"
    ? STORY_BOOK_PROMPT_VERSION
    : MEMORY_BOOKS_PROMPT_VERSION;
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
  const { id: orderId } = await context.params;

  const apiKey = process.env.GEMINI_API_KEY?.trim();

  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing GEMINI_API_KEY." },
      { status: 500 }
    );
  }

  const { data: order, error: orderError } = await supabaseAdmin
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .single();

  if (orderError || !order) {
    return NextResponse.json(
      { error: "Order not found." },
      { status: 404 }
    );
  }

  const { data: images, error: imagesError } = await supabaseAdmin
    .from("order_images")
    .select("*")
    .eq("order_id", orderId)
    .or("generated_url.is.null,status.eq.failed,status.eq.uploaded,status.eq.not_generated")
    .order("page_number", { ascending: true })
    .limit(MAX_IMAGES_PER_REQUEST);

  if (imagesError) {
    return NextResponse.json(
      { error: imagesError.message },
      { status: 500 }
    );
  }

  if (!images || images.length === 0) {
    return NextResponse.json(
      { error: "No ungenerated pages left for this order." },
      { status: 400 }
    );
  }

  const orderSlug = slugify(order.customer_name || "order");
  const shortOrderId = order.id.slice(0, 8);
  const orderFolder = `${orderSlug}-${shortOrderId}`;

  const generatedResults = [];

  for (const image of images) {
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

      const mimeType =
        image.mime_type || getMimeTypeFromUrl(image.original_url);
      const promptText = getPromptForOrder(order, image);
      const promptVersion = getPromptVersionForOrder(order);

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
                    inline_data: {
                      mime_type: mimeType,
                      data: originalBase64,
                    },
                  },
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

      const generatedPath = `${orderFolder}/page-${image.page_number}-generated.png`;

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

      const { data: updatedImage, error: updateError } = await supabaseAdmin
        .from("order_images")
        .update({
          generated_url: generatedUrl,
          status: "generated",
          error_message: null,
          model_used: GEMINI_IMAGE_MODEL,
          prompt_version: promptVersion,
          generated_at: new Date().toISOString(),
          replaced_manually: false,
        })
        .eq("id", image.id)
        .select("*")
        .single();

      if (updateError) {
        throw new Error(updateError.message);
      }

      generatedResults.push(updatedImage);
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

      generatedResults.push({
        id: image.id,
        status: "failed",
        error_message: message,
      });
    }
  }

  const failedCount = generatedResults.filter(
    (result) => result.status === "failed"
  ).length;

  const { count: remainingCount } = await supabaseAdmin
    .from("order_images")
    .select("id", { count: "exact", head: true })
    .eq("order_id", orderId)
    .or("generated_url.is.null,status.eq.failed,status.eq.uploaded,status.eq.not_generated");

  const newOrderStatus =
    failedCount > 0
      ? "generation_failed"
      : remainingCount && remainingCount > 0
        ? "generating"
        : "needs_review";

  await supabaseAdmin
    .from("orders")
    .update({
      status: newOrderStatus,
      pdf_status: "not_exported",
    })
    .eq("id", orderId);

  return NextResponse.json({
    model: GEMINI_IMAGE_MODEL,
    images: generatedResults,
    generated_this_run: generatedResults.filter((result) => result.status === "generated").length,
    failed_this_run: failedCount,
    remaining: remainingCount || 0,
    status: newOrderStatus,
    message:
      remainingCount && remainingCount > 0
        ? `Generated this batch. ${remainingCount} page(s) still remaining.`
        : "All pages generated. Ready for review.",
  });
}
