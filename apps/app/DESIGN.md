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
  `src/styles/app.css`. `review.css` imports `review-head.css` and
  `review-rail.css` at its top, so anything that imports `review.css` (the
  site's `hero.css`) gets all three, and its narrow-window rules come after
  the rail's own.

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

A dismissal or restore that doesn't reach the server keeps the person's
decision. Its toast says why, with Try again. Until a write lands or a newer
change replaces it, the decision shows a quiet "Not saved" with Try again,
and its rail row a small cloud mark with the same words on hover. The failed
write is kept in localStorage, so a reload still shows it. A Try again that
lands says "Saved".

Accept and Send back also tell the server the finding was useful, and
reopening takes that back, so Recoder learns per repository which topics
(a rule, a smell or a category) people want raised. Findings of a topic
people keep marking not an issue come back **quieted**: the rail lists them
last in Needs you, under a closed "Quieted" group by topic, and they count
toward nothing (counts, tally, tab badge, reading lines, j/k). A quieted
finding opens to read, with no decision bar; its topic's Turn back on puts
its findings into Needs you where they rank.

Needs you leads with the riskiest: high, then medium, then open questions,
then low. Real risks come before quality findings and proven before
unproven; the rest go by path, then line.

The queue orders pull requests the same way: Needs you, Reviewing, Not
reviewed, With the agent (every decision made, some sent back), Ready to merge.

## Layout

- **Top bar** (46px): Queue, then one tab per open review (badge = open
  decisions; the close button, middle-click or the tab menu closes one; tabs
  that do not fit go into an overflow menu), the search field that opens the
  ⌘K palette (it also lists every past review), and the settings button. Tabs
  persist in localStorage.
- **Tab fit**: a review tab is at most 256px. A repo name up to 72px shows
  whole; a longer one gives way to 72px before the title does, and the full
  name shows on hover. A pull request with no title shows its number alone.
  When tabs need room, the 240px search shrinks to 170px. A bar too narrow
  for that (a phone) shows the search as its icon alone. The open review's
  tab stays in the bar whenever it fits, even when that takes the search
  down to its icon.
- **First run** replaces the queue until a provider, a model and a repository
  are set. The sample review is always one click away.
- **Queue**: the serif headline, grouped rows, j/k marks a row, Enter opens it.
- **Queue row**: the title, then a meta line that reads author · head branch
  → base · size. On a narrow row the meta line gives way in whole steps,
  never cut mid-word and never with a stray dot: the head branch truncates to
  three letters, then drops with its dot; then the base drops with its arrow;
  then the size drops its age and sent-back count; the author truncates
  last. At 480px and below, the pill or action drops under the meta line and
  the size takes its own line.
- **Review page**: a 44px header (`#214`, title, repo, commit, size, author,
  branch), then a 304px rail (Overview, Needs you, Checked for you, Files)
  and the reading pane, centred; the file view widens. The selection lives
  in the URL (`?item=`). The ask column opens on the right: on a decision or
  receipt it asks that item's reviewer; on the overview or a file it is the
  conversation with Orchestrator, for the review's whole life. While a
  review runs, live progress (stages, reviewers, pause, cancel, continue)
  takes the reading pane.
- **Review header**: a pull request with no title reads "#154 Pull request",
  the number once, and so does the page title. Author and branch come from a
  lookup that may answer after the page paints, so they sit last and give way
  first, each dropping whole when it has no room, never clipped: the branch
  first cuts its name to about 8 letters, then drops, then the author. As the
  header narrows, the commit goes at 1480px, the branch at 820px, the author
  at 660px and the rest of the meta at 520px. The header's one note takes
  only the room the title and the meta leave: "Not refreshed since 10:42"
  with a quiet Try again when the copy on screen couldn't be brought up to
  date, else "Reconnecting…" while the live stream reconnects. Below 1100px
  the time drops first, and a note with no room stays hidden rather than
  squeeze the title.
- **Narrow windows**: the review page's widths; Settings stacks under 720px
  (see Settings). Under 760px the rail narrows to 232px. Under 560px it
  stacks above the reading pane and takes at most 40% of the height. Under
  960px the ask column lies over the rail and the reading pane instead of
  pushing them aside. A panel it mostly hides goes inert, so Tab and clicks
  never reach a control under it.
- **Settings**: a nav column (Agent, Connections, Review harness, Guidelines,
  Appearance) and one centred column of grouped rows. Under 720px the nav
  stacks above the section, its links wrap in rows, and its own header hides,
  since the section title names the page. A control too wide to leave the
  name 120px (the model picker) drops under it, at the right. Under 460px
  each forge row and its placeholder hold two lines under the name, so a line
  that wraps moves nothing when the rows land.

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
  modals enter with a short fade, a 0.95 scale and a 2px blur, with no rise;
  tooltips fade in from a 0.95 scale in 100ms (80ms out), with no blur and
  no rise; toasts rise 10px.
- An active pill (top bar tab, settings nav, segmented control) is drawn in
  place on a page's first paint and travels on the kit spring from the frame
  after its control paints.
- The ask column grows to 380px in 140ms (ease-out) while its content fades
  in, and folds away as fast (ease-in).
- The decision bar stays mounted once a decision has been selected. It fades
  in with an 8px rise (`--dur-swap`, ease-out) and sinks out in 80ms
  (`--dur-press`, ease-in), switched by `data-state`, so moving between items
  never mounts or unmounts it. Focus inside it moves to the reading pane when
  it hides.
- Text whose old and new values must never overlap (the queue headline, a
  row's pill, settings and setup descriptions) swaps with
  `SwapText mode="wait"`: the old value leaves before the new one shows.
  The new one is drawn at once and held unseen by a CSS delay as long as the
  leave (none under reduced motion), and an empty value skips the leave.
- Menu highlights and the rail's selection layer follow a change in the next
  animation frame, before its paint, at most once a frame. A resize moves
  them at once, with no slide.
- On the sample page a running row's spinner turns twice and its label
  swells once, so an idle sample page is still. The rule holds only inside
  `.queue-page`, so the site's hero demo keeps moving.
- Things that do not move: keyboard moves (j/k, deciding, advancing) swap
  content at once and scroll to the top. Lists load with skeletons and swap
  in place with no entrance animation. A page paints once, fully formed.
- Durations and easings come from the kit presets (`DURATION`, `EASE_OUT`,
  `SPRING`); nothing on a keyboard path runs longer than ~150ms.
- `prefers-reduced-motion` drops movement: rises, scales, blurs and slides
  stop. Fades driven by the kit presets (menus, modals, swaps) and the
  decision bar's fade stay, at 80ms at most. Other CSS transitions snap, and
  spinners keep turning.

## Loading and fallbacks

- The server render is the boot frame: the first paint already shows the top
  bar, the canvas and the page's skeleton. The page then paints once, with
  all of its first-paint data.
- **Skeletons** hold and fade as the root `DESIGN.md` says (hidden for
  120ms, then a 140ms fade), but the wait counts per loading episode: the
  skeletons that take each other's place while one page loads. A skeleton
  that replaces another keeps its clock, so it never starts its wait again.
  One that stands where a page the person was looking at stood skips the
  wait and shows in full at once, with no fade. A page that lands with only
  its frame (its nav, its title, and the titles of groups still loading)
  counts as a skeleton here, so its skeleton rows show at once instead of
  empty cards. A late part's skeleton that lands with the page's content
  waits on its own (`skeleton-handoff.ts`).
- **A full page load waits 240ms**, counted from its first paint. The
  server's frame paints before the page has asked for its data, so a load
  that answers within that never shows a skeleton. The boot script marks
  `<html>` (`data-boot-wait`), and only the skeletons read the longer wait,
  so nothing else timed from `--skeleton-delay` waits longer. It dates the
  holds from the first paint, since the browser dates them when its
  compositor starts them, which on a busy start can be tens of milliseconds
  later. The wait goes back to 120ms when the first episode ends, when
  content first replaces a skeleton, on the first navigation, or at once
  when the first paint holds no skeleton (a 404). A skeleton already fading
  in when the wait ends carries on from where it was, and one the shorter
  wait has already passed starts its fade then; neither jumps ahead.
- **A skeleton once seen stays readable.** A skeleton is in view once it can
  be read: 25ms into its fade, whose start is nearly invisible, or on the
  frame that draws it in full. Content that would replace it within 245ms of
  that waits unseen until then: the skeleton goes back where it stood, and
  the content is laid out (and can take focus) out of flow beside it, then
  shows in place with no fade. Content that lands while the skeleton is
  still too faint to read shows at once. A skeleton inside content that
  waits comes into view only as that content shows. A skeleton that takes
  the place of one already in view counts from when that one came into view,
  so a hand-off never adds a wait. A skeleton swapped for another skeleton
  never waits, and a navigation shows the waiting content at once
  (`skeleton-floor.ts`).
- **Skeletons take the shape of what replaces them.** Settings remembers how
  many rows each list had, and a review how many decisions, files and
  summary lines it had (the latest review's stand in for one not opened here
  yet). The queue remembers how many rows (eight at most) and note lines it
  had, and, at the window width it measured them, how many lines its
  headline took and how tall its notes stood; the height is kept only while
  the notes are as many (`recoder.app.queue-shape.v1`). Each copies its
  counts onto `<html>` as CSS variables with an inline script before the
  first paint, so the server's frame has them too; the queue's measured
  parts apply only at the width they were taken at.
- **With nothing stored**, the queue's frame draws five rows, one note line
  and a one-line headline (two lines below 451px). Settings draws a set
  length for each list (two providers, two repositories, no CLI commands),
  so every group shows its title, and a list that turns out longer or
  shorter changes height once, at the swap. The queue's load and the setup
  check also keep the number of tracked repositories, so a first visit to
  Settings draws that many.
- **Changing pages** keeps the page on screen until the next one can paint
  whole; there are no route loading files. A review waits up to about 180ms
  for its review and diff to be read, and the clicked queue row shows as
  selected meanwhile; a clicked tab takes the pill at once. A page not shown
  about 180ms after its navigation began gets its skeleton, drawn by the
  shell in the canvas at full opacity at once, while the page it leaves
  stays mounted but hidden, keeping its state; the page's own skeleton then
  takes over on the same clock. Every way to change pages counts the same:
  queue rows, the top-bar tabs, the palette, the settings gear, `mod+,`,
  links the router follows by itself, and Back and Forward. A switch between
  two review tabs swaps the page in place, with no trip to the server for
  the page. Going back to the page on screen (its tab, or a link to it)
  while the new one is on its way drops that navigation, and the page stays.
  A review kept in memory, the sample and the review on screen open at once.
- **Reading ahead.** A pointer or the selection resting on a queue row for
  120ms prefetches its page and, for a finished review, reads the review
  ahead. Once a review page settles, up to three other open tabs are read
  ahead, one at a time. Once any page settles, the top bar's pages are
  prefetched, the sample review's page standing in when no review tab is
  open. No link prefetches on its own (tabs, the settings gear, queue rows,
  notice links); the shell decides. The router skips prefetches in dev,
  where each page compiles on its first visit.
- **Back or Forward to a review at an item** (`?item=`) that the tab kept a
  copy of waits up to 150ms for that item's code to be colorable before the
  page shows, as a first visit does under its skeleton, so its code never
  paints plain, then colored. The overview shows no code, so it never waits.
- **A review's brief is parsed while the page is idle**, from the moment the
  review is in, so a review opened after its row's read-ahead renders its
  summary from that work. The parser loads on demand (`prepare-brief.ts`),
  so the queue never ships it up front. On a cold direct link the brief
  still parses in the first render, since the review is the last answer to
  land.
- **Late parts hold their place.** The boot bar keeps room for the Queue
  count the last visit showed, and its search starts at the size the bar
  settled on last time for this window width and these tabs, so neither
  moves when the app takes over. The queue's rows and the rail's files below
  the first screen draw after the first paint, in space held for them. The
  header's author and branch sit last, so their arrival moves nothing.
  Checked for you holds its place while the checks are unknown, or failed
  before the pull request answered: a 104px title bar in the title's 18.75px
  row, plus the pills. A "New commits" notice known when the overview first
  draws (a kept copy, or a queue row's pull request) sits on top; one that
  arrives later goes last, so its arrival moves nothing. The failed and
  cancelled notices always sit on top.
- **An empty diff says so.** A passed review whose diff came back empty
  shows one plain line, "No changed files to show.", in place of the change
  bar and under the rail's Files heading. A stopped review, or one still at
  work, shows nothing there. A diff that failed to load shows its Try again
  line in the rail only.
- **Failure copy is plain.** Known failures get the app's own sentence (a
  missing or rejected forge token, a diff over the forge's limit, a server
  that can't be reached or is too slow, an answer that can't be read).
  Stream tags, status codes, links in parentheses and sign-in commands are
  cut from any other server message. A tool's raw output is never the
  message; a failed review folds it under Details. A token problem or a diff
  over the forge's limit would stop the review again, so it offers
  Connections or the pull request on its forge instead of Continue.
- **A part of a review that didn't load** (the diff, the checks, the pull
  request) shows one quiet line in its place with Try again, which reads
  that part alone again. A rejected token offers Connections instead, and
  when it kept out both the pull request and its checks, one line names
  both.
- **A script that fails to load** shows "Part of Recoder didn’t load." Once
  the app has mounted, a render that needs the lost script, or a route still
  on its skeleton 1.5s after one, reloads the page once by itself while the
  notice shows. A second loss within 30s offers Reload instead. Before the
  app mounts, the notice offers Reload. When the app has not mounted after
  8s, "Recoder didn’t finish loading." offers Reload, and goes away if the
  app mounts after all.
- **Toasts load early.** The toast library loads once the page is idle, so
  a toast that says part of Recoder didn’t load can still show after the
  server that sends the app’s code has gone.
- A page that breaks while rendering says so and offers Reload and the way
  back to the queue; only the queue offers Try again, since its list is
  loaded fresh. On a review, a panel that breaks (the rail, the reading
  pane, ask) keeps the error to itself: "The rail hit an error. If it keeps
  happening, reload the page." with Try again, while the rest of the page
  keeps working.

## Interaction rules

- **Keyboard first.** On the queue j/k move, Enter opens and r starts a
  review. On a review j/k and arrows move, Enter starts with the riskiest,
  a/s/x decide, u undoes, h hands off, f opens the file, o or Esc returns to
  the overview, q opens or closes ask, and Space, Shift+Space, Page Up/Down,
  Home and End scroll the reading pane. In the ask field, Escape closes ask
  when the field is empty. Everywhere ? lists shortcuts, ⌘K searches and ⌘,
  opens settings. Held keys never repeat a decision.
- **One Tab stop per queue row.** A reviewed row's Open button does what its
  title does, so Tab skips it; a Start button is a stop of its own. In the
  rail only the selected row is a Tab stop.
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
