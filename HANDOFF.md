# Handoff: Recoder dark redesign

Last updated 2026-09-23. Branch `adaptive-review`. Pick this up by reading this file, then `DESIGN.md`, then `AGENTS.md`.

## Where things are

We are implementing the "Modern AI Product Redesign" handoff for `apps/web` (SvelteKit + Svelte 5 runes, Tailwind v4, Sivir UI 0.3.2 in package mode). Work goes phase by phase, following `design_handoff_recoder_redesign/PROMPT.md`. Stop after each phase so the owner can review it.

| Phase | Screen(s) | Status |
|---|---|---|
| 1 Foundation | tokens, fonts, Sivir restyle | Done |
| 2 Shell | top bar, tabs, canvas card | Done |
| 3 Composer + model menu | 5c | Done |
| 4 Home | 3a | Done |
| 5 Live review | 3b running, 4f finished | Done |
| 6 Diff workspace | 3c inline, 3d focus | Done |
| 7 Right panels | 4a finding thread, 4b ask reviewer | **Next.** The panels open (Discuss, Ask reviewer) but still have the old styling |
| 8 Settings, first run, ⌘K | 4c, 4d, 4e | Settings (4c) and ⌘K (4e) are done early. **First run (4d) is not started** |

After phase 7, do 4d (first run). Then do a polish pass: check hover, press, focus, loading, empty and error states at 1280 and 1440 wide.

## Reference material (all in the repo)

- `DESIGN.md` (repo root): the design system. It has every token, the type scale, spacing, motion, and the component rules.
- `AGENTS.md` (repo root): the hard rules. Sivir only, md sizes, `ScrollArea showCues={false}`, no subtitles, and so on. Read it before touching UI.
- `design_handoff_recoder_redesign/`
  - `README.md`: per-screen pixel specs (sizes, colors, radii, copy). This is the main spec.
  - `PROMPT.md`: the original phase plan.
  - `Recoder Redesign.dc.html`: the artboards. Open it in a browser. Search it for `id="3b"` and similar to read exact inline styles.
  - `Recoder Interactions.dc.html`: the reference for hover, press, loading and motion.
  - `screenshots/`: the target designs, exported at 1440 CSS px (2x). File names match the artboard ids (`3a-home.png` … `5c-composer-model-menu.png`). **Every screen must match these.** Odd text wrapping in them is a capture artifact, so ignore it.
  - `current/`: what the app looks like now, at 1440×900. Compare each file against `screenshots/`.
    - `home.png` ↔ 3a
    - `conversation-running.png` ↔ 3b. It comes from the `/example?state=running` fixture.
    - `conversation-finished.png` ↔ 4f
    - `diff-inline.png` ↔ 3c
    - `findings-focus.png` ↔ 3d
    - `settings-models.png` ↔ 4c
    - `command-palette.png` ↔ 4e
    - `usage-modal.png`: no artboard exists for this one.
    - `composer-model-menu.png` ↔ 5c. It is an older capture, taken before the Phase 5 session header.
  - `tools/shot.ts`: the Playwright screenshot script used for all verification. See "Verifying" below.

## Owner decisions (don't re-ask)

- Icon buttons are 30px (`size="icon"`).
- The session `…` menu has "Close tab". The top-bar tabs also have a right-click ContextMenu with Open, Open diff, Copy pull request link, Close tab, Close other tabs, and Close tabs to the right.
- The session view switch is **Conversation · Findings · Diff**, kept in the URL as `?view=findings|diff`. Diff is the inline mode (3c), and Inline is the default. Findings is focus mode (3d).
- The Home AI brief comes from its own endpoint, `POST /api/home/brief`. It runs on the **Orchestrator** model (`configForOrchestrator()`), with a 30-minute cache and in-flight dedupe.
- **Text must be larger on 1440p and bigger monitors.** A PostCSS step in `apps/web/vite.config.ts` compiles every CSS px value of 2 or more into rem. `app.css` sets `html{font-size:112.5%}` at ≥1920px and `125%` at ≥2400px.
  - Write CSS in px as usual.
  - Multiply JS pixel constants by the root font scale (see `top-bar.svelte`).
  - **Never use CSS `zoom`**: it broke Floating UI menu positioning.
