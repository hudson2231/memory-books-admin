import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";

const GEMINI_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL?.trim() || "gemini-3-pro-image";
const MEMORY_BOOKS_PROMPT_VERSION = "premium_people_first_v1";
const MAX_IMAGES_PER_REQUEST = 2;

const MEMORY_BOOKS_PROMPT = `
Convert the uploaded customer photo into a premium personalised colouring-book page.

This is a strict photo-to-line-art conversion task. Do not create a new illustration from imagination. The final output must feel like the same real memory, converted into clean printable colouring-book line art.

ABSOLUTE OUTPUT RULES:
- black ink outlines only
- pure white background
- no colour anywhere
- no coloured clothing
- no coloured objects
- no grey shading
- no gradients
- no soft shadows
- no pencil shading
- no crosshatching
- no painterly texture
- no sketch texture
- no filled black clothing areas
- no filled black hair areas
- no filled black shadow areas
- no solid dark blobs
- no logos, readable brand names, signs, captions, text, labels, watermarks, or signatures
- do not render any text from clothing, signs, posters, bottles, menus, or screens
- if a logo or text appears in the photo, replace it with a blank outlined shape

STYLE TARGET:
- clean adult colouring-book line art
- crisp black outlines
- smooth confident lines
- consistent thin-to-medium line weight
- elegant and premium
- simple enough to colour
- detailed enough to feel personal
- large open white spaces inside clothing, hair, skin, furniture, and background objects
- no childish cartoon style
- no anime style
- no comic superhero style
- no realistic shaded portrait style

PHOTO FIDELITY:
- preserve the real number of main foreground people
- preserve the main people's approximate facial likeness, expression, hairstyle, pose, body proportions, and clothing silhouette
- preserve who is close to whom and the overall memory composition
- preserve important objects being held or worn
- preserve the general setting enough that the place still makes sense
- do not add extra main people
- do not remove main foreground people
- do not merge people together
- do not change the pose into something unrelated
- do not rotate the image
- preserve the original orientation of the photo unless it is clearly sideways in the uploaded file

PEOPLE-FIRST COMPOSITION:
- main people are the most important part of the page
- make faces clean, readable, natural, and flattering
- keep eyes, nose, mouth, jawline, eyebrows, and hairline simple but recognisable
- make hands simple and believable
- avoid warped fingers, missing limbs, broken arms, distorted faces, or creepy expressions
- if the photo has bad phone framing, crop or reframe only enough to make the main people readable
- never crop off important heads, faces, hands, or bodies unless they are already cut off in the original photo

BACKGROUND RULES:
- simplify the background heavily
- keep only the major setting anchors needed to understand the memory
- remove unnecessary clutter, tiny objects, noise, dirt, grain, messy shadows, and irrelevant background detail
- convert background structures into simple clean outlines
- background should support the people, not dominate the page
- avoid dense wall textures, dense stone textures, dense crowd texture, tiny repeated details, and messy line noise
- leave large clean white areas wherever possible

GROUP PHOTO RULES:
- If the photo contains 3 or more main people, treat it as a group photo.
- Preserve the main foreground group.
- Keep every clearly important foreground person recognisable.
- Simplify background people aggressively.
- Remove or reduce random crowd members who are not central to the memory.
- Do not let background crowds compete with the main group.
- Use fewer background lines in group photos than in simple couple photos.
- Prioritise clear faces and clean silhouettes over background accuracy.
- If a party, concert, restaurant, classroom, school event, or crowded scene is shown, keep the setting simple and readable, not busy.
- Main group faces must be more detailed than background faces.

CLOTHING AND HAIR RULES:
- all clothing must remain white inside with black outline details only
- never fill shirts, jackets, dresses, hats, or pants with colour or black
- show clothing using outlines, seams, collars, sleeves, folds, and simple detail lines
- hair must be outline and strand detail only
- never turn dark hair into solid black fill
- never turn black clothing into solid black fill

DARK / LOW-LIGHT PHOTO RULES:
- remove darkness, flash glare, red-eye, colour casts, grain, blur, and muddy shadows
- infer clean outlines from the visible subjects
- do not copy photographic darkness into the output
- do not use dark filled areas to represent shadows
- keep the final page bright, white, clean, and colourable

QUALITY BAR:
- the result must be suitable for a paid personalised colouring book
- it must look intentional, clean, premium, and print-ready
- it must not look like a rough trace, AI sketch, messy comic panel, or unfinished draft
- if a rule conflicts with making a pretty page, follow the rule
- if colour appears, the output is wrong
- if large filled areas appear, the output is wrong
- if the main people are unrecognisable, the output is wrong
- if the background is too busy to colour, the output is wrong
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
