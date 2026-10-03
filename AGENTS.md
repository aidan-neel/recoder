# AGENTS.md

## Commands

- Web (SvelteKit): `bun run --filter @recoder/web check` · `test` · `build`
- Server: `bun run --filter @recoder/server check` · `test`
- Shared: `bun run --filter @recoder/shared check` · `test`
- Site: `bun run --filter @recoder/site check` · `build`
- Lint (any package): `bun run --filter @recoder/<package> lint` runs ESLint
  and `prettier --check`.
- Dead and duplicated code (repo): `bun run deadcode` runs knip and jscpd.
- Format: `bunx prettier --write <paths>` then `bunx eslint --fix <paths>`.

Run the relevant `check`, `lint` and tests before finishing a change, and
`deadcode` when you remove or move code.

CI runs each package's `check`, `test`, `build` and `lint` as its own job,
plus one `deadcode` job for the repo (`.github/workflows/ci.yml`), so a failure
names the package and task. Add a matrix entry when a package gains a new task.
jscpd fails on any clone (`.jscpd.json`); CSS is excluded.

## Code style (mandatory)

ESLint (`eslint.config.js`) and Prettier (`.prettierrc.json`) enforce most of
this. Treat a lint error as a bug, not a suggestion.

- **Formatting.** Prettier owns layout: tabs, single quotes, 120 columns.
  Never hand-format against it.
- **Line spacing.** Code reads in blocks, never as one dense wall. Leave a
  blank line after imports, before `return`, around multi-line statements and
  blocks, around groups of declarations, and between functions, classes,
  types and exports. `eslint --fix` applies the padding rule.
- **Comments are JSDoc docstrings only.** No `//` comments and no plain
  `/* */` blocks in TS, JS or Svelte, and no `<!-- -->` in markup. Put the why
  in a short `/** … */` on the declaration it explains. If a step inside a
  function needs a comment, extract it into a named function with a docstring
  instead. Don't narrate what the next line does. Tool directives
  (`eslint-disable-next-line rule -- reason`, `@ts-expect-error`,
  `svelte-ignore`) are allowed. CSS keeps short `/* */` section comments.
- **Files stay under 500 lines**, tests included (`max-lines`). Split along
  real seams before a file gets there. When you split a module, keep its
  original path as the entry so imports don't churn.
- **Scoped folders.** Code lives in a folder named for its feature, not in a
  flat `lib/`:
  - Server `apps/server/src/`: `agents/<cli>/`, `models/`,
    `review/{pipeline,session,chat,guidelines,fixes}/`, `evidence/`,
    `sandbox/`, `forge/`, `home/`, `routes/`, `commands/`, `util/`.
  - Web `apps/web/src/lib/`: `api/`, `review/`, `findings/`, `diff/`,
    `session/`, `settings/`, `home/`, `shell/`, with components under
    `lib/components/<feature>/` and Sivir wrappers in `lib/components/ui/`.
  - Web styles: `apps/web/src/app.css` imports the parts in
    `apps/web/src/styles/`.
  - Shared: `packages/shared/src/` by topic, re-exported from `index.ts`.
- **No duplicated code.** Before writing a helper, search for one. When two
  places need the same logic, move it to one module both import. Code used by
  both server and web belongs in `@recoder/shared`.
- **No dead code.** Delete unused files, exports, parameters, branches and
  commented-out code in the same change that makes them unused. Don't export
  what only the file itself uses.

## Unit tests

Tests are `bun test` files in each package's `tests/` folder, which mirrors
`src/` (`apps/server/src/forge/gh.ts` →
`apps/server/tests/forge/gh.test.ts`). Never put a test next to the code.
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

## Review pipeline

Recoder is a self-hosted PR reviewer that runs the coding agents users already
have, verifies every finding, and posts the survivors on the PR. The roadmap is
issue #6. Read it before changing anything under `apps/server/src/review/`,
`agents/`, `evidence/` or `sandbox/`.

**Direction.** These describe where the code is heading, not all of what it does today.

- Agents run through adapters (`agents/registry.ts`). Don't grow the in-house
  JSON loop or add small-model workarounds.
