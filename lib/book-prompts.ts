export const COLORING_BOOK_PROMPT = `BLACK AND WHITE ONLY. The output must contain only black line art on a pure white background. No colour anywhere in the image.

The final output must be composed as an A4 portrait colouring-book page. If the uploaded photo is landscape or horizontal, naturally recompose it into a portrait page while preserving all main people, facial likeness, pose, clothing, and key objects. Do not simply place a small landscape image in the centre of a tall page.

Turn the uploaded customer photo into a finished premium colouring-book illustration.

The result must look like commercial colouring-book line art with confident black ink lines, clear shape design, and a polished printable finish. It must not look like a pencil sketch, tracing, or delicate art study.

Preserve the main people exactly in count and overall arrangement. Keep each person recognisable by preserving facial likeness, hairstyle, expression, pose, clothing silhouette, and key accessories or objects. Faces must be clean, flattering, and natural.

Redraw the photo into strong colourable line art:
- use bold black contour lines
- use thicker outer edges around people and important objects
- use slightly lighter interior detail lines
- convert hair, clothing, and objects into clean simplified sections
- create large and medium enclosed spaces suitable for colouring
- keep features crisp and readable
- reduce tiny textures and incidental detail

Keep the background and setting recognisable, but simplify it aggressively into clean supporting line work. The people must remain the clear focal point.

Do not:
- use colour anywhere
- output a landscape page, horizontal canvas, tiny centred scene, or large unused blank space around the main artwork
- use shading, tonal rendering, grey fill, or cross-hatching
- use solid black fill on clothing, hair, skin, or background
- use faint, scratchy, or sketchy lines
- over-texture skin, clothes, or walls
- preserve the original photo’s lighting or colour values as filled areas
- add extra people or remove main people
- include readable text, logos, watermarks, or branding

Hair, clothes, and objects must stay mostly open and colourable, using line work instead of filled dark masses.

Aim for a premium black-on-white page that feels bold, clean, and intentionally designed for colouring, with strong contrast and a polished published-book quality.`

export const STORYBOOK_PROMPT = `Create a finished, premium, printable personalised story-book illustration from the uploaded customer photo.

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
- the final page should look sellable, finished, premium, and ready to include in a printed personalised story book.`;
