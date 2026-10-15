# Recoder review surface (apps/app)

The new web app. It runs on apps/web's design system verbatim: `src/app.css`
imports `apps/web/src/app.css`, so tokens, the Sivir mapping, menus, modals,
the ⌘K palette, keycaps, rows and motion are the old app's own. The one
deliberate difference is the UI face, **Inter** (`--font-ui` in
`src/styles/app-tokens.css`); code stays Geist Mono and the AI voice Lora.
What is new is how a review is organised, around one question: **what does a
person still have to decide before this agent-written pull request can merge?**

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

- The old shell, unchanged: a 46px top bar with segmented tabs (Queue, then
  one tab per open review, badge = open decisions; middle-click or the context
  menu closes one), the quiet "Search or ask Recoder ⌘K" field, and one canvas
  card. Review tabs persist in localStorage, six at most.
- Queue is apps/web's Home list: the serif brief, `group-head` sections, and
  `pr-row` rows with the snapping hover layer, status chips and the Review
  button revealed on hover. j/k marks a row with the inset bar the old rows use.
- Review page: the old 52px session header (`#214`, title, author, branch),
  then a 304px rail (Overview, Needs you, Checked for you, Files) and the main
  pane, centred at 720–760px; the file view widens to 1080px.
- The decide bar floats over the bottom of the main pane like the old composer
  (radius 14, `--shadow-composer` ring, no drop shadow), over a fade to the
  canvas.

## Settings

A modal, as in apps/web, opened by the sliders button at the right of the
top bar, ⌘, or a section's row in ⌘K (the palette's Settings group). It
reuses apps/web's section components and stores (`modelSettingsUi`,
`settingsDraft`), so apps/web's own "Open settings" calls open it too. Unlike
apps/web's modal:

- The nav has a search field (Enter opens the first match) and an icon per
  section; the config path sits at its foot.
- There is no footer. Edits save as they are made, 400ms after the last one,
  through `src/lib/settings/autosave.svelte.ts`; the header shows Saving,
  Saved, or Not saved with Retry. Closing saves anything still waiting.
- Only Agent and Review harness wait for the saved config; the other
  sections render at once.

## App-only tokens

`src/styles/app-tokens.css` defines what apps/web has no token for, in terms
of its tokens: the change map's classes (`--att-read`, `--att-checked`,
`--att-tests`, `--att-skim`), `--sent` (violet, "sent back to the agent") and
`--diff-focus` (the amber wash on lines an open decision names). New files
render without the green add tint, since every line is an addition.

## Interaction rules

- **Keyboard first, keyboard moves are instant.** j/k and arrows move, Enter
  starts with the riskiest, a/s/x decide, u undoes, h hands off, f opens the
  file, o or Esc returns to the overview, ? lists shortcuts, ⌘K searches.
  Content swaps with no animation and scrolls to the top.
- **Deciding advances at once** to the next open decision; the rail glyph
  crossfades and the header tally fills a pip. Same decision twice changes
  nothing; Undo reopens.
- **Keycaps press.** A shortcut lights every keycap that names it for 140ms.
  Buttons never scale, as in apps/web.
- **Enter and Space on a focused control belong to that control.** Page keys
  stand down while typing or while a dialog or menu (`role="dialog"`/`menu`)
  is open.
- **The likely call is the filled button.** High, medium and open questions
  fill Send back; low and quality findings fill Accept. Positions never change.
- Skeletons are apps/web's (`$web/components/ui/skeleton.svelte`).

## Code

Code is Sivir `FileDiff` everywhere: excerpts (±4 lines around a decision),
the suggested fix (a parsed patch) and the full-file view, which shows each
decision as a card under the line it ends on. Long lines wrap rather than
scroll per row.