- AI prose runs **smaller than the handoff**: 16px in the transcript and 15px in finding bodies. The owner found 18px too large.
- The finished-review results rail (4f) cards **float** on the canvas, with no panel border or background.
- No top-left wordmark or logo.
- There is no traveling hover highlight in the top bar. The active tab pill is flat, has no border, and snaps.
- The Switch has no press stretch.
- Scrollbars are hidden on session pages.
- The usage meter in the top right opens a **Usage modal**, not Settings.
- Home repo chips use Sivir Tabs (segmented). PR row hover is flat, with no ring.
- Hovering a `#160` reference in the Home brief shows a HoverCard with PR details.
- **Streaming text has no caret.** Sivir's `.sivir-markdown-caret` is hidden. The paragraph being written gets the skeleton shimmer (a mask sweep).
- **Page animations are per element, not a full-page fade.** A View Transition crossfade was tried and rejected as ugly. Each page staggers its own pieces in, like the Settings → Connections list (`rc-enter`: 4px rise plus fade, 45ms steps). Chrome never moves: the top bar and the session header stay put.
  - The staging is the "Entrances" block at the end of `app.css`.
  - Hidden views replay it when shown, because `display:none` restarts animations.
  - Picking a finding in Focus mode re-keys the detail column so it animates.

## Design system in code

- **Tokens** are CSS custom properties in `apps/web/src/app.css`, named after `DESIGN.md`:
  - surfaces: `--bg-chrome #0d0c0b`, `--bg-canvas #141312`, `--bg-canvas-deep`, `--bg-raised #1a1918`, `--bg-menu`, `--bg-hover`, `--bg-bubble #211f1d`, `--bg-field`
  - lines: `--line-divider #1d1c1a`, `--line-card`, `--line-control #2a2826`, `--line-menu`, `--line-strong`, `--line-focus`
  - text: `--text-primary #ede9e3`, `--text-ai`, `--text-secondary`, `--text-tertiary`, `--text-muted`, `--text-subtle #8a857d`, `--text-faint #6f6a63`, `--text-ghost #57534d`
  - severity: `--sev-high`, `--sev-medium`, `--sev-low` and `--sev-info`, each with a `-tint`
  - status and diff: `--success`, `--danger`, `--diff-add`, `--diff-del`, `--syn-*`
  - motion: `--dur-*`, `--ease-menu`

  Tailwind utilities map onto them (`bg-canvas`, `text-fg-faint`, `text-sev-medium`, `text-danger`…). Sivir's theme variables are mapped onto the same tokens. **Components never use raw hex.**
- **Fonts:** Geist for the UI, Geist Mono for code and metadata, and Lora (`--font-ai`, via `.ai-voice`) **for the AI's words only**: summaries, findings, replies and the Home brief.
- **Restyle Sivir through unlayered CSS** on its `data-ui` / `data-variant` hooks in `app.css`. Never fork a component. The design's "secondary" button is Sivir `outline`, "ghost" is `ghost`, and quiet triggers are `quiet`. Allow one cream primary button per region.
- **Motion:**
  - Hover highlights are instant, and hover color fades over 120ms.
  - Menus rise 4px over 150ms.
  - Lists load with skeletons (`$lib/components/ui/skeleton.svelte`), then use `.enter-rise` with `--i` for a 40ms stagger.
  - Every async action shows idle → pending (spinner, same width) → success or failure.
  - Toasts come from `$lib/notify.ts` (`undoToast`, `errorToast`).
  - Respect `prefers-reduced-motion`.

### Sivir gotchas learned the hard way

