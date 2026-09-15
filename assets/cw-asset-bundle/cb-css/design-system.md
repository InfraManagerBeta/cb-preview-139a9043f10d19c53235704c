# Cheddar Battles — Design System

**Purpose:** Hand this document to Claude Design, Stitch, Lovable, or any designer/AI to build a **landing page** that matches the live product (Next.js gate at `/play` + game at `/cheddar-battles-v1.0.html`).

**Product:** Cheddar Battles — skill-based speculative entertainment; bracket wizard duels with high-contrast “arena / arcade / sports ledger” visuals (not minimal corporate SaaS).

---

## 1. Brand identity

| Element | Guidance |
|--------|------------|
| **Name** | Cheddar Battles |
| **Tagline** | Skill-based speculation |
| **Category voice** | Sportsbook energy + mobile game HUD + Vegas ticker — loud, direct, legible at a glance |
| **Headlines** | UPPERCASE, Bebas Neue, tight leading, letter-spacing ~2px on large display lines |
| **Labels / legal / micro** | UPPERCASE, DM Mono, wide tracking (`0.08em`–`0.2em`), small sizes (9–11px) |
| **Body** | Barlow, semibold for marketing lines where appropriate; short sentences |
| **Sample copy** (from gate) | “Outsmart your opponent. Win the Cheddar.” / “Five rounds. One winner.” |

**Tone:** Confident, competitive, slightly irreverent. Avoid generic startup gradients and “friendly rounded SaaS” tropes.

---

## 2. Color palette

### 2.1 Core tokens (canonical)

Use these as the single source of truth. Next app mirrors them in `app/globals.css` as `--cb-*`; the game uses the same hex in `:root`.

| Token | Hex | Usage |
|-------|-----|--------|
| **Cheddar Yellow** | `#FFE500` | Primary accent, CTAs, key headlines on dark, borders |
| **Near Black** | `#0A0A08` | Primary dark background, text on yellow, button borders |
| **Fire Red** | `#D41E30` | Errors, danger, loss / red screens |
| **Fire Red (bright)** | `#E8283C` | Hot accents, fire affinity, red button border |
| **Offwhite** | `#F5F0E8` | Body text on dark, wizard cards, light surfaces |
| **Victory Green** | `#28C840` | Wins, cash-out hero, earth / success |
| **Water Blue** | `#1A9FD4` | Water affinity, cool accents |
| **Mold Teal** | `#3ABCBC` | Tertiary accent |
| **Ash** | `#707070` | Placeholders, muted UI |
| **Ash Light** | `#B0B0B0` | Secondary muted text |

**CSS variables (Next — `app/globals.css`):**

```css
--cb-yellow:   #ffe500;
--cb-black:    #0a0a08;
--cb-red:      #d41e30;
--cb-offwhite: #f5f0e8;
```

**CSS variables (game — `public/cheddar-battles-v1.0.html`):** `--yellow`, `--black`, `--red`, `--green`, `--blue`, `--mold`, `--ash`, `--ash-light`, `--offwhite`, `--fire-red` — same values as above.

### 2.2 Surfaces and neutrals (game UI)

Use sparingly on a landing page for depth / device chrome:

| Hex | Role |
|-----|------|
| `#111` | Desktop backdrop outside phone frame |
| `#1a1a1a`, `#333` | Bezel / heavy borders |
| `#222`, `#444` | Dark UI borders, tracks |
| `#fff` | White cards, text on dark screens |
| `#ddd`, `#ccc`, `#e8e8e8` | Light dividers |
| `#555`, `#888`, `#aaa` | Muted controls |

### 2.3 Semantic tints (affinity / panels)

| Tint | Hex | Use |
|------|-----|-----|
| Fire panel | `#ffefef` | Behind fire-themed art |
| Water panel | `#e8f4ff` | Behind water-themed art |
| Air panel | `#eeffee` | Behind air-themed art |
| Focus wash (inputs) | `rgba(255, 229, 0, 0.05)` | Focus background on yellow-bordered fields |

### 2.4 Grid textures (backgrounds)

- **On yellow screens:** `repeating-linear-gradient` with `rgba(0,0,0,0.05)` lines, **32px** grid.
- **On dark / red screens:** same pattern with `rgba(255,255,255,0.06)` lines, **32px** grid.

Overlay: full-bleed `::before` on section, `pointer-events: none`, `inset: 0`.

---

## 3. Typography

### 3.1 Font families

| Role | Family | Weights | Notes |
|------|--------|---------|--------|
| **Display / HUD** | **Bebas Neue** | 400 | Headings, scores, primary buttons, “CHEDDAR BATTLES” |
| **Mono / ticker** | **DM Mono** | 400, 500 | Tags, stats, inputs, errors, uppercase labels |
| **Body** | **Barlow** | 400, 600 (+ italic 400 in game) | Paragraphs, rules, narration tone |
| **Display accent** | **Pirata One** | 400 | **Game only today** — oversized “BIG” style moments; optional on landing for one hero word if it fits the pirate/street edge |

