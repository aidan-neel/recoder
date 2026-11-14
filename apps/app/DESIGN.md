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
- No scrollbar shows anywhere: the kit's `base.css` hides them on every
  element, and its scroll area draws none. Don't style one back in.

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
- **Settings sidebar**: on `/settings/<section>` the account row becomes
  Back to app (to the pull request list), and the places and recent reviews become the sections: Models,
  Providers, Connections, Review limits, Usage and Admin (the admin's
  only: updates, people and their models), Appearance, each with its icon, on the same
  lanes and fill as the app's places. One group, so no label. The search,
  the hide button and the foot stay. The page bar says Settings. Opening
  Settings lands on Models, never on a bare `/settings`, so a section row is
  always open. Keyboard focus in the part that swaps moves with it: to Back
  to app or the open section, and back to the account row.
- **Page bar** (44px, `--bar-height`): breadcrumbs on the left, the page's own
  actions on the right. Every page's content starts under it, so borders line
  up across pages.
- **Pull request list**: one row a pull request. A row shows the title, the
  branch, the author, the size of the change and one fact: what the newest
  review found, that a review is running, or that there is none. Filters:
  all, needs review, has bugs, ready, and one repository when more than one
  is tracked. A repository that failed to load says so in a strip above the
  rows. Each repository loads one page of 30 first; the next pages load as the
  end of the list nears, with skeleton rows at the end while they do and
  one plain line with Retry when a page fails. Rows append in place, below the
  ones shown, with no entrance.
- **New**: one large composer, its centre near 42% of the page, with no
  heading; the crumb names the screen (New review or New chat). Over its
  left edge sits the repository, a quiet button with the forge's mark that
  opens a searchable command dialog of every tracked repository, the current
  one checked. Over its right edge sits a Review | Chat switch. In Review the
  pull request is a pick, not text: a second bar button beside the repository
  opens a searchable dialog of its open pull requests, and the field holds only
  the brief, what the review should look at (it may be empty). A pasted link or
  a typed `#214 ` moves into the pick and leaves the text; a row under "Not
  reviewed yet" picks its pull request and puts the caret in the field rather
  than starting at once. In Chat it takes anything about the
  repository, and Enter opens the chat. The switch is explicit, not guessed
  from the text: "Is api #214 safe to merge?" names a pull request and is
  still a question. The note in the bar holds what stops Enter (the target's
  error, a review with no pull request chosen, a chat over the limit), what
  Enter will do first (connect an untracked repository), or a refusal; it is
  empty otherwise. The models sit in the bar. The open pull requests with no
  review yet sit below, one click each, and never move the field.
- **Pull request page**: the header (the title over a row of badges: state,
  author, base and head branch, change size, last activity), a banner for the
  newest review (running, failed, stopped, or done) with the one next step,
  then four tabs:
  - **Changes**: the file tree beside the diff. Bugs sit under the line they
    name. A file can be marked viewed. The guide gives the order to read the
    files in.
  - **Summary**: what the change does (clamped), the order to read the
    files in, the description (clamped), and the conversation with the
    reviewer. No boxes: labels, space and hairlines group it. The
    conversation ends in a one-line comment field (the composer's row
    layout). The Ask pane beside the tab is the chat with Recoder: its thread
    scrolls above the composer docked at the pane's foot, and a sent message
    and its reply stay in view until the reader scrolls up. A reply's
    Thinking line starts folded (a click opens its steps), and while the
    answer streams its last few words shimmer; there is no caret.
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
    The merge strip under the title shows checks and mergeability and holds the
    merge button. It merges at the head commit the page shows, and never with
    admin rights. Its checks open under it as a grid of rows (glyph and name;
    the forge link shows on hover) in a scroll area capped at about eight
    rows: failed first, then running, then passed, with skipped checks folded
    into one "N skipped" row.
- **Automations**, **Guidelines** and **Settings** are one 704px column of
  titled cards (`SettingsPage`, `SettingsGroup`), centred on the page, 32px
  under the bar.
  The width is the widest row on one line: a model with its effort, the
  ignored paths. A Settings section's name tops its column at the page
  title's size; Automations and Guidelines have none, as the bar names them.
  Group titles, cards and notes share the column's edges; inside a card a
  row's text starts 12px in and its control ends 8px from the right, where
  the group's own action ends too, and so do a row's editor (the guidelines
  field and its bar). One setting a row (`SettingsRow`), 52px:
  the name on the left, with a detail line under it only when the line
  passes the subtext rule (see Copy), and the control on the right. A row
  saves on change and shows where the save stands beside the control.