- `cn()` merge order varies. Some parts (Modal.Footer, Tabs, Card) apply their own utilities *after* your class, so a conflicting class like `pe-5` is silently dropped. Restyle through `data-ui` hooks in `app.css` instead.
- Layered `!important` utilities (Tailwind `!h-9`) beat unlayered `!important` CSS. To change those, edit the markup.
- Button padding rules are scoped to `[data-ui='button'][data-variant][data-size]` (3 attributes). Overrides must match that specificity: write `[data-ui='button'][data-variant].my-class`.
- Tabs keeps its own value after a click. For a controlled switch whose instance can stay mounted (the conversation header is hidden, not unmounted), snap the value back after navigation. See `session-header.svelte`, and guard against reading props after unmount.
- The segmented Tabs pill only re-measures on list or window resize. `top-bar.svelte` has a `keepPillAligned` attachment for this.
- DropdownMenu content renders as `data-ui="popover-content"` inside `[data-floating-content]`, which carries `data-placement`.
- `Modal.Close` has a built-in `mr-auto`. Add `class="mr-0"` (or `ml-auto`) when you place it.
- Svelte-check rejects `style=` / `aria-*` on some Sivir parts (Card, Skeleton, Tabs.List). Pass them through a spread: `{...{ style: '…' }}`.
- Svelte 5 trims whitespace at element boundaries, so use margin spans for separators.
- `ScrollArea` always gets `showCues={false}`.

## File map (new or heavily changed)

**Web: `apps/web/src/`**
- `app.css`: all tokens and restyles (~3.5k lines), organised in sections: Voices, Composer (5c), Home, Palette, Settings (4c), Session header, Step row, Transcript, Results rail, Diff workspace, Motion, Entrances.
- `routes/+layout.svelte`: shell (TopBar, canvas card, modals, palette, toaster).
- `routes/+page.svelte`: Home (3a).
- `routes/session/[id]/+page.svelte`: session page. It holds conversation and diff state, the `setView` and `?view=` logic, and the diff workspace snippet.
- `routes/example/+page.svelte`: design fixture. `?state=running` gives 3b.
- **Shell:** `top-bar.svelte`, `usage-modal.svelte`, `command-palette.svelte`, `model-settings-modal.svelte` plus `settings-models|connections|harness|appearance.svelte`, `endpoint-card.svelte`, `codex-connection.svelte`, `provider-mark.svelte`.
- **Home:** `pr-row.svelte`, `$lib/open-prs.svelte.ts`, `$lib/home.ts`.
- **Composer:** `review-composer.svelte`, `model-picker.svelte`.
- **Live review:**
  - `session-header.svelte`: 52px header plus the Conversation · Findings · Diff switch
  - `review-steps.svelte`: 3b step row, built on Sivir TaskSteps restyled horizontally
  - `reviewing-view.svelte`, `review-conversation.svelte`: the transcript, which takes an ordered `inserts` list and a floating composer dock
  - `review-task-group.svelte`, `review-tool-call.svelte`, `review-results-rail.svelte`: the 4f cards
  - `live-review-progress.svelte`
- **Diff:**
  - `diff-file-header.svelte`: 44px header, Viewed, Unified/Split
  - `code-diff.svelte`: unified and split modes; `cards={false}` for the focus hunk
  - `finding-card.svelte`: the inline card
  - `findings-focus.svelte`: 3d
  - `suggested-fix.svelte`, `fix-button.svelte`
  - `findings-bar.svelte`: toolbar stepper, chips, and a `trailing` snippet plus Fix all
  - `session-sidebar.svelte`, `file-tree-node.svelte`: the 256px tree
- **State:** `$lib/shell-state.svelte.ts`, `palette.svelte.ts`, `settings-draft.svelte.ts`, `diff-prefs.svelte.ts` (Unified/Split, and per-review Viewed in localStorage), and `fixes.ts` (shared suggest/apply fix).
- `vite.config.ts`: the `pxToRem` PostCSS plugin.

