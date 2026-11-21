# Phase 4B.5A — cashier header logo

**Current state:** Phase 4B.5A.2 removed the oversized fixed brand container and restored the exact pre-logo header/search/invoice geometry. The approved white asset remains unchanged. See [current geometry result](CASHIER_HEADER_GEOMETRY_RESULT.md); sizing descriptions below are historical.

Initial Phase 4B.5A implementation is recorded below; its original footprint measurements are historical and superseded by the owner-requested enlargement in the following section. **Logo readability is limited at the original footprint**, as described below. No additional branding phase was started.


## Latest refinement — pure white, 120px

The current Cashier header uses `local/omar/assets/cashier-header-logo-white.svg`, a standalone pure-white SVG silhouette whose alpha mask embeds the **exact original PNG bytes**. This preserves every original pixel's alpha, shape, typography and aspect ratio without vector tracing, cropping, resampling, filters or recoloring the source file. The only rendered paint is `#FFFFFF`; original dark RGB values are used only as ignored mask color channels, so they cannot create dark pixels/halos in the output.

The displayed image is now **120px wide with automatic proportional height**, centered using absolute inset and auto margins in the existing **220 × 108px** brand slot. The slot, header height and neighboring controls stay unchanged from immediately before this refinement. The original PNG remains unchanged. Previous measurements and readability notes below describe earlier iterations, not the current white version.

Files adjusted for this refinement: the new `assets/cashier-header-logo-white.svg`, `cashier-header-logo.mjs`, `cashier-header-logo.css`, `cashier-header-logo.test.mjs` and this report. Selection remains Omar Mini Cashier only; receipts, shared Logo, other screens, Admin and default Mini remain unchanged. No database operations or commits.

Desktop evidence: `.local/omar/cashier-white-logo-1793143222984/` (before/after screenshots and exact header/button rectangles). Mini production build and targeted branding/isolation tests pass. Servers remain running.

## Owner follow-up — enlarged logo

The owner explicitly rejected the small version and requested a large logo filling its available area. The Omar-only brand slot is now **240 × 108px**, with the original PNG proportionally contained in that full area. The header is allowed to grow with this requested larger slot; the earlier 37.5px slot and unchanged-header-height acceptance are superseded. Adjacent controls retain their original dimensions/styles and move through the original flex layout; no overlap or horizontal overflow was observed at 1470px desktop width. No source pixels, color, opacity, decoration or shared branding were changed. Dark source lettering still has its intrinsic contrast limitation.

Changed for this follow-up: `cashier-header-logo.css`, its targeted test and this report. Existing servers stay running.

## Discovery and exact asset

The only newly added/untracked PNG candidate was:

`Omar Fahim Barber Shop Logo.png` (workspace root).

Other PNGs are existing tracked application icons/assets; they were not selected or modified. The supplied file remains in its original location and remains untracked. No copy, crop, recolor, resampling, regeneration or byte modification was performed.

- PNG, 1792 × 878, 8-bit RGBA, non-interlaced.
- Genuine transparency verified by decoding all PNG scanlines, not only checking an alpha-channel flag: 1,343,473 fully transparent pixels; 228,595 partially transparent; 1,308 opaque.
- Nonzero-alpha bounding box: x=193…1627, y=25…868 (1435 × 844). Transparent side margins are part of the supplied image.
- SHA-256: `91c5f63f0a2527091d6182488b82cea8cb45c1086706a2880cd3814553764616`.
- Production asset `Omar Fahim Barber Shop Logo-BFgS8UX1.png` has the same SHA-256: exact supplied bytes.

## Scope and files changed

1. `local/omar/mini.vite.config.mjs`: register the header-content plugin after existing Omar theme plugins and before React.
2. `local/omar/cashier-header-logo.mjs`: fail-closed source hook and exact PNG asset selection, only for Omar Mini CashierScreen.
3. `local/omar/cashier-header-logo.css`: brand-block-only screen presentation and proportional contain sizing.
4. `local/omar/cashier-header-logo.test.mjs`: asset identity, source restoration, default/Admin/receipt isolation, CSS scope and captured geometry tests.
5. `local/omar/CASHIER_HEADER_LOGO_RESULT.md`: this report.

All prior uncommitted changes are preserved. No canonical Mini/Admin/backend source or existing theme stylesheet/module was edited. The pre-existing shared `branding.mjs` and `frontend-config.mjs` are unchanged.