- **Usage** (admin) is figures and charts, not settings, so it is the one
  section with no cards: a 920px column of titled blocks (`UsageBlock`)
  grouped by space and hairlines, 48px apart. The range is a select in the
  page bar. The overview puts the window's total (40px) with its sessions
  and cost over one row per person (their line's dot, avatar, name and
  tokens over share, sessions and cost) beside the daily chart, one smooth
  line per person (`LineChart`). Then Totals (five figures), Tokens by type
  (`StackedBar`, in greys), Model calls (calls, failed calls with the failure
  rate, and the typical call time as "4.2s" or "1m 12s"; the failed figure takes
  `--sev-medium` once any call failed), By kind (Reviews, Chats and Other as
  the Breakdown's rows with a Calls column; everyone's view only) and Breakdown (Model, Day or Person): a table
  split by hairlines whose names sit over a 2px share line, split in the
  chart's colors (a model or a day by person), the first ten rows with Show
  all for the rest. A person's view (`?person=<accountId>`, a history step)
  is the same page over their part: the way back and who they are on top,
  their models beside the chart and as its lines. Color always means the
  chart's lines: people in everyone's view, models in one person's, so a hue
  never names two things on one screen. `--chart-1` to `--chart-6` go in
  rank order; past six, the first five keep theirs and the rest fold into
  one grey line and row ("4 others"). Costs that leave out a model with no
  price end in a quiet + and the Breakdown's note names the model.
  - **Hover links the parts.** A row beside the chart brings its line
    forward and the others step back; the line under the pointer in the
    chart (within 18px) lights its row the same way. The chart's tip follows
    the pointer from day to day: the date and total, then each line's tokens
    and share of the day, biggest first, the hovered line at full strength.
    A Breakdown row's tip (over its right end) splits it by the chart's lines,
    then lists its calls, failed calls and typical time (left out when it has
    none) and its tokens by kind of token. Focused, the chart moves between days with Left,
    Right, Home and End, and between lines with Up and Down.

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
  `Pill`: 20px tall, 11.5px medium, 4px radius, wrapping in rows with a 6px
  gap. Paths, branches, commits and commands use `face="code"`. A pill whose
  text may not fit ends in an ellipsis and shows the whole on hover.
- **Colour only for meaning.** Severity (high, medium, low, with a dot), pass
  or fail, and a reproduced bug are tinted. Category, traced, rule, file and
  time stay neutral; an icon tells them apart.
- **Not every word is a badge.** Titles, the model's prose and the person's
  comments stay text; only a link in a person's words shows as an embed.
