# PROTOTYPE avoid zones: findings

**Throwaway.** This branch holds the prototype as a primary source. None of it goes to main as is.

Question: how should page content over the pond stay readable? This is roadmap item 6 in Luckmorecat/koi-ascii#1.

Run `npm run proto:avoid` to open `/prototype-avoid/`. The bar at the bottom (or the ← and → keys) switches between the variants. The panel at the top right tunes the knobs, which are saved in the URL. `&show` outlines each zone. The page is a realistic landing page over a fixed full-viewport pond: a nav bar, a hero with a headline, a lede and CTAs, three cards, a block of prose and a footer.

| Variant | What it does |
| --- | --- |
| A | Nothing (what the library does today) |
| B | Steer around every zone, and dim the water under the zones |
| C | Fade under every zone: water and fish thin out and dim, and there is no steering |
| D | Mixed: fish steer around the hero (nav, h1, lede, CTAs) and fade under the cards and the prose. Fade applies everywhere |
| E | No library support: CSS scrims (`rgba` background and `backdrop-filter`) plus `text-shadow` |

Library side: see the `PROTOTYPE avoid-zones` blocks in `src/koi/koi.ts` (soft walls from the SDF of a rounded rect), `src/pond.ts`, `src/renderer.ts` (8 zones as uniforms) and `src/shaders/scene.frag` (the mask and the thin and dim step applied before glyph choice).

## What we learned

1. **Steering alone fails.** Shots: `shots/scroll-B.png`, `shots/m-B.png`.
   - When the page scrolls a card over a fish, the fish is trapped under the text at full brightness.
   - On a phone (390×844) the hero and card zones cover most of the pond, so fish sat inside steer zones 99.9% of the time. The walls fight each other and the pond edge, and the gaps are narrower than a koi.
   - Probing only at the head lets the long body and tail sweep across the headline, even on desktop.
2. **Fade-under is robust for free** (`C.png`, `scroll-C.png`, `m-C.png`). The fade is a pure per-cell shader mask, so scroll, resize and moving content are always right with no lag and no sim state. It reads as fish swimming deeper, not as clipping.
3. **The feather matters more than the strength.**
   - With `feather=0` the fish are cut off at a hard rectangle and the water shows a visible hole (`c-strong-hard.png`). It looks like a bug.
   - With a feather of 48–80 px (about 3–5 glyph cells) it looks intentional (`c-wide.png`).
   - A small pad (8–12 px) beyond the element box helps.
   - Rounded corners taken from the computed `border-radius` matched the cards well.
4. **Strength.**
   - Fish dimmed by 0.5–0.6 still fight with body text (`c-weak.png`, the first D shot). About 0.85 lets them read as a faint texture under the text.
   - At 0.92 or more, fish seem to vanish or teleport.
   - For water, thinning about 0.8 and dimming about 0.6 under the text is right.
   - Thinning (lowering glyph density) does more for legibility than dimming colour. Both are needed, because the glow follows colour.
5. **Mixed (D) looked best on desktop** (`d-tuned.png`). The fish keep to the open water around the headline, so the pond still looks alive, while the cards fade.
   - On a phone one fish still got trapped in a steer zone, but the fade kept the text readable.
   - With `push=0.4` the trapping went to about 0%.
   - Steering is a nice-to-have bias. Fade is the safety net.
6. **The CSS scrim (E) helps the cards but not the headline.** A large headline over a bright koi stays busy, and a scrim box behind a headline looks heavy. It is still the right answer for opaque UI such as modals and nav bars. The library feature is about text sitting directly on the water.
7. **Cost.**
   - Calling `getBoundingClientRect` on 8 elements every frame took about 0.015 ms per frame.
   - With off-screen culling, 8 uniform slots were enough for the whole page while scrolling: at most 8 zones were visible at once, 6 on a phone.
   - The shader loop over 8 rounded-rect SDFs had no visible cost on the GPU.
8. **Pointer.** With `interactive: 'window'`, hovering a card attracts curious fish under it. With fade this is fine and even nice. With steering it fights the attraction.

## Recommendation for the real implementation

- **Fade-under is the core, and it is always on for every zone.** Steering is opt-in per zone, weak by default, and never the only protection.
- **API:**
  ```ts
  avoid?: Array<Element | { element: Element; mode?: 'under' | 'around'; pad?: number }>
  ```
  - The default mode is `'under'`. `'around'` adds steering on top of the fade.
  - Add `pond.setAvoid(list)` for SPAs where content comes and goes.
  - Skip `DOMRect` in v1: viewport coordinates are ambiguous once the page scrolls. If it is needed later, take container-local CSS px.
  - Global look options: `avoidFade?: number` (default about 0.85 for fish, with matching water values) and `avoidFeather?: number` (in CSS px, default about 56). Keep the internal thin and dim split out of the API.
- **Measurement:** call `getBoundingClientRect` on each element every frame, relative to the canvas. This already handles scroll, sticky elements, transforms, CSS animations and resize. It is cheap, and skipping a ResizeObserver plus scroll bookkeeping removes a class of stale-rect bugs.
  - Cull off-screen zones.
  - Cap the zones at about 8–16 uniform slots, dropping the farthest first.
  - Read `border-radius` once per element, or on resize.
- **Steering (`'around'`):**
  - Probe at the look-ahead point, the head and the body midpoint.
  - Scale the push down when the zones cover a large share of the pond, roughly a push of 0.4 or lower on phones.
  - Never re-pick points of interest inside a zone.
  - Accept that fish will sometimes be under content, since the fade covers it.
- **Feather and pad** belong to the look, not to the sim. The steer margin uses fish length; the fade feather uses px or cells.
- Tests: unit tests for the rect SDF and push. Add a browser shot of the demo with a headline zone.
