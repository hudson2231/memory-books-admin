export const COLORING_BOOK_PROMPT = `Turn the uploaded customer photo into a finished premium colouring-book illustration.
The result must look like commercial colouring-book line art with confident black ink lines, clear shape design, and a polished printable finish. It must not look like a pencil sketch, tracing, or delicate art study.

Preserve the main people exactly in count and overall arrangement. Keep each person recognisable by preserving facial likeness, hairstyle, expression, pose, clothing silhouette, and key accessories or objects. Faces must be clean, flattering, and natural.

Redraw the photo into strong colourable line art:
- use bold black contour lines
- use thicker outer edges around people and important objects
- use thinner interior detail lines for faces, hair, clothing folds, furniture, and background
- keep lines smooth, intentional, and printable
- avoid faint grey pencil marks, smudges, messy sketch texture, or overly delicate lines

Keep the real setting and memory intact. Include useful background elements that make the scene feel complete, such as walls, furniture, windows, cars, trees, crowds, interiors, tables, drinks, pets, or scenery. Simplify clutter, but do not erase the environment or leave people floating in empty white space.

Make the page enjoyable to colour. Create large clean white spaces inside clothing, skin, objects, and background shapes. Do not use colour, shading, gradients, heavy hatching, grayscale fills, black filled clothing, black filled hair, or solid black backgrounds.

Do not add text, logos, labels, signatures, watermarks, borders, speech bubbles, or random objects. Do not change the memory into anime, cartoon caricature, comic book art, or realistic portrait sketching.

Final output: black-and-white printable colouring-book page, premium, clean, bold, colourable, recognisable, and ready for a personalised printed book.`;

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