**Google Fonts import (game reference):**

`Bebas Neue`, `DM Mono` (400,500), `Barlow` (400,600 + italic), `Pirata One`.

**Next.js (`app/layout.tsx`)** loads Barlow, Bebas Neue, DM Mono via `next/font/google` with CSS variables:

- `--font-barlow`
- `--font-bebas`
- `--font-dm-mono`

### 3.2 Type scale (reference values)

**Email gate (`app/play/play-gate.tsx`) — landing-adjacent:**

| Element | Font | Size / style |
|---------|------|----------------|
| Title “CHEDDAR / BATTLES” | Bebas | `64px`, `leading-none`, `tracking-[2px]`, color `#FFE500` |
| Tagline “Skill-based speculation” | DM Mono | `10px`, uppercase, `tracking-[0.12em]`, ~50% opacity |
| Body hook | Barlow | `text-lg` (18px), `font-semibold`, `leading-snug`; accent line in `#FFE500` |
| Email input | DM Mono | `text-sm` (14px), centered |
| Primary button | Bebas | `22px`, `tracking-[2px]` |
| Error | DM Mono | `11px`, `#D41E30` |
| Footer disclaimer | DM Mono | `9px`, ~30% opacity |

**Game patterns (for longer landing sections):**

- Stat labels: DM Mono **7px**, `letter-spacing: 0.2em`, uppercase, muted black 50%.
- Default `.btn`: Bebas **18px**, `letter-spacing: 0.04em`.
- Wizard badges: DM Mono **9px**, `letter-spacing: 0.08em`.

**Display accent (game):** Pirata One at `clamp(72px, 20dvh, 130px)` for hero words — use only if you load the font.

### 3.3 Line height & tracking

- Display headlines: `line-height: 1` or `1.1`.
- Body: `1.375`–`1.5` (`leading-snug` in Tailwind).
- Uppercase mono: `0.08em`–`0.2em` letter-spacing.

---

## 4. Spacing & layout

### 4.1 Content width (critical)

- **Max content width:** **390px** — matches the in-game phone frame (`#device`: 390×844). Single-column marketing should align to this or scale up proportionally on desktop with the same proportions.

### 4.2 Gate spacing (reference)

- Page: full viewport center (`min-height: 100dvh`, flex center).
- Container: `max-width: 390px`, horizontal padding **24px** (`px-6`), vertical **40px** (`py-10`).
- Form: **12px** gap between stacked fields (`gap-3`).
- Section breaks: **32px** (`mb-8`) between headline block and form.

### 4.3 Game reference (optional for “app preview” sections)

- Device: **44px** border-radius on desktop; full bleed on viewports ≤430px.
- Bottom action bar: `padding: 12px 16px 28px`, internal `gap: 8px`.
- Scroll areas: extra `padding-bottom: 180px` when content clears fixed bottom bars.

---

## 5. Component patterns

All buttons and CTAs share a **hard offset shadow** (no blur). Borders are **2–3px** solid.

### 5.1 Primary button (email gate)

- Background: `#FFE500`
- Text: `#0A0A08`
- Border: **3px** solid `#0A0A08`
- Font: Bebas, **22px**, `letter-spacing: 2px`
- Shadow: **`3px 3px 0 #0A0A08`**
- Hover: translate **`(-1px, -1px)`**, shadow **`4px 4px 0 #0A0A08`**
- Active: translate **`(2px, 2px)`** (Tailwind `0.5` = 2px), shadow **`1px 1px 0 #0A0A08`**
- Transition: **`transform, box-shadow`**, **100ms**
- Disabled: **60%** opacity, no pointer events

### 5.2 Text input (email gate)

- Background: transparent
- Border: **3px** `#FFE500`
- Text: `#F5F0E8`, centered, DM Mono, **14px**
- Placeholder: `#707070`
- Focus: background `rgba(255, 229, 0, 0.05)`
- Padding: **14px** vertical, **16px** horizontal (`py-3.5 px-4`)

### 5.3 Game `.btn` variants (secondary patterns)

- Padding: **14px 20px**, full width in stack.
- Border: **2px**; on `:active`: **`translate(2px, 2px)`** and **remove** shadow.
- **`.btn-yellow`:** yellow fill, black border, `box-shadow: 3px 3px 0 rgba(0,0,0,0.2)`.
- **`.btn-black`:** black fill, white text, `3px 3px 0 rgba(0,0,0,0.3)`.
- **`.btn-outline-black` / `.btn-outline-white`:** transparent fill, 2px contrasting border (no block shadow unless you add for parity).

### 5.4 Landing CTAs inside game (`.s0-cta`)

