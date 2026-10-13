# Recoder review surface (apps/app)

The new web app. It keeps apps/web's look (warm near-black, Cal Sans, Lora
for the AI's voice, Geist Mono for code, one cream primary per region) and
reorganises everything around one question: **what does a person still have
to decide before this agent-written pull request can merge?**

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

- Top bar 46px: wordmark, Queue (with the count that needs you), a crumb
  (`repo #N`) on a review, then Search ⌘K, shortcuts and theme on the right.
- One canvas card, radius 14, 8px from the edges, like apps/web.
- Review page: 58px header (title, author, branch, tally, open on GitHub),
  then a 304px rail (Overview, Needs you, Checked for you, Files) and the main
  pane. Main content is centred at 720–760px; the file view widens to 1080px.
- The decide bar floats 20px above the bottom of the main pane over a fade to
  the canvas. It is the only floating panel besides menus and modals.

## Colour additions

Tokens live in `src/styles/tokens.css`, mapped onto Sivir and Tailwind.

- Attention classes: `--att-read` (amber), `--att-checked` (green),
  `--att-tests` (blue), `--att-skim` (neutral).
- `--sent` / `--sent-tint`: violet for "sent back to the agent", distinct from
  every severity.
- `--diff-focus`: the amber wash and 2px bar on lines an open decision names.
- New files render without the green add tint: every line is an addition, so
  the tint carries no information.

## Interaction rules

- **Keyboard first, and keyboard moves are instant.** j/k and arrows move,
  Enter starts with the riskiest, a/s/x decide, u undoes, h hands off, f opens
  the file, o or Esc returns to the overview, ? lists shortcuts, ⌘K searches.
  Content swaps with no animation and scrolls to the top.
- **Deciding advances at once** to the next open decision. The confirmation is
  the rail glyph morphing (180ms fade, blur and scale) and the header tally
  filling a pip. The bar never flashes a "done" state on the way past.
- **Keycaps press.** A shortcut presses every keycap that names it for 140ms,
  and the button holding it scales to 0.97, so the keyboard visibly presses the
  button it names.
- **Same decision twice changes nothing.** Only Undo reopens an item.
- **Enter and Space on a focused control belong to that control**, never to a
  page shortcut.
- **The palette opens with no animation.** It is keyboard-triggered many times
  a day. Modals and menus keep Sivir's short fade, 0.96 scale and 2px blur.
- **The likely call is the filled button.** High, medium and open questions
  fill Send back; low and quality findings fill Accept. Button positions never
  change.
- **Hover equals selection in the queue** (pointer movement only, so scrolling
  under a still cursor never moves it). The rail uses the snapping hover layer
  from `$web/shell/hover-highlight`.
- Skeletons wait 200ms before showing; content replaces them with no entrance.
- The tally is one pip per decision up to 12, then a bar split by outcome. A
  ring was tried and rejected: at partial fill it reads as a loading spinner.

## Code

Code is Sivir `FileDiff` everywhere: excerpts (±4 lines around a decision),
the suggested fix (a parsed patch) and the full-file view, which shows each
decision as a card under the line it ends on. Long lines wrap rather than
scroll per row.
