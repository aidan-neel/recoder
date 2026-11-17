---
name: giga-ui
description: Use when building, redesigning, or polishing any user interface (a component, app screen, dashboard, landing page, mobile UI, onboarding or auth flow), especially from a short or vague prompt. Provides universal UI craft, typography, layout, component composition, motion, micro-interaction, anti-slop, and visual QA rules that adapt to any project's design system and tokens instead of forcing a single monochrome look.
---

# GIGA UI: calm, precise, alive (style-adaptive edition)

This skill turns a short or open-ended UI request into a calm, precise, production-grade interface. Originally distilled from high-craft product UI (@marcelkargul, Emil Kowalski, Motion docs, Apple HIG), **this edition decouples the craft from any single monochrome palette or shadow style** so it works cleanly with **any design system** — dark-first or light-first, warm or cool, flat hairlines or soft elevation, minimal neutral or chromatic brand palettes.

> Provenance tags used below:
> **[system]** defer to the host project's design system, tokens, and component kit first.
> **[craft]** observed visual, layout, or typographic craft rule that holds across styles.
> **[expert]** motion, interaction, accessibility, and engineering best practice (Motion docs, Emil Kowalski, Apple HIG).
> **[X]** anti-slop signal repeatedly called out in public design critiques.

---

## 0. Adopt the host design system first **[system]**

Before writing markup, styles, or animations, inspect the project so your output looks native to it on the first pass:

1. **Read the project's UI rules and design specs** (e.g. `AGENTS.md`, `DESIGN.md`, app-specific `DESIGN.md` files such as `apps/app/DESIGN.md`). Where a project spec and a generic default in this skill disagree, **the project spec wins**.
2. **Locate the token files and theme architecture** (`tokens.css`, `palettes.css`, `appearance.css`, `app.css`, `@theme` blocks). Always reference semantic CSS custom properties or mapped utility classes — never paste raw hex colors, raw pixel radii, or raw millisecond durations into components.
3. **Inventory the shared UI kit before building** (e.g. `@recoder/ui` in `packages/ui`, `@sivir-ui/svelte`, Radix / Base UI / Bits UI wrappers, shared `motion/presets.ts`). Reuse kit primitives for every control, surface, and overlay; restyle via tokens and `data-ui` / `data-variant` / `data-state` hooks rather than forking or hand-rolling raw `<div>` / native controls. If two places need a missing piece, add it to the shared kit.
4. **Match the project's structural & behavioral choices:**
   - **Palette & themes:** Support every shipped theme and palette (`dark`, `light`, `[data-palette]` variants). Never assume a light canvas, a pure-black button, or a single fixed accent hue.
   - **Depth model:** If the system is **flat with 1px hairlines** (shadows reserved strictly for floating overlays like menus, popovers, dialogs, tooltips, and toasts), never add drop shadows, bevels, sheens, or gradients to buttons, cards, panels, or composers. If the system uses soft layered elevation, use its shadow tokens.
   - **Shell:** Keep the app's established shell (left sidebar shell vs. top-bar tab shell — never introduce a sidebar into a top-bar-only app or vice versa).
   - **Motion & loading:** Follow the system's motion tokens and rules — e.g. whether press shades in place (`scale: 1`) or scales slightly, whether active tabs/segments fill in place or slide a shared pill, and whether skeletons swap to content in place with zero entrance animation or crossfade.
5. **Greenfield fallback:** Only when a project has **no** existing design system, tokens, or kit, define the semantic token layer in §3.2 first and build exclusively against those variables so the visual style stays swappable in one place.

Companion skills when present (`better-ui`, `emil-design-eng`) sharpen polish and animation feel; apply their details within the host design system's rules.

---

## 1. Design philosophy

1. **If it can be removed, remove it.** **[craft]** Every screen, component, and frame: delete any divider, wrapper box, icon, badge, subtext line, or decorative color that does not carry information or affordance. Merge redundant actions.
2. **Typography does the heavy lifting.** **[craft]** Clear hierarchy comes from deliberate size steps, at most **2 working weights** in product UI (plus a reserved heading/metric weight when the system defines one), disciplined line-height, and size-dependent tracking — using the project's designated type voices (`--font-ui`, `--font-code`, and any role-specific voice such as `--font-ai` / display serif).
3. **Color carries meaning; surfaces carry atmosphere.** **[system/craft]** Let the design system's surface and hairline ladder establish mood and structure (warm near-black, neutral graphite, tinted stone/pine/cobalt, warm paper, or crisp white). Reserve distinct color for **semantic meaning** (severity, pass/fail, diffs, destructive actions), **one primary action per region** (`--primary` / `--on-primary`), and **the designated accent** (`--accent` for links, selection, or chart series). Non-status metadata stays neutral, differentiated by icon or monospace type.
4. **Depth comes from tonal steps and 1px hairlines, not heavy borders.** **[craft]** Separate regions with subtle surface steps, whitespace, and 1px hairlines (`--line-*` or inset `0 0 0 1px` rings). Reserve shadows for elevated layers defined by the design system.
5. **Motion explains change and respects frequency.** **[expert]** Animate to confirm an action, show spatial origin, or preserve continuity — then get out of the way. Controls opened hundreds of times a day stay fast (`≤ 150–200ms`) or instant.
6. **Craft the last 10% by hand.** **[craft]** Run the interaction checklist (§6), anti-slop pass (§8), QA list (§9), and real-browser screenshot verification (§9.5) before finishing.
7. **Calm beats clever.** **[craft]** Quiet at rest (ghost and quiet triggers stay transparent until hovered; one primary CTA per region), unmistakable when something needs attention.

---

## 2. Visual language (style-adaptive rules)

### 2.1 Typography
- **Typeface roles **[system]**:** Always use the project's font tokens:
  - **UI sans (`--font-ui` / `--font-sans`):** Primary interface text, labels, controls, navigation, and tables. Never hardcode a font name when a token or appearance setting can swap it (e.g. Inter, Geist, Cal Sans, SF Pro Rounded on native-feel mobile).
  - **Monospace (`--font-code` / `--font-mono`):** Code, diffs, file paths, branches, commit hashes, CLI commands, shortcut keycaps, token/context counts, and aligned figures where specified.
  - **Editorial / AI / display voice (`--font-ai` / `--font-display`, optional):** If the design system assigns a distinct serif or display voice to specific surfaces (e.g. summaries, findings, briefs, or hero headlines), use it *only* on those designated roles and **never mix two voices inside one block**. Use `text-wrap: pretty` on editorial/serif paragraphs and `text-wrap: balance` on multi-line display headings.
- **Tracking scale **[craft]**:**
  - `≤ 16px` (body, labels, controls, metadata): `0` — **never** put negative tracking on body copy.
  - `18–24px` (page & section titles): `-0.01em` (`-1%`).
  - `~32–40px` (large titles, hero KPIs): `-0.03em` (`-3%`).
  - `72–100px+` (marketing display headlines only): `-0.05em` to `-0.06em`.