The current text block is local to CashierScreen, not a shared Logo component. Its original text nodes/expressions remain in normal flow as an intrinsic size gauge; screen-only CSS hides them and places the exact PNG within the same box. This retains branch/group-mode intrinsic sizing rather than adding fixed global dimensions or measuring/reflowing controls in JavaScript. The new accessible image is named “Omar Fahim Salon.” No extra plate, border, shadow, glow, padding or image filter is added.

Outside screen media the image has `display:none`; the original text visibility/position remain canonical. The shared Login/Sidebar Logo component and receipt SVG resolution (`llooggo.svg` → existing Omar `wordmark-ink.svg`) were not changed. No print dialog was invoked.

## Desktop evidence and geometry

Ignored evidence directory: `.local/omar/cashier-header-logo-1793141274500/`.

Both states were tested at **1470 × 779**, same empty cashier and existing authenticated local session. Only sidebar navigation was used; no invoice/customer/stock/financial action was performed.

| Measurement | Before | After |
|---|---|---|
| Header x/y/width/height | 368.5 / 0 / 1101.5 / 101 | Identical |
| Brand x/y/width/height | 1347.8828125 / 31.25 / 106.1171875 / 37.5 | Identical |
| New invoice / add customer buttons | Recorded exact rectangles | Identical |
| Barber / assistant selectors | Recorded exact rectangles | Identical |
| Hidden original group-toggle controls | Zero bounding boxes | Identical |
| Document width | 1470 | 1470 — no horizontal overflow |
| Sidebar open/closed | Same header/control positions | Identical in both states |

The image loads successfully with natural dimensions 1792 × 878 and `object-fit:contain`. Browser error log was empty at the final check. Full before/after screenshots and JSON rectangles exist for both sidebar states. `after-header.png` is an additional direct browser crop, not an edited asset.

Before, sidebar closed:

![Before](../../.local/omar/cashier-header-logo-1793141274500/before-closed.png)

After, same viewport/state:

![After](../../.local/omar/cashier-header-logo-1793141274500/after-closed.png)

Sidebar open:

![Before open](../../.local/omar/cashier-header-logo-1793141274500/before-open.png)
![After open](../../.local/omar/cashier-header-logo-1793141274500/after-open.png)

## Readability limitation — not silently corrected

Contain sizing in the original 106.12 × 37.5 brand box draws the complete image canvas at approximately **76.54 × 37.5**. Its nontransparent artwork occupies about **61.29 × 36.05**. The tall emblem and intrinsic transparent side margins leave very small lettering. The dark brown “Omar” and “Barber shop” have poor contrast against the existing petrol header; white “Fahim” is more apparent.

The file has ample native resolution and is not stretched or pixel-upscaled, but high resolution does not make its small lettering legible at this footprint. **Do not treat visual readability as approved.** A more compact/high-contrast owner-supplied export, or separate authorization to change the brand display area, would be needed to improve this. Neither was substituted or implemented here.

## Validation and safety

- **68/68 tests passed**, including existing branding/isolation, themes, auth and receipt/retry regressions plus header asset/scope and exact live geometry checks for both sidebar states.
- Mini production build passed: Vite 6.4.1, 1755 transformed modules. Existing >500 KB JS chunk warning remains; no compiler options suppressed.
- Production PNG verified byte-identical to the supplied file.
- `git diff --check` passed; new files checked separately for trailing whitespace.
- Canonical/default Mini, Admin, backend, shared branding mechanism and receipt source remain unchanged from baseline. Plugin returns null outside `app:mini / mode:omar`; Admin never registers it. Print source and existing receipt logo resolver are unchanged. No visual print capture was performed.
- No database access, provisioning, migrations, operational submissions, dependency installs, commit, push or deployment.
- Backend/Admin/Mini still listen only at 127.0.0.1:5104 / 3100 / 5176; original PIDs 84296 / 84314 / 84323 remain. No process was stopped. The normal cashier is left open with sidebar closed.
- Branch remains `feat/omar-fahim-setup`, HEAD `80716b903f2c3cc6640840f5128866458e8b4f85`.

Reproduce the targeted live evidence tests:

```sh
OMAR_HEADER_LOGO_EVIDENCE="$PWD/.local/omar/cashier-header-logo-1793141274500" node --test local/omar/cashier-header-logo.test.mjs
```

Stop after Phase 4B.5A; no other logo, screen or branding work is included.
