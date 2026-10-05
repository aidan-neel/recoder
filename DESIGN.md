# Recoder design system (dark)

The source of truth for Recoder's UI.

## Principles
- **Warm near-black surfaces, flat by default.** Depth comes from 1px rings and a few surface steps. Shadows are for floating things only (menus, modals, toasts, the composer).
- **Two voices.** The UI speaks in Cal Sans (Geist as fallback). The AI speaks in Lora serif in summaries, findings and the Home brief; chat replies use the UI sans. Never mix them in one block.
- **Quiet chrome.** Controls stay transparent until they're hovered. There is one cream primary action per region.
- **No brand mark on AI output.** The serif alone tells you who is speaking.

## Color

### Surfaces
| Token | Hex | Use |
|---|---|---|
| `bg.chrome` | `#0d0c0b` | Page and top bar |
| `bg.canvas` | `#141312` | Main canvas card |
| `bg.canvas-deep` | `#100f0e` | Focus-mode canvas |
| `bg.panel` | `#131211` | Docked right panels |
| `bg.raised` | `#1a1918` | Composer, finding cards, fields |
| `bg.raised-2` | `#161514` | Code cards, modal |
| `bg.menu` | `#1c1b19` | Menus, popovers, active tab pill |
| `bg.hover` | `#232120` | Quiet-trigger hover, keycaps |
| `bg.selected` | `#2a2826` | Menu item hover, segmented active item, trigger while open |
| `bg.bubble` | `#211f1d` | User message, inline code |

### Lines
| Token | Hex |
|---|---|
| `line.divider` | `#1d1c1a` |
| `line.subtle` | `#1f1e1c` / `#211f1d` |
| `line.card` | `#201f1d` (canvas border), `#242220` (card ring) |
| `line.control` | `#2a2826` |
| `line.menu` | `#2e2b28` |
| `line.focus` | `#3d3935` |

### Text
| Token | Hex |
|---|---|
| `text.primary` | `#ede9e3` |
| `text.ai` | `#e4dfd8` |
| `text.secondary` | `#cfcac2` |
| `text.tertiary` | `#bdb8b0` |
| `text.muted` | `#a39e96` |
| `text.subtle` | `#8a857d` |
| `text.faint` | `#6f6a63` |
| `text.ghost` | `#57534d` |
| `text.brief-body` | `#8f8a82` |

### Primary
- `primary` `#ede9e3` (cream), `on-primary` `#141312`.
- Hover: `filter: brightness(1.08)`. No press scale.
- Primary must stay swappable. If a light color is picked, on-primary is computed by luminance: dark text when L > 0.3.

### Status and severity (text on tint)
Vivid, not pastel: chroma sits at 70–95% of the sRGB maximum for each hue (OKLCH). Keep lightness and hue when tuning, and recheck contrast: every text color passes 5:1 on its tint over `bg-canvas` and `bg-raised`.

| Status | Text | Tint |
|---|---|---|
| High / danger | `#fc8d85` (icon `#fb6862`, danger `#fb756e`) | `rgba(251,104,98,.15)` |
| Medium | `#f7c065` | `rgba(247,192,101,.14)` |
| Low | `#82b3fb` | `rgba(130,179,251,.14)` |
| Info | `#b9b3aa` | `rgba(255,245,230,.07)` |
| Success | `#67da7e` | `rgba(103,218,126,.13)` |

### Diff and code
- Diff backgrounds: add `rgba(103,218,126,.08)`, delete `rgba(251,104,98,.08)`.
- Finding lines get a 2px inset bar in the severity color.
- Selection: `rgba(127,166,245,.16)` with a 2px bar `#7fa6f5`.
- Syntax colors: keyword `#e8927c`, function `#d4b3ee`, type `#93cfc0`, plain `#d6d1c9`.

## Type
| Role | Font | Size / line-height |
|---|---|---|
| UI | Cal Sans (variable), Geist fallback | 12–14.5px. Body 13.5, controls 12.5–13, titles 14–15 |
| Code / meta | Geist Mono 400 | 11–12.5px. Diff 12.5/22 |
| AI voice | Lora 400 | Brief 27/1.38; transcript 18/1.55; findings 16.5/1.45–1.5; compact cards 15.5/1.42 |

- Use `text-wrap: pretty` on serif paragraphs.
- Keep Newsreader, Source Serif 4 and Literata as tested serif alternates, and Inter and DM Sans as sans alternates.

## Radius
6 (chips), 7 (menu rows, small buttons), 8 (buttons, tabs, triggers), 9–10 (fields, toolbar controls), 12 (cards, menus), 14 (canvas, palette), 16–18 (composer, modal).

