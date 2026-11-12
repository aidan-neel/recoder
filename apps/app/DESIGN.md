# Recoder app (apps/app)

The Recoder app: a Next.js 16 App Router app (React 19, Tailwind v4, zustand)
built on the shared React kit, `@recoder/ui` (`packages/ui`). It is a quiet
tool for one job: read an agent-written pull request, see what a review found,
and merge it or send the fix back. The layout is the one people know from
pull request tools: a sidebar, a list of pull requests, and a pull request
page with tabs.

It departs from the root `DESIGN.md` (apps/web) in four places:

- **A sidebar shell**, not a top bar with session tabs. The rule "do not
  reintroduce the left sidebar" is for apps/web only.
- **One sans face.** The UI face is Inter (`--font-ui`), and the AI voice
  uses it too (`--font-ai`). There is no serif and no Cal Sans. Code, paths,
  hashes and aligned numbers are Geist Mono.
- **Neutral surfaces.** Near-black panels with white hairlines in dark,
  white and light grey in light. One cream primary button and one azure
  accent (links, the selected line, hunk headers).
- **A pull request is the unit**, not a review session. A review belongs to a
  pull request and shows inside its page.

## The kit

- Every control and surface comes from `@recoder/ui`: Radix primitives styled
  with the Recoder tokens, plus `motion` for movement. The app never
  hand-rolls a button, menu, dialog, popover, tooltip, select, input, switch,
  tab strip, card or scroll area. When the kit lacks a piece that two places
  need, add it to `packages/ui`, not to the app.
- The kit's tokens keep their names. `src/styles/tokens.css` gives them the
  app's values under `.app-skin` (on `<html>` here and in
  apps/site), in dark and in light. Components use tokens, never raw hex or
  raw durations.
- The kit's control CSS sits in `@layer components`, so a `className` utility
  wins over it. Restyle through `data-ui`, `data-variant` and `data-state`.
- App styles are one file per feature in `src/styles/`, imported by
  `src/styles/app.css`.

## Structure

- **Routes** (`src/app/(live)`): `/` the pull request list, `/new` a new
  review, `/pulls/[repoId]/[number]` a pull request, `/automations`,
  `/guidelines`, `/settings/[section]`. `/sample` mirrors the list, the new
  review page and the pull request page on an in-memory client, with no
  server.
- **Logic** lives in `src/lib/<feature>/` as view-model hooks and stores. A
  component calls a hook, gets a plain view object (state and actions) and
  renders it. Components hold no fetches, timers or derived data.
- **One client contract.** `lib/api/client.tsx` defines `ApiClient`; the live
  client calls the server and the sample client (`lib/sample/`) answers from
  memory with the same behaviour. A page under `/sample` and its live twin
  render the same components.
- **Components** are grouped by feature in `src/components/`: `shell`,
  `pulls`, `pull`, `changes`, `summary`, `bugs`, `commits`, `ask`, `compose`,
  `automations`, `guidelines`, `settings`, `connections`, `setup`, `common`.

## Layout

- **Sidebar** (248px, `--sidebar-width`): the account menu; New review, Pull
  requests (with the open count), Automations and Guidelines; the recent
  reviews; and at the foot the model reviews run with, the shortcuts and the
  theme switch. `[` shows or hides it. Settings open from the account menu
  and with ⌘,.
- **Page bar** (44px, `--bar-height`): breadcrumbs on the left, the page's own
  actions on the right. Every page's content starts under it, so borders line
  up across pages.
- **Pull request list**: one row a pull request. A row shows the title, the
  branch, the author, the size of the change and one fact: what the newest
  review found, that a review is running, or that there is none. Filters:
  all, needs review, has bugs, ready, and one repository when more than one
  is tracked. A repository that failed to load, or whose list was cut, says
  so in a strip above the rows.
- **New review**: one field that takes a pull request link or a search, and a
  few open pull requests to pick from.
- **Pull request page**: the header (the title over a row of badges: state,
  author, base and head branch, change size, last activity), a banner for the
  newest review (running, failed, stopped, or done) with the one next step,
  then four tabs:
  - **Changes**: the file tree beside the diff. Bugs sit under the line they
    name. A file can be marked viewed. The guide gives the order to read the
    files in.
  - **Summary**: what the change does (clamped), the order to read the
    files in, the description (clamped), and the conversation with the
    reviewer. No boxes: labels, space and hairlines group it.
  - **Bugs**: one row a bug, the worst first, split by hairlines. Shut, a row
    is the title over its badges: severity (or Suggestion), category, evidence
    class, file and line, and whether an earlier review reported it. Open, it
    adds the explanation (clamped), the proof (a command and its output in a
    terminal box, a trace, or a rule quoted word for word with its source as
    badges), the suggested fix behind a disclosure line, and its actions:
    post it on the pull request, copy a fix prompt for the coding agent,
    accept it, or dismiss it with a reason. The tab row carries the review's
    own facts as badges (commit, when, model, duration). While a review runs,
    a run card shows its steps.
  - **Commits**.
    The merge bar at the bottom shows checks and mergeability and holds the
    merge button. It merges at the head commit the page shows, and never with
    admin rights.
- **Automations**, **Guidelines** and **Settings** are single columns of
  titled cards (`SettingsGroup`), one setting a row (`SettingsRow`): the name
  and one line about it on the left, the control on the right. A row saves on
  change and shows where the save stands beside the control.

## Type

- **Inter** at 400 and 500 carries the interface. 600 is for page titles,
  markdown headings and key numbers only.
- **Sizes**: body 13.5px on a 20px line, labels and buttons 13px, meta 12px,
  badges 11.5px medium, the page title 20px.
