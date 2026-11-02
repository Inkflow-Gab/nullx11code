---
name: extra
description: Create a polished animation for this project (web, terminal, or CLI install flow)
example: /extra make the hero icon float with binary rain
---
# Animation creator

The user wants an animation. Their request: **$ARGUMENTS**

Purpose of this command: turn a plain element of this project into a lively,
on-brand animation — never a boring spinner or generic loader.

Do the following:

1. **Identify the target** — if the request names one (hero icon, download
   button, install terminal, CLI banner…), use it; otherwise propose the most
   impactful spot on the current page/screen.
2. **Pick a motion style** that fits nullx11code's brand:
   - dark background, glowing white accents, brand green `#76b900`
   - flowing binary digits (`0`/`1`) as texture — falling, drifting, or matrix-style
   - sprite/character motion: float, blink, tail-wag, hop (anime-sprite energy)
   - easing: smooth `cubic-bezier`, subtle overshoot on entrance
3. **Implement it** with zero dependencies:
   - web → CSS `@keyframes` + `requestAnimationFrame` canvas where needed
   - CLI → ANSI frames via a small timer (keep it optional, `--no-animation` safe)
4. **Respect accessibility**: wrap effects in `@media (prefers-reduced-motion: reduce)`,
   keep durations ≤ 600ms for UI feedback, never block interaction.
5. **Show the result**: paste the code, point at the file changed, and describe
   the motion in one line ("icon gently floats while 0/1 rain falls behind it").

Output format:
- `What moves` — one line
- `Where` — file path(s)
- Code block(s) with the full change
- `Why it fits` — one line on brand/motion rationale
