# AGENTS.md

## Commands

- Web (SvelteKit): `bun run --filter @recoder/web check` · `bun run --filter @recoder/web build`
- Server: `bun run --filter @recoder/server check` · `bun run --filter @recoder/server test`
- Shared: `bun run --filter @recoder/shared check`

Run the relevant `check` (and tests) before finishing a change.

CI runs each package's `check`, `test` and `build` as its own job
(`.github/workflows/ci.yml`), so a failure names the package and task. Add a
matrix entry when a package gains a new task.

## Unit tests

Tests are `bun test`, next to the code they cover (`foo.ts` → `foo.test.ts`).
Only write a test when it would catch a bug that `check` and a quick manual run
would not.

Write a test for:

- Parsers and normalizers of outside input: diffs, model JSON, CLI output, SSE.
- Security boundaries: sandbox paths, symlinks, token storage, secrets in errors.
- Concurrency, retries, cancellation, deadlines and budgets.
- State that must survive a restart or reconnect.
- A bug you just fixed, so it stays fixed.

Don't write a test for:

- Prompt wording or copy (`toContain('some sentence')` on a prompt).
- Constants, enums, lookup tables or config echoed back.
- Behavior the type system or a library already guarantees, like a schema
  rejecting a malformed body.
- Trivial getters, one-line wrappers or string formatting.
- Anything another test already covers.
- Anything that needs the real network, a logged-in CLI or the real data dir.
  Stub `fetch`, use a fake binary on `PATH`, and point `RECODER_DATA_DIR` at a
  temp dir.

Keep each test to one behavior, named as a sentence about that behavior. When a
change makes a test obsolete, delete the test.

## UI requirement (mandatory — no exceptions)

- **ALL UI must be built with Sivir UI components** from `@sivir-ui/svelte`.
  This is a hard requirement. Never hand-roll a control or surface when a Sivir
  component exists (buttons, triggers, modal/sheet/popover/dialog, menus,
  selects, inputs, cards, collapsibles/disclosures, alerts, badges, tabs,
  tooltips, scroll areas, skeletons, progress, typography, etc.).
- **Before making ANY UI change**, first find the Sivir component(s) that cover
  it, then build with them. Do not ship raw `<div>`/`<details>`/`<dl>`/native
  form controls or bespoke overlays as a substitute for Sivir primitives.
- **Verify it actually works before finishing.** At minimum run
  `bun run --filter @recoder/web check` and `bun run --filter @recoder/web build`,
  and confirm the interaction/render is correct. Do not claim a UI change works
  without this verification.

## UI conventions

- **Default control size is `size="md"`.** Sivir `Button`, `Select.Trigger`,
  `Modal.Trigger`, `Modal.Close`, and other button-based triggers already
  default to `md`, so omit the `size` prop rather than passing it.
- Do **not** pass `size="sm"` unless a compact control is explicitly required
  (e.g. a dense toolbar row). Prefer `md` everywhere else.
- For square icon-only controls use `size="icon"` (30px via `--size-icon-md`);
  don't shrink icon buttons below 28px.
- Sivir `ScrollArea` must always be used with `showCues={false}`. We never use
  the blur/edge-fade scroll cues.
- We do not use subtitles in our headings only titles.

## Recoder design system (dark redesign)

Read `DESIGN.md` before touching any UI in `apps/web`. It holds the tokens,
component specs, layout and behavior rules.

- Tokens are CSS custom properties in `apps/web/src/app.css`, named after the
  DESIGN.md tokens (`--bg-canvas`, `--text-muted`, `--sev-high`…), with
  Tailwind utilities (`bg-canvas`, `text-fg-faint`, `ring-line-card`…). Sivir's
  theme variables are mapped onto them. Components reference tokens, never raw hex.
- Restyle Sivir through tokens and `data-ui`/`data-variant` hooks in `app.css`;
  never fork a component to change its look. Design "secondary" button =
  Sivir `outline`; design "ghost" = `ghost`; quiet triggers = `quiet`.
- **Top bar shell only.** Sessions are tabs next to Home. Do not reintroduce
  the left sidebar.
- **Serif is for the AI's words only** (summaries, findings, replies, the Home
  brief) via `.ai-voice`. Everything else is Geist; code and metadata are Geist Mono.
- **No logo mark** anywhere, including next to AI messages.
- **One model picker pattern**: the quiet trigger (`5.6 Sol Medium`) opening the
  Model / Reasoning effort menu with submenus. Effort options come from the
  model's capabilities; never hardcode Low/Med/High; spell effort words in full;
  no speed option.
- **Quiet at rest.** Triggers, icon buttons and ghost buttons have no
  background until hovered. One cream primary button per region.
- **Hover highlight is instant** (`hoverHighlight` in `$lib/hover-highlight.ts`
  or Sivir's item highlight): snap to the item, fade 120ms. Only the active
  tab pill animates position.
- **Every async action has visible states**: idle → pending (spinner, same
  width) → success or failure. Destructive or pushed-to-git actions get a
  toast with Undo where possible (`$lib/notify.ts`).
- **Lists load with skeletons** (`$lib/components/ui/skeleton.svelte`), then
  fade in with a 40ms stagger (`.enter-rise` + `--i`). No spinner in place of a list.
- **Panel headers are 44px**, matching the diff header, so borders line up.
- Respect `prefers-reduced-motion`. Keep body text at 4.5:1; use `text-fg-faint`
  and below only for metadata.
- Before calling a UI task done, compare against `DESIGN.md` and check
  hover, press, focus, loading, empty and error states at 1280 and 1440
  wide. The top bar must not clip: the search shrinks to 170px and tabs
  overflow into a menu.
- **Large screens scale via rem.** A PostCSS step in `apps/web/vite.config.ts`
  compiles every CSS px (tokens, Tailwind arbitrary values, Sivir) to rem, and
  `app.css` raises the root font size at 1920px and 2400px widths. Write CSS in
  px as usual; multiply JS pixel constants by the root font scale. Never use
  CSS `zoom` (it breaks Floating UI menu positioning).