- Border: **3px** solid black
- Shadow: **`4px 4px 0 rgba(0,0,0,0.25)`**
- Primary: black bg, white text; **bounce** animation loop (`ctabounce` ~3s, infinite after delay).
- Secondary: transparent bg, black text; **no** bounce.
- `:active`: `translate(2px, 2px)`, shadow `2px 2px 0`.

### 5.5 Selectable card (`.wiz-card`)

- Background: `#F5F0E8`, border **2px** `#0A0A08`
- Selected: **`translate(-3px, -3px)`**, **`box-shadow: 5px 5px 0 var(--black)`**
- Dead state: **45%** opacity, **grayscale**, diagonal stripe overlay — use only if you show “eliminated” concepts.

### 5.6 Bottom bar (game)

- **`.bb.yellow-bar`:** yellow background, **2px** top border black.
- **`.bb.dark-bar`:** black background, **2px** top `#222`.

---

## 6. Visual signature — do & don’t

### Do

- **Hard offset shadows** (`3px 3px 0` or `4px 4px 0`) in near-black or rgba black — never soft Gaussian “Material” shadows as the primary language.
- **Thick borders** (2–3px) and **high contrast** (yellow ↔ black ↔ offwhite).
- **Uppercase + letter-spacing** on Bebas headlines and DM Mono labels.
- **Grid texture** on large yellow or dark hero sections (32px grid, low-contrast lines).
- **Optional:** radial “starburst” SVG behind a central symbol (yellow fill `#FFE500`, stroke `#0A0A08`) — matches game landing.
- **390px** mental model: one strong column; on wide screens, center it or show device frame.

### Don’t

- Thin 1px hairlines as the main UI chrome.
- Pastel-only palettes or low-contrast “calm” neutrals as the dominant look.
- Pill-shaped iOS-default buttons without the offset shadow language.
- Generic purple gradients / glassmorphism that reads “default AI landing page.”

---

## 7. Motion & animation

| Name | Behavior | Duration / loop |
|------|----------|-------------------|
| **Button hover** | `translate` + larger offset shadow | **100ms** (gate); game buttons **0.1s** |
| **`fu` (fade up)** | opacity 0→1, `translateY(12px)`→0 | **0.4s** ease |
| **`starspin`** | rotate 360° | **20s** linear infinite |
| **`wizleft` / `wizright`** | enter from ±30px | opacity + translate |
| **`titleup` / `prizeup`** | fade up from 20px / 12px | staged delays on landing |
| **`coinpop`** | scale from 0.4 | center pop |
| **`ctabounce`** | subtle vertical bump | **3s** ease, infinite (primary CTA only) |
| **`divgrow`** | scaleX 0→1 from left | line reveals |

**Principle:** Motion is **snappy** (0.1–0.15s) for interaction; **slow** (3–20s) only for ambient decoration. Prefer `transform` and `box-shadow` over animating layout.

---

## 8. Brand assets & imagery

| Asset | Notes |
|-------|--------|
| **Favicon** | `https://www.cheezewizards.com/static/favicon/favicon.png` (Cheeze Wizards lineage) |
| **Wizard portraits** | SVGs from `https://storage.googleapis.com/cheeze-wizards-production/original/0xec2203e38116f09e21bc27443e063b623b01345a/<id>.svg` — **IP / licensing**: confirm usage for external marketing; for internal/aligned landing, match game URLs. |
| **Emoji** | Game uses 💰 (prize), 🧀 (bracket) — optional flavor, not required for minimal landing. |

No standalone logo file in repo; **wordmark = Bebas “CHEDDAR BATTLES”** treatment is the primary lockup.

---

## 9. Accessibility notes

- Maintain **4.5:1** contrast for body copy: offwhite `#F5F0E8` on `#0A0A08` is strong; yellow `#FFE500` on black for **large** display type only — use offwhite or black text for long paragraphs on yellow.
- Focus states: visible border + optional yellow wash (see input focus).
- Don’t rely on color alone for errors — include text (DM Mono, red).

---

## 10. Implementation reference (repo)

| File | What to copy from |
|------|-------------------|
| [app/globals.css](../app/globals.css) | `--cb-*` variables |
| [app/layout.tsx](../app/layout.tsx) | Font loading → CSS variables |
| [app/play/play-gate.tsx](../app/play/play-gate.tsx) | Current “mini landing” / gate UI tokens |
| [public/cheddar-battles-v1.0.html](../public/cheddar-battles-v1.0.html) | Full `:root` system, grids, buttons, keyframes, device frame |

---

## 11. One-line brief for AI tools

> Build a **390px-centered**, **high-contrast** landing page: **#0A0A08** background, **#FFE500** accents, **Bebas Neue** headlines (uppercase, tracked), **DM Mono** labels, **Barlow** body; **2–3px** borders and **3–4px hard offset shadows** (no soft blur); optional **32px grid texture** on hero; match copy tone: *skill-based speculation*, competitive, arena energy.