- **Weights **[craft]**:** Regular (`400`) and Medium (`500`) carry almost all product UI. Semibold (`600`) is reserved for page titles, markdown headings, and key summary figures when the design system uses it. Keep body screens to 2 working weights.
- **Scale & rhythm **[system/craft]**:** Use the project's font-size tokens (typically compact desktop body `13–14px`, controls/labels `12.5–13.5px`, metadata `11.5–12px`, badges `11–12px`, page titles `18–20px` or system equivalent) — do not invent half-steps between tokens. Line-height rules of thumb when un-tokenized: body `1.45–1.55`, UI labels `1.3`, headings `1.1–1.2`, display `1.0–1.05`.
- **Numbers & OpenType **[craft]**:** Any number that lines up vertically, updates live, or sits in a badge/chart/table uses `font-variant-numeric: tabular-nums` (`.tabular`). Only enable OpenType stylistic sets (`cv*`, `ss*`) if the project's shipped font files actually include them.
- **Headings **[system]**:** Follow the project's heading convention — if headings are title-only with no subtitle, never add explanatory taglines underneath.

### 2.2 Color, themes, and palettes
- **Token-driven roles, never raw hex **[system]**:**
  - **Surfaces (stepped ladder):** `chrome` / `backdrop` → `canvas` → `panel` → `raised` / `card` → `raised-2` / `code` → `menu` / `popover` → `hover` → `selected` → `field`. In dark themes, surfaces step in subtle luminance increments rather than flat `#000000` everywhere; in light themes, canvas and panels separate cleanly via subtle warmth or cool neutral steps.
  - **Hairlines:** `divider` → `subtle` → `card` → `control` → `menu` → `focus`. Prefer tonal surface steps and whitespace first; use 1px hairlines where structural edges or interactive bounds need crispness.
  - **Text hierarchy:** `primary` → `secondary` → `muted` → `subtle` → `faint` / `ghost`. Keep body copy `≥ 4.5:1` contrast against its surface; use `faint` and `ghost` strictly for non-essential metadata, timestamps, or placeholders.
  - **Primary action:** `--primary` paired with `--on-primary` (computed or tokenized for `≥ 4.5:1` contrast whether `--primary` is cream, near-black, cobalt, blue, brass, mint, or brand violet). Never hardcode white or black label text on a primary button; always pair `--primary` with `--on-primary`.
  - **Single accent:** `--accent` (`--accent-text`, `--accent-tint`) for links, active selections, diff hunk markers, or focus accents — one intentional accent role per view, never competing rainbow accents.
  - **Semantic status & severity **[craft]**:** High/danger, medium/warning, low/info, and success badges always render **high-contrast colored/tinted text over a soft translucent tint of the same hue** (`≥ 4.5:1`–`5:1` on the underlying surface) — **never white text on a saturated pill fill**.
  - **Data visualization:** Use ordered series tokens (`--chart-1` through `--chart-6`) verified for contrast and color-vision distinction; fold excess series past the cap into a single neutral "others" group, and link legend hover to series highlight so hue never means two different things on one screen.
- **Gradients & effects **[system]**:** Do not put gradients on buttons, text, cards, or app surfaces unless the host design system explicitly defines them. Avoid glow orbs, neon washes, glassmorphism, or decorative grain in product UI (the one common exception is a subtle `transparent → var(--bg-canvas)` scroll mask behind a floating composer when specified by the design system).

### 2.3 Shape, spacing, and density
- **4px spatial grid **[craft]**:** Use multiples of `4px` (`4, 8, 12, 16, 24, 32, 48…`). Gaps *inside* a related group must be tighter than gaps *between* groups so hierarchy reads before any border is drawn.
- **Radius scale & concentric corners **[system/craft]**:** Use the design system's radius tokens (`--radius-chip`, `--radius-control`, `--radius-row`, `--radius-card`, `--radius-composer`, etc.) — whether tight (`4–8px`), medium (`6–14px`), or roomy (`10–24px`). Whenever one rounded element sits inside another, enforce **concentric radii**: `outer radius = inner radius + inset padding` (e.g. a `4px` menu row inside a `4px`-padded menu sits in an `8px` panel).
- **Control sizing **[system]**:** Default to the kit's standard control height (`size="md"`, omitting the `size` prop when `md` is already the default). Reserve `sm` for inline text actions or dense toolbars. Square icon-only buttons stay at least `28×28px` on desktop (`size="icon"`) and `44×44px` hit targets on touch layouts.
- **One box level **[craft]**:** Never nest cards inside cards inside cards. Give a view at most one container tier (or none at all), and group content inside it with whitespace, section labels, and 1px hairlines. Inner bordered boxes belong to code blocks, diffs, terminal output, or distinct settings groups.
- **Shared structural lanes **[craft]**:** Align header bar heights across adjacent panes (e.g. `44px` page bar, panel header, and diff header) so bottom borders form one unbroken line. Measure left lanes with `getBoundingClientRect()` rather than eyeballing.
- **Viewport scaling **[system]**:** If the project scales large viewports (`1920px+`, `2400px+`) via root `rem` compilation, author CSS in `px` as normal, scale JS pixel constants by the root font ratio, and **never** use CSS `zoom` (which breaks Floating UI / Radix positioning).

### 2.4 Layout patterns
Pick the pattern that matches the host product and screen type:
- **App shell (sidebar or top-bar) **[system]**:**
  - *Sidebar shell:* `~240–264px` sidebar (e.g. `248px` `--sidebar-width`), `44px` top page bar (`--bar-height`) with breadcrumbs left and page-level actions right, content aligned cleanly underneath. May be **flush** (sidebar on `--bg-panel`, 1px `--line-divider`, content on `--bg-canvas`) or **inset** (sidebar on `--bg-chrome`, content in an inset `--bg-canvas` card with `8px` margin and card radius).
  - *Top-bar shell:* Compact top bar (`~44–46px` on `--bg-chrome`) with wordmark/home, session/view tabs that overflow into a menu instead of clipping, collapsible search, and utilities over an inset or full canvas.
- **Dense list & detail views:** Hairline-divided rows, no zebra striping, consistent left lanes, right-aligned tabular figures or status pills, keyboard `j`/`k` navigation, and inline or tabbed detail views (e.g. Changes, Summary, Bugs/Findings, Commits, Ask).
- **Settings & configuration columns:** A single centered max-width column (e.g. `~704px`) of titled groups (`SettingsPage` / `SettingsGroup` / `SettingsRow`), label + optional rule-passing subtext on the left, control + inline save feedback on the right, sharing crisp left/right column edges.
- **Analytics & usage views:** Wider single column (e.g. `~920px`) grouped by whitespace and hairlines rather than nested cards: headline figure + breakdown rows linked on hover with a multi-series chart, followed by hairline tables with proportional bars.
- **Focused creation / prompt screen:** Centered composer slightly above optical midpoint (`~42%` height) with quiet scope/target triggers on its leading edge, mode switch on its trailing edge, and actionable recent/unreviewed items below that never shift the composer's position.
- **Command palette / searchable model or entity picker:** `⌘K`-style dialog (`~520–560px` wide, capped height), instant search across name/provider/group, grouped list scrolled to the active selection on first frame, and keyboard legend footer (`↑↓` navigate, `↵` choose, `esc` close).