**Server: `apps/server/src/`**
- `lib/home-brief.ts`, `routes/home.ts`: the brief endpoint, mounted at `/api/home` in `app.ts`.
- `lib/review-settings.ts`: `settingsFileDisplay()` feeds `configPath` in the settings payload.

**Shared:** `packages/shared/src/index.ts` adds the HomeBrief types and `ModelSettings.configPath`.

## Known deviations and missing data (already reported to the owner)

- **Fix flow starts at "Suggest fix".** A patch must be generated first, so the steps are Suggest fix → Preparing → suggested-fix box plus "Apply fix" → Applying → Applied. The button stays 112px wide throughout.
  - The "Fix applied" toast has **no Undo**, because the server has no revert endpoint.
  - Suggest and Apply have **not been clicked against a real review**. It would call the model and push to the PR branch.
- **"by severity, then confidence":** findings carry no confidence score, so the list is by severity only.
- **The running composer prompt lacks "@mention".** It reads "Ask Orchestrator anything…", because there is no @mention support yet.
- **Specialist names use the existing role labels,** so you see "Perf" and "Docs", not "Performance" and "Documentation". The owner hasn't decided whether to change them app-wide (`AGENT_LABELS` in `$lib/threads.svelte.ts`).
- **Real reviews post several interim Orchestrator messages,** and each renders as full serif prose. The design shows one.
- **No per-specialist finding count while running.** Findings arrive only at the end.
- **The coverage note is built from gap reasons,** not written prose.
- **Settings:**
  - The planning note wording differs from the design.
  - "Same as Orchestrator" shows only when "apply to all specialists" is on.
  - "Add endpoint model" was added.
  - ChatGPT reports only one limit.
- **⌘1 / ⌘2** switch views, but the browser may take them.
- **Finding ids** now show as `F-01` (was `R-01`).

## Verifying (do this before calling anything done)

```sh
bun run --filter @recoder/web check     # svelte-check, must be 0 errors / 0 warnings
bun run --filter @recoder/web build
bun run --filter @recoder/server check
bun run --filter @recoder/server test   # 196 pass at last run
bun run --filter @recoder/shared check
```

For screenshots, run the dev servers (web on :5173, API on :3001), then use `design_handoff_recoder_redesign/tools/shot.ts`:

```sh
mkdir -p /tmp/shot && cp design_handoff_recoder_redesign/tools/shot.ts /tmp/shot/
cd /tmp/shot && bun init -y && bun add playwright-core && bunx playwright install chromium
# The script hardcodes the executablePath from the original machine (~/.cache/ms-playwright/chromium-1243/...).
# Point it at your local chromium before running.
bun shot.ts /session/<review-id> out.png 1440 900 '[{"wait":800}]'
bun shot.ts "/session/<id>?view=diff" out.png 1280 800 '[{"click":"… >> visible=true"},{"wait":400}]'
```

- Actions: `hover`, `click` (with optional `button`), `press`, `type`, `wait`, `shot` (mid-sequence frame), and `eval` (prints JSON).
- The script seeds session tabs in localStorage using review ids from the original machine's database. Swap in your own ids from `GET /api/reviews`.
- Hidden views keep their DOM, so add `>> visible=true` to selectors.

Always compare against the matching `screenshots/` file, at 1440 and 1280 wide. The top bar must not clip: the search shrinks to 170px and extra tabs overflow into a "+N" menu.

## Next up: Phase 7 (right panels)

Spec: `README.md` sections 4a and 4b, and screenshots `4a-finding-thread.png` / `4b-ask-reviewer.png`.
- `thread-panel.svelte` (4a, the finding discussion) and the `#interactive-review` section in `routes/session/[id]/+page.svelte` (4b, Ask reviewer with selected code) still use the old look.
- Panel headers are **44px** so they line up with the diff header.
- The Ask reviewer panel uses `ReviewConversation compact`, whose `.review-chat[data-compact]` styles already shrink the prose.
- The Discuss buttons on inline cards and Focus cards call `threadsStore.open(id)`.

Then do 4d (first run) and the polish pass.