## Elevation
- Menu: `0 0 0 1px #2e2b28, 0 20px 50px rgba(0,0,0,.55)`
- Modal / palette: `0 0 0 1px #2a2826, 0 30px 80px rgba(0,0,0,.6)`, over a `rgba(8,7,6,.6)` scrim
- Composer: `0 0 0 1px #2a2826, 0 10px 30px rgba(0,0,0,.35)`
- Layered card: `0 0 0 1px #242220, 0 6px 20px rgba(0,0,0,.25)`

## Components

### Buttons
Heights are 28 (panel), 30 (default) and 32–34 (toolbar or hero).
- **Primary**: cream background.
- **Secondary**: transparent with an inset 1px `#2e2b28` ring. On hover: bg `#1f1e1c`, ring `#3a3632`.
- **Ghost**: `#8a857d` text. On hover: bg `#1c1b19`, text `#ede9e3`.
- **Icon button**: 28–32 square, same hover as ghost.

### Other components
- **Quiet trigger** (model picker): transparent, bg `#232120` on hover, `#2a2826` while its menu is open. It shows the model name, or the effort word in full in `#8a857d`.
- **Segmented control**: container `#1a1918` with inset ring `#232120`, padding 2–3. The active item is `#262422` or `#2a2826`; the thumb slides over 200ms.
- **Severity pill**: 11–11.5px/500, padding `1px 6–7px`, radius 5.
- **Keycap**: Geist Mono 10.5, padding `1px 5px`, radius 4, bg `#1f1e1c`–`#24221f`.
- **Switch**: 26×15 (menu) or 32×18 (settings), knob inset 2px. The knob slides over 160ms `cubic-bezier(.3,.7,.2,1)`; the track is primary when on and `#34312d` when off.
- **Search field**: 30px, radius 8, bg `#151413`, inset ring `#1f1e1c`, ⌘K keycap. On focus: bg `#1a1918`, ring `#3d3935` plus a 3px `rgba(237,233,227,.06)` halo.

### Model picker
The one pattern used everywhere a model is picked (Settings → Models roles today).
- **Two quiet triggers** at the row's right end: the model name, then the effort word in full (`Kimi K3` `High`, never `Med`) as a select with a small chevron. Models without an effort control and roles following another pick show only the model trigger.
- **Model dialog**: the model trigger opens a ⌘K-style search dialog (Sivir Command): the palette's frame, 560px wide and at most 480px tall, rows 34px. The search placeholder counts the models ("Search 471 models"); the role sits where the palette shows its scope ("Review model"). Footer: ↑↓ navigate, ↵ choose, esc close. The first frame mounts the rows around the current model, centered and highlighted; the rest fill outward after each paint behind same-height skeletons, so a long list opens at once and never moves. Arrow keys walk the rows in the order shown. Model settings are cached in localStorage without key previews.
- **List**: one scrolling list grouped by provider (labelled "Agent · Provider" when more than one agent runs models), providers A to Z. A row is a check column, the name, and the context window in mono on the right. It opens scrolled to the current model, which is the active row.
- **Search** matches every word anywhere in the model name, provider, agent or id, in any order ("openrouter kimi"). Providers with no matches drop out; nothing matching shows "No results found".
- **Effort select**: 230px, right-aligned to its trigger, one row per effort with its description. Options come from the selected model's capabilities. Switching to a model that lacks the current effort resets it to that model's default.
- There are two model picks, Review and Specialists; Specialists can follow Review ("Same as Review", the first row of its dialog). No per-role models. No Speed option.

### Model providers (Settings → Models)

- **One list, a row per provider**: ChatGPT (sign in), hosted providers (OpenCode Go, OpenCode Zen, OpenRouter: connect with an API key), then "Your own server". A row is name + one line (what it offers, or "N models · ••••key") + one action. Adding a provider means adding it to the server catalog, not new UI.
- **Connect** opens a small modal: API key, "Get a key ↗", inline error. The key is checked with a request that runs no model. Success goes straight to the provider's models.
- **Hosted models** come from the provider's catalog in a searchable checkbox list: added models checked and on top, context and input price in mono on the right. Models that need an API Recoder doesn't speak are listed dimmed and disabled, with the reason. Small catalogs (≤40) start with every supported model picked; OpenRouter starts with none.
- **Detect models** is only for your own server (vLLM, Ollama, LM Studio), inside its Manage modal with base URL, key and Add by ID.

### Out of usage

