---
name: giga-ui
description: The Recoder edition of giga-ui. Use for any UI work in this repo (building, redesigning or polishing a component, page, layout, motion, loading state or interface copy in apps/app, apps/site, apps/web or packages/ui). Gives the craft rules (type, spacing, states, motion, anti-slop, QA, screenshot verification) on top of Recoder's own tokens, kit components and design rules instead of a generic monochrome palette.
---

# GIGA UI, Recoder edition: calm, precise, alive

giga-ui is a craft skill for turning a short UI request into a finished interface. This edition keeps its philosophy, craft rules, motion principles and QA loop, and replaces its palette, shadows, button recipes and component code with Recoder's. Where the two disagree, Recoder wins.

Lines marked **[Recoder]** are repo rules, not general craft advice. Read them as law.

## 0. Read first, in this order

1. `AGENTS.md`: "UI requirement", "UI conventions", "Visual verification", "Recoder design system". These are mandatory.
2. `apps/app/DESIGN.md` for apps/app and apps/site (React). `DESIGN.md` at the root for apps/web (Svelte). The app's file builds on the root one and lists where it departs.
3. The token files, never hex copied from this skill:
   - `apps/app/src/styles/tokens.css` (app and site values, dark and light), `apps/app/src/styles/palettes.css` (the other palettes), `apps/app/src/styles/appearance.css` (typeface choice).
   - `packages/ui/src/styles/tokens.css` (the kit's token names, sizes, radii, durations).
   - `apps/web/src/app.css` (token section) for apps/web.
4. `packages/ui/src/components/` and `packages/ui/src/motion/` to see what the kit already has before you write anything.

Companion skills in this folder: `better-ui` (polish details) and `emil-design-eng` (animation taste). This skill does not replace them. It decides which rules apply here.

---

## 1. Design philosophy (kept)

1. **If it can be removed, remove it.** Every screen, component and frame. Delete a divider, icon, label, badge or color that is not needed. Merge redundant actions.
2. **Typography does the heavy lifting.** One sans face, two working weights, a clear step between title, body and meta. See §2.
3. **Color is for meaning.** Severity, pass or fail, the one primary action, one accent for links and selection. Everything else is neutral. **[Recoder]** Category, file, rule and time badges stay neutral; an icon tells them apart.
4. **Depth comes from surface steps and 1px hairlines, not shadows.** **[Recoder]** See §3.
5. **Motion explains change.** Confirm an action, show where something came from, then get out of the way. Recoder is an everyday tool; menus and dialogs open thousands of times a day.
6. **Craft the last 10% by hand.** The QA checklist (§9) and the screenshot round (§10) are that last 10%.
7. **Calm beats clever.** Even a dense screen should feel quiet: quiet at rest, loud only for what needs a decision.

---

## 2. Visual language **[Recoder]**

### 2.1 Palette and tokens
- Tokens are CSS custom properties. Components reference tokens, never raw hex, raw durations or raw radii. If a value is missing, add a token (and to `packages/ui` when two places need it).
- **Dark first, with a light theme.** Both ship, both get checked. **Graphite** is the default palette in apps/app (no attribute on `<html>`); other palettes come from `palettes.css` and Settings → Appearance. Never hardcode a palette.
- Names to know (values live in the token files and will drift, so look them up):
  - Surfaces: `--bg-chrome`, `--bg-canvas`, `--bg-panel`, `--bg-raised`, `--bg-raised-2`, `--bg-menu`, `--bg-hover`, `--bg-selected`, `--bg-field`.
  - Lines: `--line-divider`, `--line-card`, `--line-control`, `--line-menu`, `--line-focus`.
  - Text, strongest to weakest: `--text-primary`, `--text-secondary`, `--text-muted`, `--text-subtle`, `--text-faint`, `--text-ghost`. Body copy stays at 4.5:1 or better; `faint` and below is metadata only.
  - Action: `--primary` with `--on-primary` (cream in dark, near-black in light; swappable, so never assume cream), `--accent`, `--accent-text`, `--accent-tint` (azure: links, selected line, hunk headers).
  - Meaning: `--sev-high`, `--sev-medium`, `--sev-low`, `--sev-info`, `--success`, `--danger`, each with a `-tint`. Text on tint, never white text on a saturated fill. Severity colors stay the same across palettes.
  - Charts: `--chart-1` to `--chart-6`. Diff and code: `--diff-*`, `--selection`, `--syn-*`.
- Tailwind utilities map onto the tokens in both apps (`bg-canvas`, `text-fg-faint`, `ring-line-card` in apps/web). Use those or `var(--token)`.
- **No gradients** on buttons, surfaces, text or backgrounds. No glow orbs, blobs, grain, glassmorphism or neon. The one soft fade allowed is the `transparent → canvas` fade behind a floating composer.

### 2.2 Type
- **Inter is the app face** in apps/app and apps/site (`--font-ui`; the AI voice uses it too via `--font-ai`). A Settings choice can swap to Geist; never hardcode a face. **Geist Mono** for code, paths, hashes, commands, metadata and aligned numbers.
- apps/web uses Cal Sans (Geist fallback). The serif (`.ai-voice`, Lora) exists only in apps/web for summaries, findings and the Home brief. apps/app has no serif and no Cal Sans. Never mix voices in one block.
- Weights: 400 and 500 carry the interface. 600 only for page titles, markdown headings and key numbers. Never more than two weights on one screen.
- Sizes and line heights are tokens (`--font-size-body` 13.5/20, `--font-size-label` and `--font-size-button` 13, `--font-size-meta` 12, `--font-size-badge` 11.5 medium, page title 20). Do not invent sizes between them.
- Tracking: 0 at 16px and below, about -1% from 18 to 24px, about -3% near 36px, -5% only on marketing display sizes (apps/site). Never negative on body text.
- Line height: body 1.5, UI labels 1.3, headings 1.1.
- Numbers that line up use tabular figures (the `.tabular` class). Truncated text ends in an ellipsis and shows the whole on hover.
- Icons: Lucide, stroke 1.75 per DESIGN.md, 12 to 16px, one set only, muted by default. No emoji as icons or status.

### 2.3 Spacing, radius, size
- 4px grid. Gaps inside a group are smaller than gaps between groups. Blank space and hairlines group content before boxes do.
- Radius is four kit tokens in apps/app, used everywhere: `--radius-chip` 4, `--radius-control` 5, `--radius-row` 6, `--radius-card` 8 (and `--radius-composer` for the composer). A surface's radius is its inset plus the radius of the rows in it. No raw radius values. apps/web follows its own list in `DESIGN.md`.
- Control sizes are tokens: `md` 28px (default, omit the prop), `sm` 24px (only inside a line of text or a dense group), `lg` 32px, `icon` 28px square (apps/web icon: 30px). Never shrink an icon button below 28px.
- **One box level.** A box holds only code or terminal output. Cards inside cards are out. Everything else groups by space, a section label and hairlines.

### 2.4 Facts and long text (apps/app pull request screens)
- A fact a reader scans for (state, author, branch, size, severity, category, evidence, file, rule, time) is a kit `Pill`: 20px, 11.5px medium. Paths, branches and commits use `face="code"`. Color only for severity, pass or fail, and reproduced.
- Not every word is a badge. Titles, model prose and people's comments stay text.
- Long model-written prose is clamped with `ClampedText` and opens over `--dur-disclose`. Never rewrite or cut it for good.

---

## 3. Depth and surfaces **[Recoder]** (replaces the original's shadow recipes)

- **No drop shadows on panels, cards, the composer or buttons.** Not in dark, not in light (`--drop: 0` in apps/web). A card is a surface step plus a 1px ring or border from a `--line-*` token. A composer ring is `--shadow-composer`, which is a ring only in apps/app.
- **Only what floats gets a shadow:** menus, popovers, tooltips, toasts and dialogs. Use `--shadow-menu` and `--shadow-modal` as they are; do not write new ones.
- Hairlines are drawn inside the box so they line up with fields. No border on every box; tonal separation first.
- No sheen, bevel, lift or inner highlight on buttons. The original giga-ui button recipes (`--shadow-btn`, gradient fills, `whileTap` scale) do not apply.
- No logo mark anywhere, including beside AI messages. The brand is the "Recoder" wordmark.

---

## 4. Components: use the kit, never hand-roll **[Recoder]**

**One kit per framework, hard requirement.** apps/app and apps/site build all UI with `@recoder/ui` (Radix primitives, `motion`, Recoder tokens). apps/web builds all UI with Sivir (`@sivir-ui/svelte`; load the `sivir` skill for its catalog). Before any UI change, find the component that covers it. No raw `<div>`, `<details>`, `<dl>`, native form control or bespoke overlay in its place. If the kit lacks a piece two places need, add it to `packages/ui` (with `check` and `lint` passing), not to one app.

### 4.1 What `@recoder/ui` has (read the source for props)
| Area | Components |
| --- | --- |
| Actions | `Button` (variants `primary`, `secondary`, `outline`, `ghost`, `quiet`, `destructive`; sizes `md`, `sm`, `lg`, `icon`), `Keycap`, `Spinner`, `CopyButton`, `RowButton`, `NavPill` |
| Overlay | `Modal` (`ModalContent`, `ModalTitle`, `ModalBody`, `ModalFooter`, `ModalClose`), `InlineModal`, `ConfirmDialog`, `Popover`, `Tooltip` and `TooltipProvider`, `HoverCard` |
| Menu | `DropdownMenu`, `ContextMenu`, `Select`, the command palette (`CommandDialog`, `CommandInput`, `CommandList`, `CommandGroup`, `CommandItem`, `CommandFooter`, `CommandEmpty`), `CommandBar` |
| Form | `Input`, `Textarea`, `LinkField` and `LinkText` (URL embeds), `Field`, `Checkbox`, `Switch`, `RadioGroup`, `SegmentedControl`, `Composer` (`ComposerTool`, `ComposerSend`, `ComposerStop`), `ImageChips` |
| Display | `Card`, `Pill`, `Collapsible`, `ClampedText`, `ScrollArea`, `Skeleton` (`SkeletonRows`, `SkeletonText`), `Tree`, `HoverList`, `Meter`, `StatusGlyph`, `StatusNotice`, `SwapText`, `AnimatedNumber`, `ResizeHandle`, `AgentMark`, `ForgeMark` |
| Content | `Markdown`, `StaticMarkdown`, `CodeBlock`, `CodeLines` |
| Chart | `LineChart`, `StackedBar`, `ChartTip` (use `--chart-*` tokens) |
| Feedback | toasts from `toast.tsx` (queue in `toast-queue.ts`) |
| Motion | `DURATION`, `EASE_OUT`, `EASE_IN`, `SPRING`, `SPRING_SOFT` and the menu, modal and overlay presets in `packages/ui/src/motion/presets.ts`; `useMotionVariants` for reduced motion |

Everything the kit exports is re-exported from `packages/ui/src/index.ts`. Check there and in `components/<area>/index.ts` before assuming something is missing.

### 4.2 How to restyle
- Restyle through tokens and `data-ui`, `data-variant` and `data-state` hooks. The kit's control CSS sits in `@layer components`, so a `className` utility wins over it; use that sparingly. Never fork a component to change its look.
- Sivir in apps/web is restyled in `app.css` the same way. Design "secondary" = Sivir `outline`; "ghost" = `ghost`; quiet triggers = `quiet`. Sivir `ScrollArea` always gets `showCues={false}`.
- App styles live in one CSS file per feature (`apps/app/src/styles/<feature>.css`, imported by `app.css`). Do not scatter CSS in components.

### 4.3 Recipes in words (replace the original's code)
- **Buttons.** Compact and flat: 13px label, regular weight (primary alone is medium), a hairline where it has an edge. One cream `primary` per region, never repeated down a list. `outline` beside a primary or as a list row action; `ghost` for tertiary and row controls; `quiet` for triggers that name their value (filter, model picker); `destructive` only inside its confirmation. Hover and press shade a step within `--dur-hover`; a press never shrinks. Quiet at rest: no background until hover.
- **Async buttons.** Fixed width across idle, pending (spinner in place of the label), success (green check) and failure (red cross, with the server's reason). Pass `successLabel` or `errorLabel` only when the word adds something.
- **Inputs.** 28px tall, 9px side padding, focus is one inset `--line-focus` line (no halo in apps/app). Composite fields follow §6.2.
- **Tabs and segmented control.** Text tabs, 26px; the open tab is brighter on a quiet fill drawn in place. Same weight for all tabs so nothing shifts.
- **Menus and selects.** 26px rows, 14px icon, 4px inset, at least 160px wide. The highlight follows the pointer in kit menus. Our own lists use `HoverList` / `hoverHighlight`, which snap to the item and fade 60 to 100ms.
- **Dialogs.** 16px padding, title 4px over its description, close 12px in from the corner. Confirm only what undo cannot reverse.
- **Badges, keycaps, tooltips.** `Pill`, `Keycap`, `Tooltip`. Every icon-only button has a tooltip naming it, with the shortcut as a keycap where one exists.
- **Cards.** `Card` or none. Settings pages use `SettingsPage`, `SettingsGroup`, `SettingsRow` (52px rows, one 704px centered column, group titles and notes on the card edges).
- **Model picking.** One pattern (apps/web `model-picker.svelte`; `apps/app/src/components/settings/model-picker.tsx`): a quiet model trigger opening a searchable command dialog grouped by provider, plus a quiet effort select. No nested submenus, effort words in full, options from the model's capabilities, no speed option.
- **Composer.** The kit's `Composer` is the only place a person writes to Recoder or the forge. No second implementation.

---

## 5. Layout **[Recoder]**

- **apps/app: sidebar shell.** 248px sidebar (`--sidebar-width`), a 44px page bar (`--bar-height`) with breadcrumbs left and page actions right, content below. Pages start under the bar so borders line up. **apps/web: top bar shell only** (46px; Home, session tabs, search; tabs overflow into a menu; the search shrinks to 170px). Never add a left sidebar to apps/web.
- **Panel headers are 44px** (matching the diff header) so bottom borders line up.
- **Settings, Automations, Guidelines:** one titled-card column, 704px, 32px under the bar, centered on the page and not on the scroller. A section name tops its column at page-title size.
- **Alignment.** Rows share lanes: icons in one column, labels in another; a trigger row matches the rows around it in height and inset. Measure with `getBoundingClientRect`, do not eyeball.
- **One primary action per view or region.** No twin CTAs, no filler cards.
- **Large screens scale via rem.** A PostCSS step compiles every CSS px to rem and the root font grows at 1920px and 2400px. Write CSS in px as usual; multiply JS pixel constants by the root font scale. Never use CSS `zoom` (it breaks menu positioning).
- Content must hold at 1280 and 1440 wide; nothing clips, especially the top bar. Test long text, one item and zero items.
- **Keyboard first.** Page keys (j/k, tab numbers, `c`, `[`, `?`, ⌘K, ⌘,) stand down while typing or while a dialog or menu is open. Enter and Space on a focused control belong to it. Keep the shortcut list in sync when you add one.

---

## 6. Interaction craft (kept, adapted)

### 6.1 State checklist
Every interactive element has all of these. Go through them one by one.
- [ ] **Hover** (pointer devices only): a wash over what is behind, 50 to 100ms. No layout shift.
- [ ] **Press**: shades a step deeper within `--dur-press`. **[Recoder]** Controls never scale or shrink when pressed.
- [ ] **Focus-visible**: one ring, on the visible box (§6.2). Never remove focus without a replacement.
- [ ] **Disabled**: dimmed, not-allowed, no hover or press.
- [ ] **Loading**: idle, pending (spinner, same width), then success or failure. A change shows at once and reverts if the save fails. Disable double submit.
- [ ] **Success or failure**: inline first (check, red cross, field error); toast for async results.
- [ ] **Undo over confirm.** Destructive or pushed-to-git actions apply at once and show a toast with Undo (`$lib/shell/notify.ts` in apps/web, the kit toast in apps/app). A toast stays 5s, an error 6s, 10s with a button.
- [ ] **Empty** states say what will appear and give the action that makes it appear. No "No data".
- [ ] **Error** states say what failed and, when the server gave one, the reason.
- [ ] **Every control does something.** A button, menu item, chip or link either works or is not there. A toast must never claim a change that did not happen. Nothing is posted or merged without an explicit click, and a second click posts nothing twice.
- [ ] **Copy buttons** flip to a check ("Copied") for about 1.2s; await the clipboard write and show failure honestly.
- [ ] **Touch targets** 44px on touch layouts; the hit area may exceed the visual size.

### 6.2 Focus rings: one ring, on the box you can see
- A composite field (search, composer, input with an icon or button) is one control: the ring goes on the outer box (`:focus-within`, or `:has(textarea:focus)`), and the inner input gets none. The failure to avoid is a second ring a few px inside the first.
- Scope any global `:focus-visible` rule away from inputs and textareas (they match on mouse click).
- `outline` follows `border-radius`; use a negative offset for rows inside a scroller so overflow does not clip it.
- Menus and lists show focus through the hover highlight, not a ring.
- An error replaces the ring's color, it does not add a ring.
- **Check it:** Tab through the screen. Each control shows one ring, aligned to its edge, unclipped.

### 6.3 Field errors move, not jump
- Validate on blur or submit, not per keystroke; clear the error the moment the field becomes valid.
- The message opens its height (a `0fr → 1fr` grid), so nothing below jumps. Keep the last message rendered while it closes. A line that comes and goes keeps its space.
- One short line in the danger color directly under the field. Focus the first invalid field on submit; link with `aria-describedby`, announce with `aria-live="polite"`.
- Never shake for ordinary validation.

### 6.4 Subtext and copy **[Recoder]**
- Short, plain copy. A heading is a title with no subtitle. No taglines, no "not just X, it's Y", no triads, no buzzwords, no exclamation marks, no "Welcome back".
- A line under a label, field or control stays only if it carries an error, a state, a limit or unit, a consequence (above all one that deletes or writes to a forge), where a secret is kept, or a fact needed to fill the field. Otherwise delete it. Do not shorten a needed fact; move it to where it is used.
- Sentence-case labels. Effort words in full, never "Med". Realistic content in mocks, labelled as sample when it is.

---

## 7. Motion system **[Recoder tokens, giga-ui principles]**

### 7.1 Principles (kept)
1. **Purpose first.** Frequency decides: what a person sees a hundred times a day gets little or no motion.
2. **Fast.** UI motion is under about 200ms. Nothing on a keyboard path runs longer than about 100ms, and keyboard-opened surfaces do not play a long entrance.
3. **Ease-out for entering and reacting.** Never ease-in on enter. Exits are faster than enters.
4. **Interruptible.** Prefer CSS transitions and springs that retarget over keyframes for state changes.
5. **Only `transform` and `opacity`** (and `filter: blur` sparingly). Animate height only for disclosure. No `will-change` except while animating.
6. **Respect `prefers-reduced-motion`** (§7.4).

### 7.2 Use the tokens, never a raw duration or curve
- CSS: `--dur-hover` 50ms, `--dur-press`, `--dur-highlight`, `--dur-toggle` 180ms, `--dur-disclose` 200ms, `--dur-menu` 120ms, `--dur-swap` 140ms, `--dur-shimmer`, `--dur-skeleton`, `--dur-spinner`, `--skeleton-delay`, and `--ease-menu`. apps/web adds Sivir's `--motion-*` (including `--motion-menu-y`, `--motion-modal-y`, `--motion-duration-item`).
- JS: `DURATION`, `EASE_OUT`, `EASE_IN`, `SPRING` (tight, critically damped, for highlights and layout moves) and `SPRING_SOFT` from `packages/ui/src/motion/presets.ts`. No overshoot, no bounce: Recoder is a productivity tool.
- Look values up in `packages/ui/src/styles/tokens.css` and `apps/web/src/app.css`; the table in the root `DESIGN.md` ("Motion") lists the intent of each.

### 7.3 What moves and what does not
| Thing | Rule |
| --- | --- |
| Menus, selects, popovers, dialogs, tooltips | Short fade in from a slight scale, scaling from the side they open on. apps/web and the root `DESIGN.md`: 0.95 scale and 2px blur, menus about 130ms, modals about 150ms, under 200ms. apps/app and the kit presets: 0.97 scale, no blur, menus 120ms in and 80ms out, dialogs 150 in and 100 out. The numbers in the code win; do not add other entrances to things opened repeatedly. |
| Menu or list highlight | Kit menus: the highlight travels between items. Our own lists snap and fade 60 to 100ms. |
| Tab pill, segmented thumb | apps/web and the kit's pill animate position with a no-overshoot spring or ease; in apps/app the open tab and chosen segment are filled in place. A pill sits still on its control's first paint. Follow the app you are in. |
| Disclosure (collapsible, drawer) | Height over `--dur-disclose`. |
| Label or trigger text change | Fade in and rise 2px over about 180ms (`SwapText`). |
| Lists and pages loading | Content replaces its skeleton in place. **No entrance animation, no fade, no rise, no stagger.** |
| Streaming | Tool rows grow in (240ms); no caret, the last few words shimmer. |
| Press | Shade only, never scale. |
| Toast | Rises about 10px, leaves downward. |

### 7.4 Reduced motion
Transitions snap, the kit's presets keep only a fade of 80ms at most, spinners keep spinning. Use `useMotionVariants`; do not write a parallel branch. Never convey information by motion alone.

### 7.5 Performance
Animate `transform` and `opacity`. Skip `backdrop-filter` and large blurs. Prefer CSS for always-on animations. Check at 4x CPU throttle: no layout shift, no dropped frames while the page is loading.

---

## 8. Loading feel **[Recoder]**

- A click responds at once: show cached data immediately, otherwise the page's whole skeleton.
- **A page paints once, fully formed.** No half renders, no content that jumps after first paint, no spinner in place of a list.
- Skeletons copy the final layout exactly (heights, radii, gaps) and come from the kit `Skeleton`, `SkeletonRows` or `SkeletonText`. Each bar waits `--skeleton-delay` so fast data never flashes one. apps/app times skeletons per loading episode and keeps a shown skeleton on screen long enough to read; see its `DESIGN.md` before changing that.
- Skeleton to content swaps in place with no motion. Pagination appends rows in place with skeleton rows at the end and one plain line with Retry on failure.
- Verify by filming frames of the load (§10), not by reading code.

---

## 9. Anti-slop rules and QA

### 9.1 Do not ship these (kept, tuned to Recoder)
1. No gradient text, gradient buttons or purple gradients. No "one colored word" headlines.
2. No untuned type: default tracking at every size, six weights, a flat hierarchy.
3. No emoji as icons or status. No mixed icon sets.
4. No stock shadcn or zinc look: use the kit and its tokens.
5. No hero, three icon cards, testimonials template. No fake social proof, no lorem ipsum.
6. No glow orbs, dot grids, bento by default, glassmorphism.
7. No drop shadows on everything and no hairline on every box.
8. No card inside a card. One box level (§2.3).
9. No eyebrow above every heading and no spaced uppercase everywhere.
10. No hover-scale everywhere and no fade-up on every section. Motion is purposeful (§7).
11. No several competing accents. One primary per region, one accent, semantic colors only for meaning.
12. No uneven, eyeballed spacing. 4px grid.
13. No dead UI. Click through every control (§6.1).
14. No twin CTAs, no filler cards, no subtitle under a heading.
15. No `outline: none` without a replacement, and no double focus rings (§6.2).
16. No hand-rolled control when the kit has one (§4). No raw hex, raw px duration or raw radius.

### 9.2 Final QA checklist
**Visual**
- [ ] Tokens only. One accent. Everything else neutral or semantic.
- [ ] One face (+ Geist Mono), two weights, tracking per §2.2. Body text at 4.5:1; `faint` and below only for metadata.
- [ ] Spacing on the 4px grid. Radii from the four tokens. Panel headers 44px.
- [ ] No shadows except on floating surfaces. No gradients.
- [ ] Badges for facts, tinted only for meaning. Numbers tabular. Long text clamped or truncated.
- [ ] Icons one set, one stroke, optically aligned with text.
- [ ] Dark and light, and every palette that the change could touch.

**Motion and interaction**
- [ ] Hover, press, focus-visible, disabled, loading, success, failure, empty and error all present and checked.
- [ ] Menus and dialogs use the kit's entrance and nothing else. No entrance on lists or pages.
- [ ] Interruptible: toggling rapidly never jumps or queues.
- [ ] Reduced motion checked.
- [ ] Skeleton to content swap has no motion and no layout shift.

**UX**
- [ ] One primary action per region. Squint test reads in three seconds.
- [ ] Keyboard path works: tab order, Enter, Escape, shortcuts and keycaps.
- [ ] Function pass: every button, menu item, chip, link and row action does what its label says.
- [ ] Alignment pass: icons share a lane, labels share a lane, trigger rows match their neighbors.
- [ ] Copy is short and plain; errors say what failed and why.
- [ ] Re-read the diff next day or do a second pass.

**Code**
- [ ] Only kit components. Anything new that two places need lives in `packages/ui`.
- [ ] Comments are JSDoc only, files under 500 lines, no duplicated or dead code, feature folders per AGENTS.md.
- [ ] `check`, `build` (and `lint` for `@recoder/ui`) pass for the touched package; `bun run deadcode` when code was removed or moved.

---

## 10. Workflow and verification **[Recoder]**

### 10.1 From a short request to a finished screen
1. **Classify:** which app (app, site, web), which screen, new or existing. Read the §0 files for that app.
2. **Find the kit pieces** that cover it (§4.1) and the nearest existing screen to match.
3. **Write the content first,** short and plain, with real data shapes.
4. **Block out the layout** on the 4px grid with tokens only, inside the shell (§5).
5. **Build with kit components.** Restyle through tokens and data attributes. Remove anything not needed.
6. **Handle states:** loading (whole-page skeleton, §8), empty, error, success, disabled, long text, zero and one item.
7. **Add motion last,** only what explains a change (§7). Most screens need none beyond what the kit gives.
8. **Dark and light pass,** then 1280, 1440 and 1920 when sizing changes.
9. **Accessibility pass:** semantic elements, labels, keyboard, focus order, reduced motion, contrast.
10. **QA (§9.2),** then the verification round below.

### 10.2 Verification round: screenshot, check, fix (mandatory)
`check` and `build` passing does not mean it looks right. Do not claim a UI change works without screenshots. A browser is always available; never conclude otherwise.

1. **Server.** Use the running dev server if there is one (ports vary; check the cwd and reuse it, never kill vite). Else `bun run dev` (apps/app, port 5180; `/sample` needs no server), `bun run dev:web` (apps/web) or the site's dev script. Run the site's dev server with `DATABASE_URL=` empty.
2. **Browser.** Try the Playwright MCP (`browser_*`) first. If it fails with "Chromium distribution 'chrome' is not found", fall back:
   - One shot: `bunx playwright@1.60.0 screenshot --color-scheme=dark --viewport-size=1440,900 --wait-for-timeout=1000 <url> <out.png>`
   - Interaction or frames: a script in the scratchpad (never in the repo) that imports `chromium` from `'playwright@1.60.0'`, run with `bun script.mjs`. Never add Playwright or these scripts to the repo.
   - Theme follows `prefers-color-scheme` unless `localStorage['recoder-theme']` is set, so emulate the color scheme.
3. **Capture** every screen the change touches, dark and light, at 1280 and 1440 wide, plus 1920 when sizing changes.
4. **Exercise the states:** hover, press, focus (Tab through everything), open menus and modals, pending, success, failure, loading skeleton, empty, error. Screenshot each.
5. **Motion:** capture 8 to 10 frames across any transition (menu and modal entrance, hover highlight, tab pill, skeleton-to-content swap, layout shift). Do not judge motion from code.
6. **Read every PNG yourself** with the Read tool against the design doc. Check pass or fail, nothing in between:
   - [ ] Alignment: shared left edges, icons centered with text, lanes consistent, 44px headers line up.
   - [ ] Spacing rhythm on the 4px grid, groups tighter inside than between.
   - [ ] Type hierarchy: one title, two weights, no subtitle.
   - [ ] Contrast in both themes; the focus ring visible and single.
   - [ ] No clipping (especially the top bar), no horizontal overflow, no wrapped buttons or labels.
   - [ ] No layout shift between skeleton and content, no half-formed first paint.
   - [ ] Consistent with neighboring screens and with the doc.
   - [ ] Console clean: no errors, no hydration warnings.
7. **Fix and re-shoot** until clean. Repeat as many rounds as it takes; do not stop at a fixed count.
8. **Report** what you captured and what you fixed. If you could not verify visually, say so plainly.

If you cannot view images, fall back to the DOM: dump `getBoundingClientRect()` for headings, buttons and nav rows, check lanes, heights, gaps and overflow, read computed font, weight, letter-spacing and contrast, and diff rest and hover screenshots. State that this was the fallback.

---

## 11. Where each rule lives

| Question | Look at |
| --- | --- |
| Which token, what value | `apps/app/src/styles/tokens.css`, `packages/ui/src/styles/tokens.css`, `apps/web/src/app.css` |
| Palette choices | `apps/app/src/styles/palettes.css`, `apps/app/src/lib/appearance/choices.ts` |
| Does the kit have it | `packages/ui/src/components/<area>/index.ts`, `packages/ui/src/index.ts` |
| Motion numbers | `packages/ui/src/motion/presets.ts`, root `DESIGN.md` "Motion", `apps/app/DESIGN.md` "Motion" |
| Button, corner, control specs | `apps/app/DESIGN.md` "Buttons", "Corners and controls" |
| Composer, link embeds | `apps/app/DESIGN.md` "Composer", "Link embeds" |
| apps/web specs | root `DESIGN.md`; Sivir via the `sivir` skill |
| Polish details | `better-ui`, `emil-design-eng` |
| Mandatory repo rules | `AGENTS.md` |

When two docs disagree, the code and tokens win, then `apps/app/DESIGN.md` for apps/app, then the root `DESIGN.md` for apps/web. Fix the stale doc in the same change.
