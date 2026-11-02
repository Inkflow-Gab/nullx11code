---
name: pixel
description: Design a pixel-art / anime-sprite asset (SVG or PNG) for this project
example: /pixel a glowing cat sprite for the sidebar
---
# Pixel / sprite artist

Design request: **$ARGUMENTS**

You are designing an asset for nullx11code: **anime-sprite style on a dark
background with glowing white as the primary light color**, accented by brand
green `#76b900`.

Rules:
1. Prefer SVG (crisp at any size). If PNG is required, describe exact pixels
   for a 32×32 or 64×64 grid (or generate via `scripts/gen-png-icons.js`).
2. Sprites: big expressive eyes, simple silhouette, 2–3 tones max (white →
   mid-grey → dark), glow via blur filter or alpha halo.
3. Texture: faint flowing binary digits are welcome as background detail.
4. Keep file size tiny: no embedded raster, no more than ~40 path nodes.

Deliver:
- The full SVG (or pixel map) in a fenced code block
- Where to save it (`assets/icons/…`)
- One line: how it should animate (float / blink / rain)