- **Long prose is clamped.** Model-written text (what changed, the
  description, a bug's explanation) shows its first lines through the kit's
  `ClampedText`; the last line fades and Show more opens the rest over
  `--dur-disclose`. Text one line past the cut shows whole. The words are
  never rewritten or cut for good. A suggested fix sits shut behind a
  disclosure line that names its file and how many checks it passed.
- **One box level.** A box holds only code or terminal output. Everything
  else groups by space, a section label and hairlines.

## Link embeds

The app's text boxes for a person's words (New review, the Composer, the
guidelines draft request) are the kit's `LinkField`, a swap for `Textarea`
with the same props and the same plain-string value, URLs in full. Each
`http:` or `https:` link in it shows as an embed: the forge's mark and a short
label (`api #214`, `proj !12` for a GitLab merge request, `api #9`,
`api@0123456`, `retry.ts:40`, `acme/api`), or a link glyph with the host and
a short path for any other site.

- **Technique.** A `contenteditable="plaintext-only"` element whose content
  is a model (the text and which ranges are embeds); the DOM is only its view.
  Every `beforeinput` is cancelled and applied to the model, so typing,
  deleting, pasting, cutting, dropping, undo and redo all run through one
  path. An IME composition is the one edit the browser makes, and the field
  reads it back when it ends. A textarea under a painted overlay was ruled
  out: the caret, selection and line breaks would sit in one layer and the
  embeds in another, so an embed could never be one unit or narrower than its
  URL.
- **When a link becomes an embed**: on paste, on a value from outside, and
  when the link being typed ends (a space, Enter, or the caret leaving its
  word). Never while it is typed, never during a composition. Trailing
  punctuation stays text; balanced parentheses stay in. A Markdown link's URL
  becomes an embed and its brackets stay text.
- **One unit.** The caret never goes inside an embed. Arrows step over it,
  Shift+arrows and the mouse select it whole, Backspace and Delete remove it
  whole. The first Backspace straight after a typed link became an embed turns
  it back into text, so a link that was not meant as one costs one key.
  Copy and cut give the full URL.
- **Facts.** A host passes `linkFacts`: only what the app already holds (an
  open pull request's title and state, that a repository is not connected,
  why a target cannot be reviewed). The embed shows the fact as a dot; the
  card shows it in words. The field never fetches anything for a link.
- **The card.** Resting the pointer on an embed, or the caret beside one,
  opens a card with the title, the state, the full URL, Open and Copy. It
  never takes focus. A link opens only from Open, Alt+Enter beside it, or
  Ctrl/Cmd+click, in a new tab with `noopener noreferrer`.
- **Layout.** An embed is inline, 18px tall on the 20px line, so a line with
  one is as tall as a line without. Its label ends in an ellipsis at 260px.
- **Sent words.** A person's sent message shows its links the same way,
  read-only (`LinkText`). Model-written Markdown keeps its own links.
- Fields for tokens, URLs, numbers and names stay plain `Input`s, and the
  guidelines editor stays a `Textarea`: its text is Markdown.

## Composer

Every place a person writes to Recoder or to the forge uses the kit's
`Composer`: New, the Ask pane, a bug's Ask, the repository chat and the
comment field. There is no second implementation.

- **Shape.** One box at the card radius on `--bg-raised`, ringed with
  `--shadow-composer`; the ring turns `--line-focus` while the field has
  focus and tints toward danger while the text is invalid. Roomy text on top
  (22px lines, 14px from the left, 16px at `lg`), a bar at the foot whose
  28px controls sit 6px in from the edges (8px at `lg`). A press on the box's
  empty parts puts the caret in the field.
- **Bar.** Quiet tools at the start (`ComposerTool`: ghost icon buttons
  named by tooltips), then the note, then the caller's controls (the models)
  and the action. The action is `ComposerSend`, the region's one primary
  button, which spins in place while sending; while a reply arrives it is
  `ComposerStop`. The note is right-aligned meta text, danger for what stops
  Enter, secondary for what Enter does first.
- **Sizes.** `lg` is a page's main field (New): 15px text, three rows.
  `md` is everything else, two rows. The `row` layout puts the field and the
  action on one line for the comment field; an empty note takes no room.
- **"/" commands.** A slash at the start of the field, or the "/" tool,
  opens a list of commands over the composer (under it when it sits high),
  from its left edge and at most 440px wide. Arrows move, Enter or Tab picks,
  Escape shuts it until the text changes; a pick puts the command's question
  in the field to send. A chat offers only what it can do now: `/review`
  only when a new run can start. New has none, because the pull request has
  to lead its text.
- **"+".** In the Ask pane and a bug's Ask, "+" opens a searchable dialog of
  the pull request's changed files and adds the chosen path to the text; the
  chat takes text only. Focus comes back to the field, caret at the end.
- **Models.** A quiet trigger in the bar names the Review model and opens a
  menu: the Review and Subagent models (each opens the Settings model
  dialog) and the Review effort. No route takes a model per message, so a
  pick saves to Settings at once; the menu only adds a line when the admin
  sets the member's models. The comment field and the sample have no models.
- **Keys.** Enter sends, Shift+Enter starts a line. Text over the server's
  limit says by how much and cannot send; a refused send says why and keeps
  the text.

## Motion

Motion explains a change and never makes the person wait.

- Things that move: the sidebar slides, the highlight under the pointer in a
  menu or list follows it, collapsibles and the provider dialog change height.
  Menus, selects, the palette, dialogs, tooltips and the link card fade in
  from a 0.97 scale, with no blur: menus in 120ms and out in 80ms, dialogs in
  150ms and out in 100ms. A link that becomes an embed settles in place: its
  tint fades in over `--dur-swap`, with no change of size. Entering or
  leaving Settings, the parts of the sidebar that change fade through on
  `--dur-swap`: the old ones out in 50ms, then the new ones in over 90ms,
  never both at once, and nothing slides. Opened or reloaded on Settings,
  it paints at once.
- Things that do not move: the open tab, the chosen segment and the active
  nav row are filled in place, never slid there. Keyboard moves (j/k, tabs 1
  to 4) swap content at once. A pressed button shades and never shrinks.
  Lists load with skeletons shaped like the content and swap in place with no
  entrance animation. A page paints once, fully formed: no half renders and
  no content that jumps after the first paint.
- Durations and easings come from the kit tokens (`--dur-*`, `--motion-*`,
  `--ease-menu`) and the kit's motion presets (`DURATION`). Hover and the
  menu highlight take 50ms. Nothing on a keyboard path runs longer than about
  100ms.
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

A button is compact and flat: a 13px label in the regular weight (the
primary alone is medium), and, where it has an edge, a hairline drawn inside
the box so it lines up with fields. No sheen, bevel, lift or shadow. The side
an icon sits on gets 2px less padding than a side with text.

| Size | Height | Padding (text / icon side) | Radius | Use |
| --- | --- | --- | --- | --- |
| `md` (default) | 28px | 9 / 7px | 5px | Everywhere, including the 44px page bar and list rows. Omit `size`. |
| `sm` | 24px | 7 / 5px, 12.5px label | 4px | Inside a line of text or a dense group: a retry in a sentence, suggestion chips, actions on collapsed bug lines. |
| `lg` | 32px | 11 / 9px, 13.5px label | 5px | Not used in the app today. |
| `icon` | 28px square | none | 5px | Every icon-only action. |

| Variant | At rest | Use |
| --- | --- | --- |
| `primary` | Flat cream (black in light) | The one next step of a region: Post to pull request, Merge, Save. Never repeated down a list. |
| `secondary` | A faint wash and a hairline | A standalone action with no primary beside it: Try again in an error notice, Back to pull requests. |
| `outline` | Hairline only | The action beside a primary, and the action a list row offers (Review, Track, Connect). |
| `ghost` | Muted text, nothing else | Tertiary actions and row controls: Accept, Dismiss, Disconnect, Cancel, icon buttons. |
| `quiet` | Full-strength text, nothing else | Triggers that name their value: the filter, the model picker. |
| `destructive` | Red text on a red tint | A step that deletes, inside its confirmation. |

- **Hover and press** lay a wash over whatever is behind a see-through
  button, so it still shows inside a hovered row. A press shades the button
  a step deeper within `--dur-hover`. It never changes size.
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

## Corners and controls

Corners are small and there are four of them, as kit tokens. A surface's
radius is its inset plus the radius of the rows in it, so a 4px row in a menu
with a 4px inset sits in an 8px panel. Use the tokens, never a raw radius.

| Token | Radius | On |
| --- | --- | --- |
| `--radius-chip` | 4px | Badges, keycaps, checkboxes, menu rows, `sm` buttons, segments |
| `--radius-control` | 5px | Buttons, fields, select triggers, tabs, tooltips |
| `--radius-row` | 6px | List rows and their highlight, segmented tracks, textareas, code blocks |
| `--radius-card` | 8px | Cards, menus, popovers, toasts, dialogs, the palette |

- **Tabs** are text, 26px tall. The open tab is brighter on a quiet fill
  (`--bg-hover`) drawn in place. Every tab has the same weight, so nothing
  shifts when the open tab changes. The segmented control works the same way:
  the chosen segment is filled where it is.
- **Menus and selects**: rows 26px tall with a 14px icon, on a 4px inset in
  a panel at least 160px wide, 4px from the trigger. The palette's rows are
  30px, with icons in a 16px lane so every label starts at the same x.
- **Dialogs**: 16px padding, the title 4px over its description, the close
  button 12px in from the corner, footer buttons 6px apart. Popovers have
  10px padding, 6px from their trigger.
- **Fields** are 28px tall with 9px side padding, like a `md` button. Focus
  is one inset line in `--line-focus`, with no halo.
- **Switches** are 28×16 with a 12px thumb; **checkboxes** are 14px.
- **Disclosure lines**: a `ChevronRight` that leads a `CollapsibleTrigger`
  hangs its ink on the trigger's edge, shut and open, so it lines up with the
  text under it. The kit pulls it left by a third of its size and turns it
  about (13.5, 13.5) on its 24-unit grid. A chevron that is not 14px sets
  `--disclosure-chevron-size`.
- **Shadows**: only what opens over the page floats (menus, popovers,
  tooltips, toasts and dialogs), on one short, tight shadow. Everything else
  is flat.

## Copy

Short and plain. A heading is a title with no subtitle. An error says what
failed and, when the server gave one, the reason. No taglines.

**Subtext.** A line under a label, field or control stays only when it
carries an error, a state, a limit or unit, a consequence (above all one that
deletes or writes to a forge), where a secret is kept, or a fact needed to
fill the field. A line that restates the label, the placeholder or the
control, explains an ordinary control, or describes the feature in general
goes. A needed fact moves to where it is used rather than being shortened. A
line that comes and goes keeps its space, so nothing jumps.

## Code

Code renders with the kit's `CodeLines`. The diff uses the server's hunks;
syntax colours are the `--syn-*` tokens.