### 2.5 Iconography and brand marks
- Use **one** outline icon family and **one** stroke weight across the entire product, matching the design system (e.g. Lucide at `1.75` stroke and `12–16px`, or the project's chosen set at `1.5–1.75` stroke).
- Color icons with `currentColor`, muted at rest (`--text-muted` / `--text-subtle`) and brightening on hover/active; reserve semantic color on icons for status/severity glyphs and explicit brand marks.
- Respect brand restraint: if the product uses a wordmark only and forbids AI avatars/sparkles next to model output, never add decorative marks or AI stars.

---

## 3. Design tokens: map first, invent last

### 3.1 Mapping to an existing design system **[system]**
Before writing styles, locate the repo's tokens and map your mental model onto them:

| Role | Typical project tokens (e.g. Recoder) | Rule |
|---|---|---|
| Surfaces | `--bg-chrome`, `--bg-canvas`, `--bg-panel`, `--bg-raised`, `--bg-raised-2`, `--bg-menu`, `--bg-hover`, `--bg-selected`, `--bg-field` | Step surfaces tonally; never hardcode `#fff` or `#111`. |
| Hairlines | `--line-divider`, `--line-subtle`, `--line-card`, `--line-control`, `--line-menu`, `--line-focus` | Draw control rings inset (`box-shadow: inset 0 0 0 1px …` or kit token) so edges align. |
| Text | `--text-primary`, `--text-secondary`, `--text-muted`, `--text-subtle`, `--text-faint`, `--text-ghost` | Body `≥ 4.5:1`; `faint`/`ghost` for metadata only. |
| Primary & accent | `--primary`, `--primary-hover`, `--on-primary`, `--accent`, `--accent-text`, `--accent-tint` | One primary CTA per region; always pair `--primary` with `--on-primary`. |
| Status & severity | `--sev-high` / `--danger`, `--sev-medium`, `--sev-low`, `--sev-info`, `--success` + `*-tint` | Tinted text on matching `-tint` fill; contrast-checked across dark, light, and palettes. |
| Elevation | `--shadow-menu`, `--shadow-modal`, `--shadow-composer`, `--scrim` | Only floating layers cast shadows when the design system is flat. |
| Type & sizes | `--font-ui`, `--font-code`, `--font-ai`, `--font-size-*` | Respect user-selectable font/palette attributes (`[data-palette]`, `.dark`). |
| Radii & motion | `--radius-chip`, `--radius-control`, `--radius-row`, `--radius-card`; `--dur-*`, `--ease-*` | Never write raw `px` radii or raw `ms` durations when tokens exist. |

### 3.2 Greenfield starter tokens (only when the project has none)
If building standalone UI in a repo with zero tokens, create a semantic token block first so palette, surface warmth, elevation style, and corner tightness remain decoupled from component markup:

```css
:root {
  /* Typography */
  --font-ui: "Inter", "Geist", ui-sans-serif, system-ui, -apple-system, sans-serif;
  --font-code: "Geist Mono", ui-monospace, "SF Mono", Menlo, monospace;

  --font-size-xs: 11.5px; --font-size-meta: 12px; --font-size-label: 13px;
  --font-size-body: 13.5px; --font-size-title: 18px; --font-size-display: 32px;
  --tracking-body: 0; --tracking-tight: -0.01em; --tracking-title: -0.03em; --tracking-display: -0.055em;

  /* Surfaces & lines (light default; swap block or flip root class for dark-first) */
  --bg-chrome: #f6f6f6; --bg-canvas: #ffffff; --bg-panel: #fafafa;
  --bg-raised: #ffffff; --bg-menu: #ffffff; --bg-field: #ffffff;
  --bg-hover: rgb(0 0 0 / 0.04); --bg-selected: rgb(0 0 0 / 0.07);
  --line-divider: #efefef; --line-card: #e6e6e6; --line-control: #dedede;
  --line-menu: #dadada; --line-focus: #a3a3a3;

  /* Text */
  --text-primary: #171717; --text-secondary: #333333; --text-muted: #5c5c5c;
  --text-subtle: #6b6b6b; --text-faint: #858585;

  /* Primary & accent (swap per brand without touching components) */
  --primary: #171717; --primary-hover: #000000; --on-primary: #ffffff;
  --accent: #2563eb; --accent-text: #1d4ed8; --accent-tint: rgb(37 99 235 / 0.10);

  /* Semantic (text on soft tint) */
  --success: #136a2d; --success-tint: rgb(26 127 55 / 0.11);
  --danger: #ac2723;  --danger-tint: rgb(196 48 43 / 0.10);
  --sev-medium: #805300; --sev-medium-tint: rgb(214 140 0 / 0.14);
  --sev-low: #1d4ed8;    --sev-low-tint: rgb(37 99 235 / 0.10);

  /* Radii & heights (tune per product aesthetic: crisp 4–8px vs soft 8–16px) */
  --radius-chip: 4px; --radius-control: 6px; --radius-row: 6px; --radius-card: 10px;
  --h-control-sm: 24px; --h-control-md: 28px; --h-control-lg: 34px;

  /* Elevation: flat rings by default; floating shadows for overlays */
  --shadow-card: 0 0 0 1px var(--line-card);
  --shadow-menu: 0 0 0 1px var(--line-menu), 0 8px 24px rgb(0 0 0 / 0.12);
  --shadow-modal: 0 0 0 1px var(--line-control), 0 24px 60px rgb(0 0 0 / 0.18);

  /* Motion */
  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
  --ease-menu: cubic-bezier(0.2, 0.8, 0.2, 1);
  --dur-hover: 80ms; --dur-press: 80ms; --dur-menu: 130ms; --dur-disclose: 200ms;
}

.dark, [data-theme="dark"] {
  --bg-chrome: #161616; --bg-canvas: #111111; --bg-panel: #141414;
  --bg-raised: #1a1a1a; --bg-menu: #1c1c1c; --bg-field: #161616;
  --bg-hover: rgb(255 255 255 / 0.05); --bg-selected: rgb(255 255 255 / 0.09);
  --line-divider: #1c1c1c; --line-card: #252525; --line-control: #2b2b2b;
  --line-menu: #2f2f2f; --line-focus: #474747;
  --text-primary: #ededed; --text-secondary: #cfcfcf; --text-muted: #a1a1a1;
  --text-subtle: #8a8a8a; --text-faint: #737373;
  --primary: #f2f0eb; --primary-hover: #ffffff; --on-primary: #111111;
  --accent: #5b9dff; --accent-text: #8dbbff; --accent-tint: rgb(91 157 255 / 0.12);
  --success: #62e0a6; --success-tint: rgb(61 214 140 / 0.13);
  --danger: #ff8a8f;  --danger-tint: rgb(255 99 105 / 0.13);
  --sev-medium: #f8c46b; --sev-medium-tint: rgb(245 165 36 / 0.14);
  --sev-low: #8dbbff;    --sev-low-tint: rgb(91 157 255 / 0.14);
  --shadow-menu: 0 0 0 1px var(--line-menu), 0 8px 24px rgb(0 0 0 / 0.45);
  --shadow-modal: 0 0 0 1px var(--line-control), 0 12px 36px rgb(0 0 0 / 0.45);
}

.tabular { font-variant-numeric: tabular-nums; }
```

---

## 4. Component patterns & recipes (kit-first, token-driven)

**Hard rule **[system]**:** When the project has a component kit (e.g. `@recoder/ui` for React, `@sivir-ui/svelte` for Svelte), **always compose from the kit** (`Button`, `Modal`, `ConfirmDialog`, `Popover`, `Tooltip`, `DropdownMenu`, `Select`, `CommandDialog`, `Input`, `Textarea`, `LinkField`, `Composer`, `Switch`, `Checkbox`, `SegmentedControl`, `Card`, `Pill`, `Collapsible`, `ClampedText`, `ScrollArea`, `Skeleton`, `HoverList`, `LineChart`, `StackedBar`, etc.). Use the CSS/JSX snippets below only when extending a kit primitive or working in a greenfield repo without one.

### 4.1 Buttons & async action states
- **Hierarchy **[craft]**:**
  - `primary` (`--primary` / `--on-primary`): **at most one per region or dialog**, never repeated down every row of a list.
  - `secondary` / `outline`: paired beside a primary button, or used as a standalone row/notice action (inset 1px `--line-control` hairline; transparent or subtle wash at rest).
  - `ghost`: muted text (`--text-muted` / `--text-subtle`), transparent at rest, subtle wash (`--bg-hover`) on hover — for tertiary controls, row actions, and icon buttons.
  - `quiet`: full-strength or muted value label, transparent at rest, `--bg-hover` on hover and `--bg-selected` while its menu is open — for filter chips, model pickers, and scope triggers.
  - `destructive`: `--danger` text on `--danger-tint`, reserved for irreversible delete confirmations.
- **Optical icon padding **[craft]**:** Give the side holding a leading/trailing icon ~`2px` less horizontal padding than a text-only side so the icon and label feel balanced.
- **Surface & press behavior **[system]**:** Follow the host design system:
  - *Flat tool style (e.g. Recoder):* Solid fill or inset hairline only — no gradients, no drop shadows, no inner highlight, and **no press scale** (press shades a step deeper within `--dur-press`).
  - *Tactile / elevated style (only when specified by the design system):* Subtle layered ring/shadow and gentle press scale (`0.96–0.97`, never `< 0.95`).
- **Fixed-width async states **[craft/expert]**:** Every async button shows `idle → pending (spinner) → success (check) or error (cross + reason)` **without changing width**, unless an explicit `successLabel` / `errorLabel` adds essential meaning (in which case reserve the wider box). Prevent double-submission while pending.

### 4.2 Inputs, textareas, and rich link fields
- Match the height and horizontal rhythm of default buttons (`--h-control-md`, e.g. `28–36px` per system).
- Focus uses the design system's single focus treatment (e.g. an inset `1px` `--line-focus` border/ring in compact tools, or a `1px` accent line + soft halo where the design system specifies halos).
- If the kit provides specialized fields (such as `LinkField` for inline URL embeds or `Composer` for prompts/comments), never substitute a raw `<textarea>` or build a second composer.

### 4.3 Navigation, tabs, and segmented controls
- **Zero width-shift rule **[craft]**:** Keep the **exact same `font-weight`** on inactive and active tabs/segments so switching tabs never nudges neighboring labels horizontally. Differentiate the active item with `--text-primary` color and an active fill (`--bg-hover` / `--bg-selected` / `--bg-menu`).
- **Active indicator motion **[system]**:**
  - *Stationary fill:* If the app's design spec fills active tabs, segments, and nav rows in place (no sliding thumb), render the background directly on the active item so keyboard tab switches (`1–4`, `j`/`k`) feel instantaneous.
  - *Sliding shared pill:* If the app or kit animates the pill (`layoutId` or `transform: translateX/Y`), use a **critically damped spring (`bounce: 0`)** or smooth ease-out (`~200–240ms`), and **suppress the animation on initial mount** (`initial={false}`) so the pill never flies in from `(0, 0)` on first paint.

### 4.4 Cards, settings groups, and metric blocks
- Use cards (`Card`, `SettingsGroup`) only when content genuinely benefits from a surface boundary. Inside a card or page section, divide rows with `1px` `--line-divider` hairlines rather than wrapping each row in another box.
- Metric / KPI blocks pair a quiet label (`--text-muted`), a `.tabular` figure, and semantic delta or breakdown lines (`--chart-*` or status tints) without decorative icon tiles or filler cards.

### 4.5 Fact badges & status pills
- Use compact pills (`Pill`, e.g. `20–22px` tall, `--radius-chip`) for scannable structured facts (state, severity, branch, file path, commit, duration). Render paths, branches, hashes, and commands in `--font-code`.
- **Color only for meaning **[craft]**:** Tint only semantic states (severity, pass/fail, verified/reproduced) using high-contrast text on `-tint`. Keep category, file, author, rule, and timestamp pills neutral, distinguished by a small leading icon.
- Truncate long pill text with `text-overflow: ellipsis` and expose the full value on hover/tooltip. Keep titles, user comments, and prose as plain text — not every noun is a badge.

### 4.6 Popovers, menus, selects, and command dialogs
- **Origin-aware entrance **[expert]**:** Enter from `opacity: 0` and `scale(0.95–0.97)` — **never from `scale(0)`** — anchored to `transform-origin` on the trigger side (center for modals). Keep entrances crisp (`~120–160ms` ease-out) and exits faster (`~70–100ms` ease-in). Add a slight `2px` blur or `2–4px` offset *only* if the project's motion presets include them.
- **Keyboard-triggered palettes **[expert]**:** Command dialogs (`⌘K`) and menus opened via keyboard shortcut must open immediately or within `≤ 100–120ms` so typing never lags behind an entrance animation, with the current selection already centered and highlighted on frame 1.
- **Pointer highlight vs. list snap **[system]**:** In dropdown/command primitives, let `[data-highlighted]` follow the pointer smoothly or per kit preset; in custom dense lists, snap the hover fill to the hovered row with a fast (`60–100ms`) opacity fade.

### 4.7 Modals, confirmation dialogs, and mobile sheets
- Reserve confirmation dialogs strictly for destructive or external actions **that Undo cannot reverse**.
- Keep dialog chrome tight and consistent with the kit (scrim fade + centered panel at `--radius-card` / modal token, clear title above concise consequence copy, `Esc` and outside-click dismissal).
- On mobile viewports (`< 768px`), bottom sheets enter with `translateY(100% → 0)` on `cubic-bezier(0.32, 0.72, 0, 1)` (`~350–450ms`) or a damped sheet spring, supporting downward drag-to-dismiss.

### 4.8 Toasts (prefer Undo over Confirm)
- Reversible destructive or state-changing actions apply optimistically and surface a compact toast with an `Undo` action (`~5s` standard, `~6s` error, `~10s` when carrying an action button — or persistent for critical errors, matching the app's toast queue).
- Never fire a celebratory toast for something already obvious inline (like switching a tab or toggling a visible switch that shows its own state).

### 4.9 Skeletons and loading states
- **Whole-layout fidelity **[craft/expert]**:** Skeletons mirror the real view's exact row heights, column widths, radii, and gaps using kit `Skeleton` primitives. Never put a centered spinner where a list, table, or page layout belongs.
- **No flash on fast loads **[expert]**:** Delay skeleton visibility by `--skeleton-delay` (`~120–200ms`) so cached or fast responses paint directly to content without flashing grey bars. Once a skeleton *has* appeared, hold it briefly (`~200–250ms` if the app coordinates episode timing) so it doesn't flicker for a single frame.
- **Swap in place **[system]**:** Replace skeletons with real content **in place** (zero rise, zero stagger, zero layout shift; crossfade only if the host design system explicitly specifies one). Bound or rest skeleton shimmer after several passes if the design system caps infinite animations.

### 4.10 Mobile primary actions (when building mobile views)
- Touch targets are at least `44×44px` (the hit area may extend beyond a smaller visual glyph). Pin primary bottom CTAs cleanly above safe-area insets without covering scrollable content.

---

### 4.11 Sidebar & nav rail: the complete geometry recipe **[craft/expert]**

Models routinely misalign sidebars. Follow every rule below (adapting tokens to the host design system, and comparing structural proportions with 2–3 examples in `./references/sidebars/` when building a new shell):

**1. Pick one clean shell (or keep the repo's existing one) — never mix the two:**
- **Inset shell:** The outer viewport uses `--bg-chrome`. The sidebar has **no background or border of its own** and shares `--bg-chrome`. The main workspace sits in an inset `--bg-canvas` panel (`~8px` margin on top/right/bottom, card/canvas radius, `1px` `--line-card` ring, independent internal scroll).
- **Flush shell:** The sidebar has its own full-height surface (`--bg-panel` / `--bg-rail`), separated from `--bg-canvas` by a single `1px` `--line-divider` border; `<main>` runs edge to edge with no outer margin or radius. Never put identical background colors on both sides of a flush border — maintain a subtle tonal step.

**2. Shared vertical lanes (measure, don't eyeball):**
- Every sidebar row — workspace/account switcher, action button, nav links, settings sections, and footer items — places its leading icon/avatar/mark in **one shared icon lane** and starts its text at **one shared label x-coordinate**.
- **Triggers are rows:** A workspace or account menu trigger must be a full-width row button matching the height, padding, and horizontal inset of the nav items below it (`text-align: start`). A narrower or offset trigger button is the single most common sidebar defect.
- Verify in the browser via `getBoundingClientRect().left` on icons and labels across all sections.

**3. Row & group anatomy:**
- **Width:** `~240–264px` expanded (e.g. `248px` `--sidebar-width`); `~56–64px` if collapsing to an icon rail.
- **Items:** Compact single-line rows (`28–32px` tall per kit density), `--radius-row` / `--radius-control`, `white-space: nowrap`, `overflow: hidden`, `text-overflow: ellipsis` on labels. Outline icons (`14–16px`) sit in `--text-muted` / `currentColor` at rest — never rainbow icons, and **never a 3px colored left accent bar** on the active row.
- **Active & hover states:** Transparent at rest, `--bg-hover` on pointer hover, `--bg-selected` (or kit active pill) with `--text-primary` on `[aria-current="page"]`.
- **Trailing metadata:** Right-aligned (`margin-left: auto`) `.tabular` counts, subtle badges, or disclosure chevrons.
- **Grouping:** Group gaps (`16–24px` or a `1px` `--line-divider`) must be noticeably larger than item gaps (`2px`). Keep top-level groups to ~3–6 items each; pin secondary/account/theme controls to the bottom with `height: 100dvh; display: flex; flex-direction: column` and `margin-top: auto` on the footer.
- **Nested children:** Indent child labels to align with the parent's label lane; animate child list disclosure height over `--dur-disclose` (`~180–200ms`) with a `90°` chevron rotation.

**4. Collapse, resize, and responsive behavior:**
- **Collapse:** If collapsible (via button or shortcut such as `[` / `⌘B` when not typing), keep the icon column at a fixed x-offset so icons never jump sideways while labels fade/clip (`white-space: nowrap`). Show right-side tooltips *only* while collapsed to an icon rail.
- **Resize (when supported):** Use an invisible `8px` hit handle (`role="separator"`, keyboard `←`/`→` + `Enter`, double-click to reset) that reveals a `2px` line only after `~150ms` hover, disabling width transitions during pointer drag for 1:1 tracking.
- **Mobile (`< 768px`):** Hide the desktop rail and present navigation in a left sheet/drawer over `--scrim` (`Esc`, scrim tap, or swipe to close, `44px` row heights) or a compact bottom bar.

```tsx
/* Token-driven sidebar row pattern (use your kit's NavPill / RowButton / Tooltip first) */
function SidebarRow({ icon: Icon, label, count, active, collapsed, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group relative flex h-7 w-full items-center gap-2 whitespace-nowrap rounded-[var(--radius-row)] px-2',
        'text-[length:var(--font-size-label)] text-[var(--text-muted)] transition-colors duration-[var(--dur-hover)]',
        'hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]',
        active && 'bg-[var(--bg-selected)] text-[var(--text-primary)]'
      )}
    >
      <Icon className="size-4 shrink-0" />
      <span className={cn('min-w-0 truncate', collapsed && 'opacity-0')}>{label}</span>
      {!collapsed && count != null && (
        <span className="ml-auto text-[length:var(--font-size-meta)] text-[var(--text-faint)] tabular">
          {count}
        </span>
      )}
    </button>
  );
}
```

---

### 4.12 Focus rings: one ring, on the box the user sees **[expert]**

Agents break keyboard focus in two opposite ways: stripping `outline: none` with no replacement, or drawing two concentric misaligned rings. Every focusable control must show **exactly one** clear focus indicator tracing its visible outer shape:

- **Composite fields get one ring on the outer wrapper:** A search field with a `⌘K` keycap, a prompt composer, or an input with an inline button is **one** control visually. Put the focus ring on the outer container (`:focus-within` or `:has(textarea:focus, input:focus, [contenteditable]:focus)`) and give the inner `<input>` / `<textarea>` `outline: none; box-shadow: none`.
- **Scope global `:focus-visible` rules away from text inputs:** Bare inputs and textareas match `:focus-visible` on mouse click too. Scope app-wide rules to `:focus-visible:not(input, textarea, [contenteditable])` so fields own their wrapper ring cleanly.
- **Prevent scroll-container clipping:** `outline` follows `border-radius` in modern browsers; use an inset offset (`outline-offset: -2px` or inset `box-shadow`) on rows inside `overflow: hidden` / `auto` containers so rings never clip at container edges.
- **Menus and command lists use their highlight, not a second ring:** `[data-highlighted]` / active row fill *is* the focus indicator inside menus, selects, and command lists.
- **Error replaces the ring color, never adds a second ring:** `aria-invalid="true"` shifts the existing border/ring token toward `--danger` instead of stacking two borders.

```css
.composer {
  border-radius: var(--radius-card);
  box-shadow: inset 0 0 0 1px var(--line-control);
  transition: box-shadow var(--dur-hover) ease-out;
}
.composer:has(textarea:focus, [contenteditable]:focus) {
  box-shadow: inset 0 0 0 1px var(--line-focus);
}
.composer[data-invalid="true"] {
  box-shadow: inset 0 0 0 1px var(--danger);
}
.composer :is(input, textarea, [contenteditable]) {
  outline: none;
}
```

---

### 4.13 Field errors that move smoothly, never jump **[expert]**

- **Reward early, punish late:** Validate on `blur` or `submit`, never on the first keystrokes. The instant an invalid field becomes valid while typing, clear the error immediately.
- **Zero layout jump:** Either reserve the status line's space when a message comes and goes frequently, or animate its container height cleanly (`grid-template-rows: 0fr → 1fr` with `overflow: hidden` over `--dur-disclose`). Keep the last error string mounted while collapsing so text doesn't vanish mid-close.
- **Accessible & direct:** Render one concise line in `--danger` directly beneath the field, focus the first invalid field on submit, link via `aria-describedby`, and announce via `aria-live="polite"`. Never shake the form for ordinary validation.

```css
.field-error {
  display: grid;
  grid-template-rows: 0fr;
  opacity: 0;
  transition: grid-template-rows var(--dur-disclose, 200ms) ease-out, opacity 140ms ease-out;
}
.field-error[data-visible="true"] {
  grid-template-rows: 1fr;
  opacity: 1;
}
.field-error > div { overflow: hidden; }
```

---

## 5. Motion system **[system tokens, expert physics]**

### 5.1 Core principles
1. **Frequency dictates restraint:** Controls opened hundreds of times a day (menus, tabs, command palettes, row hovers) use fast transitions (`50–150ms`) or instant swaps — never theatrical entrances.
2. **Short & responsive:** Product UI transitions belong under `~200–250ms` (never `> 300ms` except mobile sheet drags or explicit marketing choreography). Nothing on a hot keyboard path should block or animate longer than `~100ms`.
3. **Ease-out on enter, faster on exit:** Entering surfaces decelerate smoothly (`ease-out`); exits take ~`60–75%` of the enter duration so closing feels crisp. Never `ease-in` on enter.
4. **Critically damped springs by default:** In productivity UI, default springs to **`bounce: 0`** (no overshoot). Reserve visible bounce (`≤ 0.15`) strictly for consumer/playful moments when the brand calls for it.
5. **Interruptible:** Prefer CSS transitions (naming exact properties, never `transition: all`) or retargetable `motion` springs over one-shot keyframes for interactive state changes.
6. **Compositor-friendly:** Animate `transform` and `opacity` (and small `filter: blur` only if specified by the design system). Animate `height` (`0 → auto` or `0fr → 1fr`) only for disclosures/collapsibles.
7. **Theme switches snap cleanly:** Suppress transitions for a single frame when flipping dark/light or `[data-palette]` so surfaces don't smear across states.

### 5.2 Tokens & presets **[system]**
Always pull durations, curves, and spring configs from the project's tokens (`--dur-hover`, `--dur-press`, `--dur-highlight`, `--dur-toggle`, `--dur-disclose`, `--dur-menu`, `--dur-swap`, `--ease-menu`, `--motion-*`) and motion module (`DURATION`, `EASE_OUT`, `EASE_IN`, `SPRING`, `SPRING_SOFT`, `useMotionVariants`). Use the fallback table below only in greenfield repos without motion tokens:

| Interaction | Typical duration | Curve / preset | Notes |
|---|---|---|---|
| Hover / list snap | `50–100ms` | `ease-out` | Color/background wash only; zero layout shift. |
| Press | `50–100ms` | `ease-out` | Shade deeper; **no scale** in flat tools (`0.96–0.97` only if system specifies). |
| Menu / popover / tooltip | `100–130ms` in, `70–80ms` out | `--ease-menu` / `0.95–0.97` scale | Scale from trigger side; skip blur unless specified by system. |
| Modal / dialog | `140–160ms` in, `70–100ms` out | `ease-out` / `0.95–0.97` scale | Centered; scrim fades in sync. |
| Disclosure / collapsible | `180–220ms` | `ease-out` | Height + `90°` chevron rotation. |
| Label / state text swap | `140–180ms` | `ease-out` | Subtle fade + `2px` vertical nudge (`SwapText`), fixed outer width. |
| Shared pill / thumb | `200–240ms` | `bounce: 0` spring or `cubic-bezier(.3,.7,.2,1)` | Only where the app uses sliding indicators; `initial={false}` on mount. |
| List / page data arrival | `0ms` (in-place) | Instant swap | Skeleton → content swaps in place with zero rise or stagger (unless system specifies crossfade). |
| Streaming AI output | `~240ms` tool rows | Shimmer token | Tool rows unfold smoothly; streaming reply text shimmers in white without a blinking caret where specified. |

### 5.3 Reduced motion & performance
- **Honor `prefers-reduced-motion`:** Use the kit's reduced-motion hook/config (`useMotionVariants`, `<MotionConfig reducedMotion="user">`) and CSS `@media (prefers-reduced-motion: reduce)` so spatial movement collapses to instant swaps or `≤ 80ms` opacity fades while essential activity spinners remain legible. Never rely on motion alone to communicate state.
- **GPU & CPU discipline:** Apply `will-change` only when solving measured stutter and never `will-change: all`. Avoid large `backdrop-filter` blurs. Verify smooth `60fps` / `120fps` and zero CLS under `4×` CPU throttle.

---

## 6. Interaction & copy craft

### 6.1 Interactive state checklist
Walk every interactive control through all applicable states before finishing:
- [ ] **Hover** (`@media (hover: hover)`): subtle surface/text shift in `50–100ms`, no layout shift.
- [ ] **Press:** immediate pointer-down response following the host system (shade step, no shrink unless system specifies press scale).
- [ ] **Focus-visible:** single unclipped ring on the visible control boundary (§4.12).
- [ ] **Disabled:** dimmed, `not-allowed`, hover and press suppressed.
- [ ] **Pending / loading:** fixed width, inline spinner or state swap, double-click guarded.
- [ ] **Success & error:** immediate inline confirmation (check, danger ring + message) and/or toast with server error reason; optimistic toggles revert cleanly on failure.
- [ ] **Undo over confirm:** reversible destructive/git/bulk actions offer `Undo` in a toast; confirmation dialogs guard only irreversible operations.
- [ ] **Empty states:** state clearly what belongs here and offer the one action that creates or connects it — never bare `"No data"`.
- [ ] **Tooltips & shortcuts:** every icon-only button has a tooltip naming its action (plus `Keycap` when a shortcut exists). Open after `~400–500ms` hover, skip delay for neighboring controls, suppress on touch and on focus-return after closing a menu.
- [ ] **Copy controls:** `await` the clipboard write, swap to a check / `"Copied"` for `~1.2–1.6s` without resizing the button, and show honest failure if denied.
- [ ] **Every control works:** no dead buttons, fake filters, no-op menu items, or toasts claiming an action succeeded when nothing changed. Keyboard shortcuts stand down while typing or while an overlay is open.

### 6.2 Interface copy & subtext discipline **[craft/system]**
- Write short, plain, product-specific sentence-case copy. No marketing buzzwords, no `"not just X, it's Y"`, no exclamation marks, no `"Welcome back, Alex! 👋"`, and no abbreviated jargon when full words are clearer (e.g. spell effort levels in full: `Medium`, never `Med`).
- **Heading rule:** When the design system uses title-only headings, never add a subtitle under a page or section title.
- **Subtext filter:** Keep a description line under a setting, label, or field **only** if it states an error, live status, limit/unit, irreversible or external consequence, where a secret is stored, or a non-obvious fact required to complete the field. Delete any subtext that merely restates the label, placeholder, or control.

---

## 7. Workflow: short prompt → finished UI

1. **Ground in the host system (§0):** Identify the target app/package, read its `DESIGN.md` and `AGENTS.md`, inspect its token files, and list the kit components and nearest existing screen to match. (If greenfield, define §3.2 tokens first.)
2. **Draft real content first:** Use believable domain shapes — real repository names, PR numbers, file paths, timestamps, token counts, model names, and edge cases (0 items, 1 item, 100 items, long unbroken strings). Never ship lorem ipsum.
3. **Block out layout on the 4px grid:** Establish shell alignment (`44px` bars, shared left lanes, single container level, one primary action per region) using tokens only.
4. **Compose from kit primitives:** Wire real interactions, keyboard navigation, and accessible semantics. Restyle via tokens and `data-*` hooks.
5. **Subtract ruthlessly:** Delete redundant borders, wrapper cards, duplicate CTAs, decorative badges, and restated subtext.
6. **Complete all states:** Whole-layout skeletons (§4.9), empty, error (with reason + retry), pending, disabled, focus-visible, and overflow truncation.
7. **Layer purposeful motion (§5):** Keep kit presets for overlays; add only transitions that clarify spatial or state changes; verify `prefers-reduced-motion`.
8. **Theme, palette & viewport pass:** Check dark mode, light mode, and alternate palettes (`[data-palette]`) across required viewports (`1280px` and `1440px` desktop, `1920px` when sizing/rem-scaling is touched, and `390px` mobile when responsive).
9. **Run the anti-slop & QA checklists (§8, §9)** and complete the **mandatory browser verification round (§9.5)**.

---

## 8. Anti-AI-slop rules

Every item below is an instant tell of unedited AI UI generation **[X/craft]**. Treat each as a hard **don't** paired with a **do**:

1. **No purple/indigo/rainbow gradients** on heroes, buttons, text, or cards **[X]**. *Do:* use flat semantic surfaces, `--primary`, and one purposeful `--accent`.
2. **No gradient text and no "one colored word" headlines** **[X]**. *Do:* set headings in `var(--text-primary)` and create hierarchy with size, weight, and tracking.
3. **No untuned typography** (default `0` tracking on display type, negative tracking on body copy, or 5–6 font weights on one screen) **[X]**. *Do:* stick to 2 working weights, clear token steps, and the §2.1 tracking curve.
4. **No emoji as UI icons or status pills (`🟢 LIVE`, `🚀 Deploy`)** and **no mixed icon libraries** **[X]**. *Do:* use the project's single outline icon set at one consistent stroke width + `StatusGlyph` / semantic pills.
5. **No stock unstyled template look** (raw Tailwind `zinc-*`/`slate-*`/`indigo-600` classes bypassing project tokens, or hand-rolled HTML where kit components exist) **[X/system]**. *Do:* use the project's semantic tokens and UI kit everywhere.
6. **No "centered hero → 3 icon cards → fake testimonials → twin CTAs" boilerplate** **[X]**. *Do:* lead marketing/landing pages with real product UI and content-driven asymmetry.
7. **No fake social proof or lorem ipsum** (`"Trusted by 10,000+ teams"`, `"Sarah K., Founder"`) **[X]**. *Do:* use realistic domain data and label sample states honestly.
8. **No random glow orbs, neon washes, dot-grid wallpaper, or default glassmorphism** **[X]**. *Do:* rely on clean surface tokens and crisp hairlines.
9. **No drop shadows on everything and no heavy border on every box** **[X/craft]**. *Do:* follow the project's elevation model (flat surfaces + hairlines, shadows reserved for floating overlays unless the system specifies otherwise).
10. **No card inside a card inside a card** **[X]**. *Do:* keep one box level (§2.3) and group internally with whitespace and hairlines.
11. **No eyebrow label above every heading and no spaced-out uppercase everywhere** **[X]**. *Do:* let section titles stand on their own; reserve small uppercase for compact sidebar/table group headers if the system uses them.
12. **No hover-scale on everything, no gratuitous scroll fade-ups, and no bouncy springs in productivity tools** **[X/expert]**. *Do:* keep motion fast, critically damped (`bounce: 0`), and purposeful (§5).
13. **No competing accents or saturated white-text badges** **[X/craft]**. *Do:* one primary per region, one accent role, and text-on-tint semantic pills only where meaning requires color.
14. **No eyeballed, uneven spacing** **[X]**. *Do:* stay on the `4px` grid with tighter intra-group gaps than inter-group gaps.
15. **No un-tokenized off-white/grey drift** **[craft/system]**. *Do:* commit strictly to the design system's surface ladder (`--bg-*`) so dark, light, warm, cool, and tinted palettes all stay cohesive.
16. **No buzzword copy, taglines under headings, or exclamation-mark greetings** **[X]**. *Do:* write concise, factual interface copy (§6.2).
17. **No bento grids unless the content is genuinely heterogeneous** **[X]**. *Do:* let information structure dictate layout.
18. **No twin competing CTAs or filler stat cards** **[X]**. *Do:* one primary action per region; render only metrics that earn their space.
19. **No `"No data"` empty states** **[X]**. *Do:* explain what appears here and provide the action to populate it.
20. **No missing or doubled focus rings** (`outline: none` with no replacement, or nested input + wrapper rings) **[X/expert]**. *Do:* follow §4.12 and Tab through every control.
21. **No dead UI controls** **[X]**. *Do:* click every button, filter, menu item, and link to verify real behavior.

---

## 9. Final QA checklist

**Design system & visual**
- [ ] Zero hardcoded hex colors, raw radii, or raw durations — semantic tokens and kit components only.
- [ ] Works cleanly in **dark mode**, **light mode**, and any user-selectable `[data-palette]` / typeface option.
- [ ] Typography uses project font tokens, `≤ 2` working weights (`600` only where allowed), proper tracking (§2.1), `.tabular` aligned numbers, and `≥ 4.5:1` body contrast (`faint`/`ghost` metadata only).
- [ ] `4px` spacing grid respected; concentric border radii (`outer = inner + inset`); structural headers (`44px`) aligned across panes; one box level (no cards in cards).
- [ ] Shadows match the project's elevation rules (floating overlays only in flat systems). No unintended gradients.
- [ ] Pills tinted only for semantic meaning (`≥ 4.5:1` text on tint); long labels/pills truncate with ellipsis + hover reveal.
- [ ] Single icon set and stroke weight, optically aligned with adjacent text.

**Motion & interaction**
- [ ] Hover, press, focus-visible, disabled, pending (fixed width), success, error, empty, and skeleton states all implemented and tested.
- [ ] Overlays use kit presets; lists/pages swap from skeletons in place without layout shift or unasked entrance stagger.
- [ ] Rapidly toggling menus, tabs, switches, or collapsibles interrupts cleanly with zero jump or queue buildup.
- [ ] `prefers-reduced-motion` verified; theme switching does not smear transitions.

**UX & code**
- [ ] One primary CTA per region; 3-second squint test clearly identifies hierarchy and next step.
- [ ] Full keyboard pass: `Tab` order, single unclipped focus ring per control, `Enter`/`Space`/`Escape`, and page shortcuts suppressed while typing or inside open overlays.
- [ ] Alignment pass: shared icon and label x-lanes in sidebars and lists (`getBoundingClientRect()` verified).
- [ ] Copy pass: short, plain, no subtitles where forbidden, subtext passes §6.2.
- [ ] Package `check`, `lint`, `test`, and `build` pass cleanly.

---

## 9.5 Verification round: render, inspect, fix (mandatory)

Passing `check` and `build` never proves a UI change looks right. Render every touched screen in a real browser, inspect the screenshots and geometry yourself, fix defects, and re-shoot until clean.

1. **Reuse or start the dev server:** Use an already-running dev server at its printed port (do not kill active user servers); otherwise start the app's dev command (e.g. `bun run dev` on port `5180` — `/sample` needs no backend — or `bun run dev:web` / site dev server).
2. **Capture themes, viewports, and interactive states** (via Playwright MCP `browser_*` tools if requested/configured, or Playwright CLI / a scratchpad script outside the repo — never commit temporary scripts or add Playwright to `package.json`):
   - One-off shot:
     `bunx playwright@1.60.0 screenshot --color-scheme=dark --viewport-size=1440,900 --wait-for-timeout=1000 <url> <out.png>`
   - Capture **dark and light** modes at `1280×900` and `1440×900` (`1920×1080` when sizing/rem scaling changes; `390×844` when mobile/responsive).
   - Capture affected states: rest, hover, press, `Tab` focus-visible, open menus/dialogs, loading skeleton, empty, and error — plus `8–10` frames across any new motion transition.
3. **Scratchpad inspection script (save outside the repo, e.g. in your scratch directory, and run with `bun`):**
   ```js
   import { chromium } from 'playwright@1.60.0';

   const url = process.argv[2] ?? 'http://localhost:5180/sample';
   const outDir = process.argv[3] ?? '.';
   const browser = await chromium.launch();

   for (const scheme of ['dark', 'light']) {
     for (const width of [1280, 1440]) {
       const page = await browser.newPage({
         viewport: { width, height: 900 },
         colorScheme: scheme,
         deviceScaleFactor: 2
       });
       const errors = [];
       page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
       page.on('pageerror', (e) => errors.push(e.message));

       await page.goto(url, { waitUntil: 'networkidle' });
       await page.waitForTimeout(300);
       await page.screenshot({ path: `${outDir}/shot-${scheme}-${width}.png` });

       if (width === 1440 && scheme === 'dark') {
         const firstInteractive = page.locator('button:visible, a:visible').first();
         if (await firstInteractive.count()) {
           await firstInteractive.hover();
           await page.waitForTimeout(120);
           await page.screenshot({ path: `${outDir}/shot-hover.png` });
         }
         await page.keyboard.press('Tab');
         await page.waitForTimeout(100);
         await page.screenshot({ path: `${outDir}/shot-focus.png` });
       }

       const overflow = await page.evaluate(() =>
         [...document.querySelectorAll('body *')]
           .filter((el) => {
             const r = el.getBoundingClientRect();
             const s = getComputedStyle(el);
             return r.width > 0 && (r.right > innerWidth + 1 || (el.scrollWidth > el.clientWidth + 1 && s.overflowX === 'visible'));
           })
           .slice(0, 15)
           .map((el) => `${el.tagName.toLowerCase()}.${el.className} right=${Math.round(el.getBoundingClientRect().right)}`)
       );
       if (overflow.length || errors.length) {
         console.log({ scheme, width, overflow, errors });
       }
       await page.close();
     }
   }
   await browser.close();
   ```
4. **Inspect every PNG with your file-viewing tool** against the host `DESIGN.md` and §9:
   - Shared x-lanes, optical icon alignment, `44px` header border alignment, `4px` spacing rhythm.
   - Contrast in dark and light themes; single unclipped focus ring in `shot-focus.png`.
   - Zero horizontal overflow, zero top-bar/tab clipping, zero layout shift between skeleton and content, clean browser console (no runtime or hydration errors).
   - *(No-vision fallback:* inspect `getBoundingClientRect()` lanes/heights/gaps, `getComputedStyle()` font/weight/tracking/contrast, empty `overflow` array, and byte-diff rest vs. hover shots — and state explicitly that DOM fallback was used.)*
5. **Fix and re-shoot** until every check passes, then report what you captured and what you fixed.

---

## 10. Structural reference library (`./references/`)

The PNGs in `./references/` and `./references/sidebars/` come from @marcelkargul's public UI studies. **Use them strictly as spatial, typographic, and layout composition references** (whitespace balance, grouping rhythm, table density, command-palette structure, and sidebar lane geometry) — **never copy their monochrome hex colors, drop shadows, button gradients, or large border radii over a host project's design system.**

| Reference | Structural lesson to study (adapt tokens to host system) |
|---|---|
| `2026-10-11_2109273659038650501_1.png` | Display tracking tightening (`0%` → `-3%` → `-6%`) as type size grows. |
| `2026-10-29_2115949035009814905_1.png` | Do / Don't: readable tinted text over soft tint vs. harsh white text on saturated pills. |
| `2026-10-06_2107619825719910460_2.png` | Command palette proportions: search header, scoped filter chips, grouped rows, keycap footer. |
| `2026-10-26_2114761395946311853_1.png` | Dense analytics hierarchy: sidebar + KPI summary + chart tooltip + clean hairline table. |
| `2026-10-03_2106500391672393990_1.png` | Stepped dark surfaces (`canvas` → `raised`) with crisp `.tabular` monospace figures. |
| `2026-11-03_2117435880021561852_1.png` | Split auth/onboarding composition: focused form column paired with live product preview. |
| `sidebars/2026-10-03_2106499785813360687_1.png` | Sidebar anatomy: row-aligned switcher, search with keycap, grouped items, subtle active fill. |
| `sidebars/2026-10-03_2106500336081063986_1.png` | Indented nested nav children aligned cleanly to the parent label lane without tree lines. |
| `sidebars/2026-10-22_2113384174924988778_1.png` | Inset shell contrast: quiet chrome-toned sidebar beside an inset, ringed canvas panel. |
| `sidebars/2026-10-07_2107869459142914419_1.png` | Collapsed icon rail + secondary list column + detail pane. |

---

## Sources
- Host project design specs (`DESIGN.md`, `apps/app/DESIGN.md`, `AGENTS.md`) — authoritative whenever present.
- @marcelkargul public UI studies & typography notes (spatial hierarchy, tracking scale, tinted-pill readability, sidebar proportions).
- Emil Kowalski, "Great Animations" (`https://emilkowal.ski/ui/great-animations`): fast ease-out curves, `< 300ms` budget, interruptibility, keyboard restraint, reduced motion.
- Motion documentation (`https://motion.dev/docs/react-transitions`): `visualDuration` + `bounce: 0` critically damped springs, `layoutId`, `MotionConfig`.
- Apple Human Interface Guidelines: purposeful motion, `prefers-reduced-motion`, `44pt` touch targets, contrast.