When a model's plan runs out (ChatGPT's cap, a hosted provider's 429 or 402 after retries), the review stops at once and the failure shows the out-of-usage notice instead of a generic error: a gauge icon in `sev-medium`, "{Provider} is out of usage", when it resets (a live countdown for ChatGPT, else a link to the provider's usage page), then **Switch model** (models from other providers, grouped; picking one moves Review, and Specialists if they were on the spent plan, then retries), View or Check usage, and Retry. With no other provider it offers "Add a provider". In chat only the latest such reply carries the notice. A full usage bar in Settings turns `danger`.

## Layout
- **Top bar**: 46px, bg `bg.chrome`. Left: the "Recoder" wordmark (no logo mark), Home, a 1px × 16px divider, one tab per open session, and `+`. Right: search (max 260px, shrinks to 170px), usage meter, settings, avatar. Tabs overflow into a menu rather than clipping.
- **Tab**: 30px, padding `0 10px`, radius 8, 13px. Status icon, repo name, `#PR` in mono 11.5 `text.faint`, and a mono 10.5 badge (progress while running, finding count when passed, "failed" on a danger tint). Inactive text `text.muted`; active tab gets a `bg.menu` pill with a 1px `line.control` inset ring.
- **Canvas card**: fills the rest of the page with an 8px margin on the sides and bottom, bg `bg.canvas`, 1px `line.card` border, radius 14, overflow hidden.
- **Panel headers are 44px**, the same as the diff header, so bottom borders line up. Docked right panels are bg `bg.panel` with a `line.divider` left border.
- **Transcript**: centered, max-width 740. User bubbles are `bg.bubble`, radius `14 14 4 14`, max 520, right-aligned. The composer floats over a `transparent → bg.canvas` fade.
- **Diff lines**: grid `44px 44px 18px 1fr`, mono 12.5/22.
- **Modal**: radius 16, `bg.raised-2`, modal elevation over the scrim.

## Behavior
- **Composer**: one box (radius 14, 10px padding all round) holding the input above a toolbar row: + (attach) on the left; the output speed, the model name, the effort select (no chevron, same muted color as the model) and Send on the right. The output speed is the newest reply's tokens per second in faint 11.5px mono with tabular digits (`~84 tok/s` while it is an estimate, `84 tok/s` once the provider's count arrives). It hides when another model is picked until a reply on that model reports one. Focus moves the ring from `#2a2826` to `#3d3935` over 150ms. Send is a round 28px up arrow: quiet while empty, primary with text. Enter sends; Shift+Enter inserts a newline. While a reply is pending Send becomes Stop (a 9px square). While the review or a reply is working, a spinner circles Send. The reply shows a shimmering "Thinking" line.
- **Streaming**: tool rows grow in (240ms) with a spinner that becomes a check, then their duration fades in. Streaming text shows a 2px caret blinking at 1s.
- **Async buttons keep a fixed width** across states. Apply fix is 112px: Apply fix → Applying (spinner) → Applied (check, transparent bg, success text). The finding's pill crossfades to "Fixed" and its title dims. A toast follows with Undo.
- **Copy** flips to "✓ Copied" in success green for 1.2s.
- **Trigger label changes** fade in and rise 2px over 180ms.
- **Menus** close on outside click and Esc.

## Assets
- Icons: Lucide, stroke 1.75, 12–16px.
- Fonts: Geist, Geist Mono and Lora from Google Fonts.
- No images or logo mark. The brand is the "Recoder" wordmark.

## Motion
Recoder is an everyday tool: menus and modals open thousands of times a day,
so motion confirms an action and gets out of the way. Feedback is quick but smooth;
menus and modals settle in from a slight scale and blur, and only movement that
explains a change (the tab pill, a panel unfolding) gets a short ease. The tokens
live in `app.css` (`--dur-*`, and Sivir's `--motion-*`).

| Token | Value |
|---|---|
| `hover` | color/background 100ms ease-out |
| `press` | none: controls never scale when pressed |
| `highlight` | Sivir menus: travels between items over 160ms; our own lists snap, 100ms opacity fade |
| `toggle` | 180ms: chevrons, switches, label swaps, row actions |
| `tab-pill` | 240ms cubic-bezier(.3,.7,.2,1); segmented thumbs too |
| `disclose` | 240ms height for panels and drawers that unfold |
| `menu` | 130ms fade + 3px rise in from 0.95 scale and 2px blur, 80ms out |
| `modal` | 150ms fade + 3px rise in from 0.95 scale and 2px blur, 70ms out |
| `enter` | None. Content replaces its skeleton in place with no fade, rise or stagger |
| `toast` | 220ms rise, 5s dwell |
| `shimmer` | 1.6s linear (text), 1.4s (skeleton) |
| `skeleton` | Hidden for the first 200ms, so data that lands sooner never flashes one |
| `spinner` | 0.9s linear |
| `reduced-motion` | transitions snap to 1ms; spinners stay |