- One primary reviewer, plus targeted subagents only when needed (#15). Don't
  add roles, planner passes or dispatch levels.
- GitHub/GitLab inline comments are the primary surface (#17). The dashboard
  stays, but new review features land on the PR first.
- The verifier may run on a different vendor than the reviewer (#16).

**Rules that apply now:**

- **Never write to the PR.** No commits, pushes or branch writes. Fixes are
  suggestions only, and a trivial, mechanical one becomes a GitHub/GitLab
  suggestion block.
- **Never hold a user's subscription login.** Run the user's installed agent
  CLI with its own sign-in. The ChatGPT OAuth path in `agents/codex/` is being
  removed (#13); don't extend it.
- **PR code runs only in the sandbox** (`sandbox/exec-sandbox.ts`), offline,
  with the checkout restored after each command. An agent CLI never gets its
  own shell or write access to the checkout.
- **Each agent's scratch files are its own** (`sandbox/exec-workspace.ts`).
  Never share a scratch path between agents.
- **Verification settles on the verifier's own runs and their outcome.** Never
  settle on another agent's run or a baseline check. A refutation without such
  a run never drops a finding; it stays unverified with the reason.
- **Webhook reviews are unattended** (`ReviewControl.unattended`). Nothing on
  that path may wait for a person.
- **One schema per model output.** On a mismatch, send the validation error
  back to the agent. Don't add code that repairs the model's text, and don't
  pick prompts by model name.
- **Review quality is measured, not argued.** A change meant to improve review
  quality (prompts, dispatch, verification, consolidation, model or adapter
  defaults) reports eval-suite results before and after (#7). Until the suite
  exists, say plainly that the quality effect is unmeasured.

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
  then follow **Visual verification** below. Do not claim a UI change works
  without both.

## Visual verification (mandatory for UI work)

`check` and `build` passing does not mean a UI change looks right. Any change to
UI, styling, tokens, layout, motion, or interface copy must be seen in a real
browser before you report it done.

1. Use the running web dev server at the URL it printed (Vite defaults to
   `http://localhost:5173` and moves to the next free port when that one is
   taken). If none is running, start `bun run dev` from the repo root.
2. Open every screen the change touches. Screenshot each one in dark and light
   mode at 1280 and 1440 wide. Also check 1920 when the change touches sizing,
   because the root font scales up there.
3. Exercise the states the change affects: hover, press, focus, open menus and
   modals, pending, success, failure, loading skeleton, empty, and error.
   Screenshot each.
4. For motion (menu and modal entrances, the hover highlight, tab pill,
   skeleton-to-content swap, layout shift), capture 8 to 10 frames across the
   transition. Do not judge motion from code alone.
5. Read every screenshot yourself against `DESIGN.md`. Look for clipping
   (especially the top bar), layout shift, horizontal overflow, low contrast,
   and anything inconsistent with neighboring UI. Check the console for errors
   and hydration warnings.
6. Fix what you find and capture again. Repeat until the result is clean.
7. In your final summary, list what you captured and what you fixed. If you
   could not verify visually, say so plainly. Never claim a visual change
   looks right without screenshots.

A browser is always available on this machine. Never conclude otherwise:

- Try the Playwright MCP (`browser_*` tools) first. If it fails with
  "Chromium distribution 'chrome' is not found", use the fallbacks below
  instead of stopping.
- For a one-off screenshot:
  `bunx playwright@1.60.0 screenshot --color-scheme=dark --viewport-size=1440,900 --wait-for-timeout=1000 <url> <out.png>`
- For interaction or frame capture, write a script in your scratchpad, outside
  the repo, that imports `chromium` from `'playwright@1.60.0'`, and run it with
  `bun script.mjs`. Bun installs it automatically. Never add these scripts or
  Playwright to the repo.
- The theme follows `prefers-color-scheme` unless `localStorage['recoder-theme']`
  is set, so emulate the color scheme to switch modes.
- Open the PNGs with the Read tool to view them.

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
- **Cal Sans is the default UI face** (`--font-ui`, served from
  `static/fonts/CalSansVF.ttf`, Geist as fallback); code and metadata are Geist Mono.
  Chat replies in the conversation use the UI sans. Serif (`.ai-voice`) remains
  only for summaries, findings and the Home brief.
- **No drop shadows on panels, cards or the composer** in either theme
  (`--drop: 0`); only menus and modals float.
- **No logo mark** anywhere, including next to AI messages.
- **One model picker pattern**: the quiet trigger (`5.6 Sol Medium`) opening the
  Model / Reasoning effort menu with submenus. Effort options come from the
  model's capabilities; never hardcode Low/Med/High; spell effort words in full;
  no speed option.
- **Quiet at rest.** Triggers, icon buttons and ghost buttons have no
  background until hovered. One cream primary button per region.
- **Hover highlight is instant** (`hoverHighlight` in `$lib/shell/hover-highlight.ts`
  or Sivir's item highlight): snap to the item, fade 60ms. Only the active
  tab pill animates position.
- **Motion is for an everyday tool, not a demo.** Use the `--dur-*` and
  `--motion-*` tokens in `app.css`, never a raw duration. Menus and modals
  enter with a short fade, a 0.95 scale and a 2px blur (the `--motion-*`
  tokens, under ~200ms); don't add other entrances to things the user opens
  repeatedly.
- **Every async action has visible states**: idle → pending (spinner, same
  width) → success or failure. Destructive or pushed-to-git actions get a
  toast with Undo where possible (`$lib/shell/notify.ts`).
- **Lists load with skeletons** (`$lib/components/ui/skeleton.svelte`), then
  swap in place with no entrance animation. No spinner in place of a list.
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
