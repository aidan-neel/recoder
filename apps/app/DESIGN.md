# Recoder review surface (apps/app)

The standalone Recoder app: a Next.js 16 App Router app (React 19, Tailwind v4)
built on the shared React kit, `@recoder/ui` (`packages/ui`). It keeps the look
of apps/web and the root `DESIGN.md`: the same tokens, warm neutrals, quiet
controls, one canvas card under a 46px top bar, and the serif AI voice. The UI
face is **Inter**; code and metadata are Geist Mono; summaries, briefs and
findings are Lora (`.ai-voice`).

What is new is how a review is organised, around one question: **what does a
person still have to decide before this agent-written pull request can merge?**

## The kit

- Every control and surface comes from `@recoder/ui`: Radix primitives styled
  with the Recoder tokens, plus `motion` for movement. apps/app never hand-rolls
  a button, menu, dialog, popover, tooltip, select, input, tab strip or scroll
  area. When the kit lacks a piece, add it to `packages/ui`, not to the app.
- Tokens live in `packages/ui/src/styles/tokens.css` and map onto Tailwind
  utilities (`bg-canvas`, `text-fg-faint`, `ring-line-card`…). Components use
  tokens, never raw hex or raw durations.
- The kit's control CSS (buttons, display, form) sits in `@layer components`,
  so a `className` utility wins over it. Menus, overlays and code are
  unlayered. Restyle through `data-ui`, `data-variant` and `data-state` hooks.
- App styles are one file per feature in `src/styles/`, imported by
  `src/styles/app.css`.

## The model

A review becomes three lists (`src/lib/review/surface.ts`):

| Name | What it holds | Where it comes from |
|---|---|---|
| **Needs you** (decisions) | Findings, and brief questions no reviewer could settle | `Review.findings`, `Review.questions` with result `unresolved` |
| **Checked for you** (receipts) | Behaviour a reviewer investigated and found sound, with the command it ran | Questions `disproved`, obligation answers `disproved`, plus CI checks |
| **Change map** | Every changed line in one of four classes | Files, open decisions, reviewer context |

Change map classes: **Read** (lines within 10 of an open decision, or a file no
reviewer opened), **Checked** (examined, nothing open), **Tests** (test code is
evidence, not behaviour) and **Skim** (lockfiles, docs, generated). The
overview leads with "N of M changed lines need your eyes" and a minute
estimate. Deciding an item moves its lines from Read to Checked, so the bar
shrinks as the person works.

A decision ends one of three ways: **Accept** (a real point, ships as is),
**Send back** (goes to the coding agent) or **Not an issue** (dismissed on the
server, so Recoder stops raising it). Decisions are kept per review and head
commit in localStorage; a new push starts clean. Everything sent back becomes
one **handoff** prompt for the agent that opened the PR, with locations, repro
commands and the person's notes.

The queue orders pull requests the same way: Needs you, Reviewing, Not
reviewed, With the agent (every decision made, some sent back), Ready to merge.

## Layout

- **Top bar** (46px): Queue, then one tab per open review (badge = open
  decisions; the close button, middle-click or the tab menu closes one; tabs
  that do not fit go into an overflow menu), the search field that opens the
  ⌘K palette (it also lists every past review), and the settings button. Tabs
  persist in localStorage.
- **First run** replaces the queue until a provider, a model and a repository
  are set. The sample review is always one click away.
- **Queue**: the serif headline, grouped rows, j/k marks a row, Enter opens it.
- **Review page**: a 44px header (`#214`, title, repo, author, branch, head),
  then a 304px rail (Overview, Needs you, Checked for you, Files) and the
  reading pane, centred; the file view widens. The selection lives in the URL
  (`?item=`). The ask column opens on the right: on a decision or receipt it
  asks that item's reviewer; on the overview or a file it is the conversation
  with Orchestrator, for the review's whole life. While a review runs, live
  progress (stages, reviewers, pause, cancel, continue) takes the reading
  pane.
- **Settings**: a nav column (Agent, Connections, Review harness, Guidelines,
  Appearance) and one centred column of grouped rows.

## App-only tokens

`--att-read`, `--att-checked`, `--att-tests`, `--att-skim` (change map
classes), `--sent` (violet, "sent back to the agent") and `--diff-focus` (the
amber wash on lines an open decision names) are defined in the kit tokens.
New files render without the green add tint, since every line is an addition.

## Motion

Motion explains a change and never makes the person wait.

- Things that move: the active tab pill and settings nav pill slide; a queue
  row slides to its new group; a decided item's glyph morphs; counts and the
  change map bar roll to new values; collapsibles open by height; menus and
  modals enter with a short fade, a 0.95 scale and a 2px blur.
- Things that do not move: keyboard moves (j/k, deciding, advancing) swap
  content at once and scroll to the top. Lists load with skeletons and swap
  in place with no entrance animation. A page paints once, fully formed.
- Durations and easings come from the kit presets (`DURATION`, `EASE_OUT`,
  `SPRING`); nothing on a keyboard path runs longer than ~150ms.
- `prefers-reduced-motion` turns movement into plain swaps.

## Interaction rules

- **Keyboard first.** On the queue j/k move, Enter opens and r starts a
  review. On a review j/k and arrows move, Enter starts with the riskiest,
  a/s/x decide, u undoes, h hands off, f opens the file, o or Esc returns to
  the overview, q opens or closes ask, and Space, Shift+Space, Page Up/Down,
  Home and End scroll the reading pane. In the ask field, Escape closes ask
  when the field is empty. Everywhere ? lists shortcuts, ⌘K searches and ⌘,
  opens settings. Held keys never repeat a decision.
- **Deciding advances at once** to the next open decision; the rail glyph
  morphs and the header tally fills a pip. Undo reopens.
- **Keycaps press.** A handled shortcut lights every keycap that names it.
- **Enter and Space on a focused control belong to that control.** Page keys
  stand down while typing or while a dialog or menu is open.
- **The likely call is the filled button.** High, medium and open questions
  fill Send back; low and quality findings fill Accept. Positions never change.
- **Every async action shows its state**: idle, pending (same width), then
  success or failure. Destructive actions confirm or offer Undo.

## Code

Code renders with the kit's `CodeLines`: excerpts (±4 lines around a
decision, ±3 around a receipt), the suggested fix (a parsed patch) and the
full-file view, which shows each decision under the line it ends on.