- **Tracking**: 0 at 16px and below, -1% from 18 to 24px, -3% near 36px.
- **Numbers** that line up use tabular figures (`.tabular`). The shipped
  Inter files carry `tnum` and `calt` and no character variants, so no
  `cv`/`ss` features are set.

## Facts and long text

The pull request screens show facts, not sentences about facts.

- **Badges for facts.** A fact a reader scans for (state, author, branch,
  size, severity, category, evidence, file, rule, review time) is a kit
  `Pill`: 20px tall, 11.5px medium, 6px radius, wrapping in rows with a 6px
  gap. Paths, branches, commits and commands use `face="code"`. A pill whose
  text may not fit ends in an ellipsis and shows the whole on hover.
- **Colour only for meaning.** Severity (high, medium, low, with a dot), pass
  or fail, and a reproduced bug are tinted. Category, traced, rule, file and
  time stay neutral; an icon tells them apart.
- **Not every word is a badge.** Titles, the model's prose and the person's
  comments stay text.
- **Long prose is clamped.** Model-written text (what changed, the
  description, a bug's explanation) shows its first lines through the kit's
  `ClampedText`; the last line fades and Show more opens the rest over
  `--dur-disclose`. Text one line past the cut shows whole. The words are
  never rewritten or cut for good. A suggested fix sits shut behind a
  disclosure line that names its file and how many checks it passed.
- **One box level.** A box holds only code or terminal output. Everything
  else groups by space, a section label and hairlines.

## Motion

Motion explains a change and never makes the person wait.

- Things that move: the sidebar slides, the active tab's pill and the nav
  highlight travel, collapsibles and the provider dialog change height, menus
  and dialogs enter with a short fade, a 0.95 scale and a 2px blur.
- Things that do not move: keyboard moves (j/k, tabs 1 to 4) swap content at
  once. Lists load with skeletons shaped like the content and swap in place
  with no entrance animation. A page paints once, fully formed: no half
  renders and no content that jumps after the first paint.
- Durations and easings come from the kit tokens (`--dur-*`, `--ease-menu`)
  and the kit's motion presets. Nothing on a keyboard path runs longer than
  about 150ms.
- `prefers-reduced-motion` turns movement into plain swaps.

## Interaction rules

- **Keyboard first.** ⌘K searches, `c` starts a new review, `[` toggles the
  sidebar, ⌘, opens settings and `?` lists every shortcut. On the list, j/k
  move, Enter opens, `r` reviews and `/` opens a pull request by link. On a
  pull request, 1 to 4 pick a tab, j/k move between files or bugs, `v` marks
  a file viewed, `r` reviews (or reviews again) and `t` finds a file. On a
  bug, Enter opens or closes it, `p` posts it, `y` copies its fix prompt and
  `x` dismisses it.
- **Enter and Space on a focused control belong to that control.** Page keys
  stand down while typing or while a dialog or menu is open.
- **Every async action shows its state**: idle, pending (same width), then
  success or failure with the server's reason. A change shows at once and
  goes back when the save fails.
- **One primary button per region**, in cream. Everything else is quiet at
  rest: no background until hover.

## Buttons

A button is compact and calm: a 13px label in the regular weight (the
primary alone is medium), a hairline edge drawn inside the box so it lines
up with fields, and a soft lift instead of a border. The side an icon sits
on gets 2px less padding than a side with text.

| Size | Height | Padding (text / icon side) | Radius | Use |
| --- | --- | --- | --- | --- |
| `md` (default) | 28px | 10 / 8px | 8px | Everywhere, including the 44px page bar and list rows. Omit `size`. |
| `sm` | 24px | 8 / 6px, 12.5px label | 6px | Inside a line of text or a dense group: a retry in a sentence, suggestion chips, actions on collapsed bug lines. |
| `lg` | 32px | 12 / 10px, 13.5px label | 9px | Not used in the app today. |
| `icon` | 28px square | none | 8px | Every icon-only action. |

| Variant | At rest | Use |
| --- | --- | --- |
| `primary` | Cream (black in light), a sheen and a bevel | The one next step of a region: Post to pull request, Merge, Save. Never repeated down a list. |
| `secondary` | Raised fill, hairline, lift | A standalone action with no primary beside it: Try again in an error notice, Back to pull requests. |
| `outline` | Hairline only | The action beside a primary, and the action a list row offers (Review, Track, Connect). |
| `ghost` | Muted text, nothing else | Tertiary actions and row controls: Accept, Dismiss, Disconnect, Cancel, icon buttons. |
| `quiet` | Full-strength text, nothing else | Triggers that name their value: the filter, the model picker. |
| `destructive` | Red text on a red tint | A step that deletes, inside its confirmation. |

- **Hover and press** lay a wash over whatever is behind a see-through
  button, so it still shows inside a hovered row. A press shrinks the button
  to 0.97 and shades it within `--dur-hover`; reduced motion keeps the shade
  and drops the shrink.
- **Status** keeps the idle width. Pending shows a spinner, success a green
  check and error a red cross on a red-tinted button, each in the label's
  place. Pass `successLabel` or `errorLabel` only when the word adds
  something (Connected, Checked), and accept that the button is as wide as
  that face.
- **No forced widths.** A button is as wide as its label. Set a width only
  where two labels swap in one place and the row must not move.
- **Nothing is posted or merged without a click.** Posting findings, a
  comment or a merge is one explicit action, and a second click posts nothing
  twice.

## Copy

Short and plain. A heading is a title with no subtitle. A row's detail line
says what the setting does at its current value. An error says what failed
and, when the server gave one, the reason. No taglines.

## Code

Code renders with the kit's `CodeLines`. The diff uses the server's hunks;
syntax colours are the `--syn-*` tokens.
