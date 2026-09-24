# Recoder design system (dark)

The source of truth for Recoder's UI. The screen specs are in `design_handoff_recoder_redesign/README.md`.

## Principles
- **Warm near-black surfaces, flat by default.** Depth comes from 1px rings and a few surface steps. Shadows are for floating things only (menus, modals, toasts, the composer).
- **Two voices.** The UI speaks in Geist sans. The AI speaks in Lora serif: summaries, findings, replies and the Home brief. Never mix them in one block.
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
- Hover: `filter: brightness(1.08)`. Press: scale .97.
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
| UI | Geist 400/500 | 12–14.5px. Body 13.5, controls 12.5–13, titles 14–15 |
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
- **Quiet trigger** (model picker): transparent, bg `#232120` on hover, `#2a2826` while its menu is open. The label is `Model Effort`, with the effort word spelled out in full in `#8a857d`.
- **Segmented control**: container `#1a1918` with inset ring `#232120`, padding 2–3. The active item is `#262422` or `#2a2826`; the thumb slides over 200ms.
- **Severity pill**: 11–11.5px/500, padding `1px 6–7px`, radius 5.
- **Keycap**: Geist Mono 10.5, padding `1px 5px`, radius 4, bg `#1f1e1c`–`#24221f`.
- **Switch**: 26×15 (menu) or 32×18 (settings), knob inset 2px.

## Motion
| Token | Value |
|---|---|
| `hover` | color/background 120ms ease-out |
| `press` | scale .97 (icons .92), 80ms |
| `highlight` | instant position, 120ms opacity fade |
| `tab-pill` | 240ms cubic-bezier(.3,.7,.2,1) |
| `menu` | 150ms cubic-bezier(.2,.8,.2,1), 4px rise, scale .98 → 1, origin at the trigger |
| `submenu` | 120ms, 4px horizontal |
| `enter` | 220ms fade + 4px rise, 40ms stagger |
| `toast` | 220ms rise 12px, 5s dwell |
| `shimmer` | 1.6s linear (text), 1.4s (skeleton) |
| `spinner` | 0.9s linear |
| `reduced-motion` | transitions snap to 1ms; spinners stay |
