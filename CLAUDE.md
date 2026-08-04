# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A vanilla static storefront for the JAGAVE brand — no build step, no package manager, no tests. Three HTML pages (`index.html`, `shop.html`, `product.html`) share one CSS (`style.css`) and one JS bundle (`script.js`). Product data lives in `data.json` and is fetched at runtime by `loadCatalog()`.

## Running locally

There is nothing to install. Serve the directory with any static server, e.g.:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000/index.html`. The cart store uses `localStorage` (key `jagave.cart.v1`), so state persists per-origin. `data.json` is fetched with `cache: 'no-store'`, so changes to the catalog are picked up on reload without a cache-buster.

## Architecture of `script.js`

Everything is wrapped in one IIFE. The boot sequence matters — see the next section.

- `createCartStore()` — vanilla re-implementation of the Zustand-style store described in issue #1. Exposes `getState`, `subscribe`, `addItem`, `removeItem`, `updateQuantity`, `toggleCartDrawer`, and `formatPrice`. The single instance is also hung off `window.useCartStore` for the search/cart UIs.
- `findProductByHandle` / `findProductById` / `findProductByVariant` — pure helpers over `CATALOG.products`.
- Page-specific renderers: `renderShopPreview(cart)` (home page grid), `renderPLP(cart)` (full collection on `shop.html`, targets `[data-plp-grid]`), `renderPDP(cart)` (product page, targets `[data-pdp]`).
- Behaviour modules: `initCursor`, `initHeader` (sticky on `scrollY > 24`), `initMobileDrawer`, `initCartDrawer`, `initSearch`, `initQuickAdd`, `initSmoothScroll`, `initReveal`, `initHeroMotion`, `initTrack`.

### Boot order is load-bearing

`initReveal()` queries every `.reveal` element in the document and attaches an `IntersectionObserver` to each. Because `.reveal` items start at `opacity: 0` (see `style.css`) and only fade in once they get `.is-in`, **anything rendered dynamically after `initReveal()` runs will stay invisible forever**. That is exactly the bug that hid the PLP grid on `shop.html`.

`boot()` runs in this order — do not reorder it without re-checking reveal behaviour:

1. `loadCatalog()` (awaited first; everything below assumes `CATALOG` is populated).
2. Static UI initialisers: `initHeader`, `initMobileDrawer`, `initCartDrawer`, `initSearch`, `initQuickAdd`, `initSmoothScroll`, `initHeroMotion`, `initTrack`.
3. `renderCart` + cart subscription + `syncBagCount`.
4. **Dynamic content renderers**: `renderShopPreview`, `renderPLP`, `renderPDP`. These inject fresh `.reveal` cards into the DOM.
5. **`initReveal()` last**, so the observer sees the freshly added cards.

When adding a new renderer that produces `.reveal` nodes, place it before `initReveal()` and update this list.

## CSS conventions

- All design tokens live under `:root` in `style.css` (colours, fonts, `--ease`, `--dur`, `--max-w`, `--gutter`, `--radius`). Don't hard-code raw hexes or new easings.
- `.reveal` items are hidden via `opacity: 0; transform: translateY(28px)`; `.reveal.is-in` transitions to `opacity: 1; transform: none`. Anything that wants the entrance animation must carry the `reveal` class *before* `initReveal()` runs.
- `html { scroll-behavior: smooth; scroll-padding-top: 80px }` — the `scroll-padding-top` is what compensates for the fixed `.site-header` on every anchor jump (including cross-page links like `shop.html` → `index.html#story`). When `initSmoothScroll` calls `target.scrollIntoView({ block: 'start' })` it relies on this offset — don't remove it.
- `.tile`, `.tile--espresso`/`.tile--cream`/`.tile--ivory`, and the `.is-empty` shimmer on `.tile__placeholder` are how missing product imagery is currently rendered. Don't assume real images exist in `data.json` — every product's `images[]` only has `{id, alt, tone}`.

## Data shape (`data.json`)

```jsonc
{
  "store":  { "currency": { "code": "INR", "symbol": "₹" }, "free_shipping_threshold": 2300 },
  "products": [
    {
      "id", "handle", "title", "subtitle", "tag", "category", "formula_no",
      "description",
      "images":   [{ "id", "alt", "tone" }],
      "variants": [{ "id", "title", "flavour", "delivery", "subscription",
                     "subscription_label", "price", "compare_at_price", "sku" }],
      "specs":    { "format", "base", "peptides", "glutathione" },
      "ingredients": [{ "name", "origin", "dose" }],
      "ritual":   [{ "title", "detail" }],
      "shipping": "..."
    }
  ]
}
```

Currency is hard-coded to INR (`CURRENCY` in `script.js`); `free_shipping_threshold` is mirrored in `FREE_SHIPPING_THRESHOLD`. Update both together if the store config changes.

## CI / automated edits

`.github/workflows/ai-edit-trigger.yml` runs Claude Code against the repo whenever a GitHub issue gets the `ai-edit` label. The agent commits a draft PR on branch `ai/minimax-issue-<n>` with message `fix: address issue #<n>`. **Do not modify anything under `.github/workflows/`** unless the issue explicitly requires it — the workflow will reject secrets-bearing files (`.env*`, `*.pem`, `*.key`, `id_rsa*`, `id_ed25519*`) and will fail if the agent makes no file changes.