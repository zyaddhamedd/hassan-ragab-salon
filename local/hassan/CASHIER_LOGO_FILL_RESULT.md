# Phase 4B.5A.3 — maximum lossless fill in the fixed slot

## Latest owner correction — larger artwork, unchanged layout

The owner requested a genuinely larger mark without increasing the header. The image now renders at **125 × 73.52px**, absolutely positioned beyond the small logical brand slot but entirely **inside the original 101px header**. This nearly doubles the prior 63.76px artwork width. The original 106.12 × 37.5px container remains unchanged and contributes no extra layout height. Every header/control/search/invoice rectangle matches the original reference. Image top/bottom are 13.24/86.76px; there is no button overlap. No logo pixels or assets changed. The older 4% limit below applies only when artwork is forced to stay inside the small logical slot, which the latest instruction superseded.

Latest evidence: `.local/omar/cashier-logo-larger-1793147968911/`. Only header-image CSS, targeted tests and this report were adjusted.


The container and CSS were not changed. The header remains 101px high and the brand slot remains 106.1171875 × 37.5px at the tested 1470 × 779 desktop viewport.

A tightly bounded derivative, `local/omar/assets/cashier-header-logo-white-tight.svg`, removes only fully transparent padding from the existing approved white logo. The outer viewBox changes from `[0,0,1792,878]` to `[193,25,1435,844]`. The embedded PNG bytes, alpha mask, white paint, original image coordinates and every nonzero-alpha pixel remain identical. The original PNG and approved uncropped white SVG remain untouched.

The test decodes all original PNG scanlines and checks the bounds using **alpha > 0**, with no threshold that could discard faint visible pixels. Reversing only the derivative's outer dimensions/viewBox yields the original white SVG byte-for-byte. There is no tracing, distortion, filter, source recoloring, visible-pixel clipping, CSS transform, added padding/margin or new effect.

Omar Mini Cashier alone selects the tight derivative. Existing `object-fit:contain`, absolute inset, and 100% image dimensions remain unchanged. Other screens, receipt/print assets, Admin and canonical Mini are untouched.

## Actual improvement and unavoidable limit

| Visible artwork | Before | After |
|---|---:|---:|
| Height | 36.0478px | 37.5px |
| Width | 61.2899px | 63.7589px |
| Linear scale | 100% | 104.0284% |

The full symbol, name and subtitle are retained. **The improvement is only about 4%, not a noticeably large enlargement.** The artwork's tall symbol already occupied nearly all available height. After removing every transparent border, height is the limiting dimension; unused horizontal space is required by the logo's aspect ratio. Filling more width would require cutting visible artwork, distortion, changing the approved design, or enlarging the container—all forbidden here.

## Evidence and validation

Ignored evidence: `.local/omar/cashier-logo-fill-1793147770832/` (`before/after.json` and desktop PNGs).

The strict recorded before/after comparison includes the viewport, document size, header box, logo-container box, every header button, customer inputs and invoice rail. They must match exactly. The screenshot verifies successful loading of the entire white mark.

Targeted branding/isolation and lossless-crop tests pass; Mini production build passes with the existing >500 KB JS chunk warning. `git diff --check` passes. No server was stopped, no database/business operation was performed, and no commit/push/deployment was made.

Changed files:

1. `local/omar/assets/cashier-header-logo-white-tight.svg`
2. `local/omar/cashier-header-logo.mjs` — select and guard the derivative.
3. `local/omar/cashier-header-logo.test.mjs` — decoded alpha bounds, exact derivative content, fixed geometry.
4. `local/omar/CASHIER_LOGO_FILL_RESULT.md`

The header stylesheet is byte-identical to Phase 4B.5A.2. Stop after this correction.
