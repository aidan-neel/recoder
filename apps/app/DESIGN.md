# Recoder app (apps/app)

The Recoder app: a Next.js 16 App Router app (React 19, Tailwind v4, zustand)
built on the shared React kit, `@recoder/ui` (`packages/ui`). It is a quiet
tool for one job: read an agent-written pull request, see what a review found,
and merge it or send the fix back. The layout is the one people know from
pull request tools: a sidebar, a list of pull requests, and a pull request
page with tabs.

It departs from the root `DESIGN.md` (apps/web) in six places:

- **An inset sidebar shell**, not a top bar with session tabs. The sidebar
  has no surface of its own and sits on the window's tint (`--bg-chrome`);
  from 1024px the page is a panel 8px in from the window's edges, with 12px
  corners and a `--line-subtle` hairline, and scrolls inside itself. The rule
  "do not reintroduce the left sidebar" is for apps/web only.
- **One sans face.** The UI face is Inter (`--font-ui`), and the AI voice
  uses it too (`--font-ai`). There is no serif and no Cal Sans. Code, paths,
  hashes and aligned numbers are Geist Mono.
- **Near-neutral surfaces.** Near-black panels with white hairlines in dark,
  white and light grey in light, all with a faint cool tint. The sidebar sits
  a step darker than the page and menus a step lighter. One light-blue primary
  button (`#93c5fd` with navy ink in dark, `#2259dc` with white ink in light;
  the palettes in Settings → Appearance bring their own) and one indigo-blue (`#3777ec`) accent (links, the selected line,
  hunk headers).
- **Phosphor icons in their bold weight**, set once by the kit's `IconRoot`,
  not Lucide. Import the `*Icon` names (`MagnifyingGlassIcon`).
- **Capy's edges and lift**, not flat rings. Controls, fields, cards and
  overlays draw a hairline inside their edge and, in dark, a subtle dark
  outline outside it; what should feel pressable adds a soft contact shadow
  (see Surfaces).
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
  review, `/pulls/[repoId]/[number]` a pull request, `/repos` the tracked
  repositories, `/repos/[repoId]` a repository, `/automations`, `/guidelines`. Settings has no route: it is a
  dialog over the page (see Settings dialog). `/sample`
  mirrors the list, the new review page, the pull request page, the
  Repositories page and the repository page on an in-memory client, with no server.
- **Logic** lives in `src/lib/<feature>/` as view-model hooks and stores. A
  component calls a hook, gets a plain view object (state and actions) and
  renders it. Components hold no fetches, timers or derived data.
- **One client contract.** `lib/api/client.tsx` defines `ApiClient`; the live
  client calls the server and the sample client (`lib/sample/`) answers from
  memory with the same behaviour. A page under `/sample` and its live twin
  render the same components.
- **Components** are grouped by feature in `src/components/`: `shell`,
  `pulls`, `pull`, `repo`, `changes`, `summary`, `bugs`, `commits`, `ask`, `compose`,
  `automations`, `guidelines`, `settings`, `connections`, `setup`, `common`.

## Layout

- **Sidebar** (248px, `--sidebar-width`): the account menu; New review, Pull
  requests (with the open count), Repositories, Automations and Guidelines; Repositories,
  one row a tracked repository on the places' lanes and row height: its
  forge's mark (14px, centred in the 16px icon lane), the name ending in an
  ellipsis, and, while one of its open pull requests has an open high bug, a
  6px dot in `--sev-high` where Pull requests holds its count (a screen reader
  hears "Has high-severity bugs"); the open one filled in place, folding like
  the lists under it; the recent chats and reviews; Settled; and at the foot
  the model reviews run with, the shortcuts and the theme switch. `[` shows or
  hides it. Settings open from the account menu and with ⌘,. A review a
  person cancelled wears a quiet slashed circle, never the failure triangle.
  The sample has no Automations, Guidelines or Settings, so its sidebar,
  account menu, palette and ⌘, leave them out instead of leading to the live
  app's sign-in. The first Tab stop on every page is "Skip to content", which
  moves focus past the sidebar's rows to the page.
- **Narrow windows**: under 1024px the sidebar is a drawer over the page,
  opened by the bar's button or `[` and shut by its scrim, Escape or going to
  another page; it always starts shut. The tab row keeps its tabs and
  buttons and the review's facts drop to a line under it. Under 760px the
  file tree steps out of Changes.
  Under 640px a list row stacks its title (which wraps), its meta line, then
  its fact and size; the pull request's title wraps over its buttons, with
  the merge button filling their line; the bar keeps the last two crumbs and
  icon actions. Nothing is cut off.
- **Sidebar body**: everything between the head and the foot scrolls as one
  region, so the head and foot never move and no list is squeezed shut; with
  room to spare, Settled sits at the bottom. A right click anywhere on it, or
  the context-menu key, opens a menu of three checks: Repositories, Chats and
  Reviews. A row with its own menu (a chat, a review, a settled row) keeps
  its menu. Unchecked, a list is left out whole, title and all, in this
  browser; hiding is apart from folding. Hiding Chats or Reviews takes its
  rows out of Settled too, and Settled goes when nothing is left in it.
- **Settings dialog**: Settings opens over whatever page is open, from the
  account menu, the palette, the model chip, a link that names a section, or
  ⌘, (which also closes it). It fills the window but for a 24px margin, up to
  1280 by 960px (the kit's `screen` modal). On the left, a 220px nav on the
  sidebar's surface, lanes and rows, under a search field that keeps the
  sections whose name or keywords (their groups and rows) hold every word
  typed; Enter opens the first, and with none left it says so. The rows:
  Models, Providers, Connections and
  Appearance, each with its icon, and the admin's own under an Admin label:
  Recoder (the running server, its updates, the branch a git checkout runs and
  a switch to another, the global review guidelines and its people), Limits,
  Telemetry and Usage. The open section sits on a still fill. On the right, a
  44px bar holds the crumbs (Settings › the section), the section's own
  control (the range on Usage and Telemetry) and the close button; under it
  the section scrolls in the settings column. Opening puts focus on the
  dialog, not a row; Esc closes the top layer first, so a menu inside closes
  before Settings does. A member asked for an admin section gets Models.
  Nothing about Settings lives in the address, so a reload closes it.
- **Page bar** (44px, `--bar-height`): breadcrumbs on the left, the page's own
  actions on the right. Every page's content starts under it, so borders line
  up across pages.
- **Pull request list**: one row a pull request. A row shows the title, the
  branch, the author, the size of the change and one fact: what the newest
  review found, that a review is running, or that there is none (with
  "Cancelled 4 hours ago" before the Review button when a person stopped the
  last one). The size, the row's menu and the fact each keep a lane of their
  own, in that order, so hovering a row never hides its size and the fact, or
  the Review button in its place, ends the row on the right. The lanes are the
  list's own columns, so they line up however wide one row's fact is. The row
  under the pointer and
  the row `j` and `k` are on wear the same fill; the keyboard's adds a short
  bar on its leading edge, which is its focus mark. Open findings are worded
  one way wherever they are counted: "2 bugs, 1 suggestion". Filters:
  all, needs review, has bugs, ready, and one repository when more than one
  is tracked. A repository that failed to load says so in a strip above the
  rows. A fact about the review (reviewing, its bugs, or that it failed) is a
  link: the pill deepens on hover and opens the pull request on its Review
  tab. It sits beside the row's own link, never inside it, so the row stays
  one link and the pill another. Each repository loads one page of 30 first; the next pages load as the
  end of the list nears, with skeleton rows at the end while they do and
  one plain line with Retry when a page fails. Rows append in place, below the
  ones shown, with no entrance.
- **Repositories page**: a full-width page, not the settings column. The bar
  names it and holds a filter field (`/` focuses it; it narrows by owner and
  name) and Add repository (primary), which opens the repository dialog: the
  repositories the signed-in forges can see, searchable, and Add by URL.
  Under the bar, the scopes as page tabs with a count each (All, Needs you
  with its count in the high-severity colour, Quiet, Auto review off; the
  address names the scope as `?scope=`) and, at the right, the days the tiles
  cover. Then a grid of tiles with 16px between, a tracked repository each,
  those with something to do first, then by name. The window's width sets
  how many tiles a row holds (2 from 640px, 3 from 1280px, 4 from 1600px,
  5 from 1920px, 6 from 2240px: the widths where a tile is 300px beside the
  default sidebar), so hiding the sidebar widens the tiles and never moves
  one to another row.
  A tile is a card, 224px tall: the forge's mark and `owner / name` (the
  owner faint and cut first), which is the link to the repository page and
  covers the tile, with a 6px dot at the end that is green when auto review
  watches the repository and grey when it does not (a tip says which); the
  open pull requests as a 28px figure beside what waits for a review and the
  open bugs (high ones in the high-severity colour, "No bugs" in the success
  tone once a review came back clean); the repository page's chart, a bar a
  day, 28px tall with no axis and no tips; and under a hairline the pull
  request to open next with its status, which is its own link. With nothing
  to do, that last line says auto review is off (with a link to Automations
  on the real app) or "All caught up" and when the last review was. A More
  button, shown while the tile is pointed at or focused, holds Stop tracking:
  the tile fades, the grid closes the gap, and the repository leaves the
  sidebar at once; the server forgets it when the toast's Undo is gone. The
  last tile, an outline with no fill, opens the same dialog as Add
  repository, and stands alone when nothing is tracked. Pointing at a tile's
  link deepens its ring to `--line-strong`, its fill to `--bg-raised-2` and
  its bars to `--text-faint`, over `--dur-swap`. A scope or filter
  text with no repository under it says so in one line. The page loads
  behind three skeleton tiles; a tile whose month did not load says so with
  Try again. Under 640px the tiles stack, Add repository keeps its icon and
  the days go.
- **Repository page**: the bar holds the crumbs (Repositories, linking to the
  Repositories page, then the
  name) and, on the right, the forge link as an icon button, Ask (outline),
  which opens New in Chat on this repository, and New review, the one primary,
  which opens New in Review on it. Under the bar, the forge's mark and
  `owner / name` (20px, the owner faint) over its facts as badges: the default
  branch, since when it is tracked, and whether auto review watches it
  ("Auto review on" in the success tone, "Auto review off" neutral, each led
  by a dot). Then five figures on one line split by
  hairlines, no cards: open pull requests (and how many are not reviewed), open
  bugs (the high ones in the high-severity colour), merged in the window (of
  how many reviewed), findings accepted (of raised) and the typical review time
  ("6m 40s"). Then two columns. The wide one: Needs you, the list's own rows
  for the open pull requests most urgent first (high bugs, other bugs, no
  review, conflicts or failing checks, a running review, ready), at most five,
  with a link to the list set to this repository; then Recently merged, up to
  three rows with what their reviews fixed ("3 fixed" or "Clean") and when.
  The narrow one: Reviews over the window as one bar a day, grey for reviews
  and the high-severity colour for the part that found a bug, a tip naming the
  day; Where bugs land, the five directories holding the most bugs, each with
  a share line and a count, paths in the code face; and Set up here, rows to
  Guidelines and Automations. The page loads behind a skeleton of the same
  shape and paints once, whole. A part with nothing in it says so in one quiet
  line; a repository that is not tracked or did not load says so in a banner.
- **New**: the choices fill the page and one large composer is docked at its
  foot, with no heading; the crumb names the screen (New review or New chat)
  and a Review | Chat switch sits at the end of the page's bar. The lists and
  the dock share one centred 760px column; the dock stays outside the
  scroller, so the composer never moves and its "/" menu opens over the
  lists. On top of the column sits a find field and, once two repositories
  are tracked, a quiet repository filter; both narrow the lists and neither
  moves the composer's repository. In Review the lists are the open pull
  requests in two groups, "Not reviewed yet" then "Reviewed", each with its
  count. A row is 48px: the pull mark, the title and number over the author,
  repository and age, then the row's one fact as a pill, its size, and a
  choice mark. A click chooses the row's pull request (its mark fills, the
  selection layer moves to it) and puts the caret in the composer rather than
  starting at once. A link or a `#214` pasted into the find field, or typed
  there and sent with Enter, is chosen the same way and the field empties.
  In Chat the list is "Recent chats"; a row opens its chat. In the composer's
  bar, after attach and "/", sits the repository, a quiet button with the
  forge's mark that opens a searchable command dialog of every tracked
  repository, the current one checked. In Review the pull request is a pick,
  not text: a second bar button beside the repository (it reads None until
  one is chosen) names the choice and opens a searchable dialog of the
  repository's open pull requests, and the field holds only the brief, what
  the review should look at (it may be empty). A pasted link or a typed
  `#214 ` moves into the pick and leaves the text. In Chat the field takes
  anything about the repository, and Enter opens the chat. The switch is
  explicit, not guessed from the text: "Is api #214 safe to merge?" names a
  pull request and is still a question. The note in the bar holds what stops
  Enter (the target's error, a review with no pull request chosen, a chat
  over the limit), what Enter will do first (connect an untracked
  repository), or a refusal; it is empty otherwise. The models sit in the
  bar. Under 640px a row drops its size and keeps its fact.
- **Pull request page**: the header (the title over a row of badges: state,
  author, base and head branch, change size, last activity), then four tabs.
  The header holds no review status: the Review tab says where the newest
  review stands after its name. While a review runs, a spinner and the time it
  has run (`5:01`, tabular figures, so the tab keeps its width); a queued,
  paused, failed or out-of-date review shows one glyph with its word as a
  tooltip (failed in the danger tone, out of date in medium); a done review
  shows its open bugs as the count. The tabs:
  - **Changes**: the file tree beside the diff. Bugs sit under the line they
    name. A file can be marked viewed. The guide gives the order to read the
    files in.
  - **Summary**: what the change does (clamped), the order to read the
    files in, the description (clamped), and the conversation with the
    reviewer. No boxes: labels, space and hairlines group it. It runs the
    page's full width on the header's gutters, with no chat beside it. The
    conversation ends in a one-line comment field (the composer's row
    layout). In its prose, inline code that names a file the pull request
    changes or one of its commits is a badge (`RefChip`, the look of a chat
    citation): the file's language mark and name with its lines, or a commit
    glyph and seven characters of the hash. A file badge opens the Changes tab
    at that file; a commit badge shows the commit's title on hover and opens
    the commit on its forge. A local repository's commit has no page, so its
    badge is a label that does not answer the pointer. Anything else stays
    code. Text that could gain a badge waits for what could give it one (the
    diff for inline code, the commits for a hash), so badges never swap in
    after the text. Fenced code in any
    Markdown drops the indentation its lines share, takes its language from
    its text when the fence names none, and draws a tab two columns wide. A
    badge or a code span never makes its line taller. In a bug's Ask, a reply's Thinking line starts folded (a click opens its steps). While it works, the
    newest thought sweeps on one line under it; when the answer begins, that
    line fades out where the answer's first line fades in, on the same
    baseline. The answer goes out a few words at a time at a pace that keeps
    up with the stream, each word fading in from a 2px blur, and a code span
    or link only once it is whole; there is no caret.
  - **Review**: one row a bug, the worst first, split by hairlines. Shut, a row
    is the title over its badges: severity (or Suggestion), category, evidence
    class, file and line, and whether an earlier review reported it. Open, it
    adds the explanation (clamped), the proof (a command and its output in a
    terminal box, a trace, or a rule quoted word for word with its source as
    badges), the suggested fix behind a disclosure line, and its actions:
    post it on the pull request, copy a fix prompt for the coding agent,
    accept it, or dismiss it with a reason; accepting and dismissing both
    answer with a toast that undoes them. The post button keeps one width for
    both its labels and the link to the posted comment comes after the last
    action, so no button moves when a bug is posted. The tab runs the page's
    full width on the header's gutters, so a bug's chevron, its evidence and
    its votes end on the header's edge. The tab row carries the
    review's own facts as badges (commit, when, model, duration), posting the
    review and Review again. While a review is queued, runs or is paused, there is
    no box: its four steps are rows in the bugs' row language (the same
    hairlines, title, badge row and chevron lane), with a 16px glyph lane
    before the name: a check once done, a spinner while it runs, a ring while
    it waits or is paused. A done step folds to its badges (claims,
    reviewers, the guidelines it read, how long its own tasks took) and opens
    to its lines when it has some (the plan's parts). The active step starts
    open: its count in the accent tint, verifiers at work, `N found so far`
    in the high tint, a meter (560px at most), what it does now (a verb and
    its subject as a code badge), and up to four claims, each with a
    glyph and a word on the right (Reproduced, Reproducing, Tracing,
    Cleared), then `N more cleared · N waiting`. A waiting step is its name
    in faint text, with no chevron. A queued review adds a `Waiting to
    start` row with the reason as a badge; a paused one puts `Paused` first
    on the step it holds. The tab row then holds the commit and model badges,
    Pause (ghost; Resume, primary, once paused) and Cancel (outline); the
    clock stays in the tab. Under the steps, the findings of the review
    before this one stay to read, named "Previous review" with its commit and
    time, stepped back and with nothing to act on, until the new review
    replaces them. A failed, out-of-date, cancelled or missing
    review gets a banner with its next step (Try again, Review). Old
    `?tab=bugs` links open this tab.
  - **Commits**.
    The merge strip under the title shows checks and mergeability and holds the
    merge button. It merges at the head commit the page shows, and never with
    admin rights. The button is the primary only when no finding is open and no
    review runs; otherwise it is an outline, so the page's one primary is the
    next step. Its checks open under it as a grid of rows (glyph and name;
    the forge link shows on hover) in a scroll area capped at about eight
    rows: failed first, then running, then passed, with skipped checks folded
    into one "N skipped" row.
- **Automations**, **Guidelines** and **Settings** are one 704px column of
  titled cards (`SettingsPage`, `SettingsGroup`), centred on the page (or the
  Settings dialog's pane), 32px under the bar.
  The width is the widest row on one line: a model with its effort, the
  ignored paths. No column has a title of its own: the bar names the page,
  and the dialog's crumbs name the section.
  Group titles, cards and notes share the column's edges; inside a card a
  row's text starts 12px in and its control ends 8px from the right, where
  the group's own action ends too, and so do a row's editor (the guidelines
  field and its bar). One setting a row (`SettingsRow`), 52px:
  the name on the left, with a detail line under it only when the line
  passes the subtext rule (see Copy), and the control on the right. A row
  saves on change and shows where the save stands beside the control.
  In Models, a provider's box shows or hides all its models (a dash when
  only some show, and a press then shows them all) and each model has a box
  of its own. In a provider's details, a model provider's usage windows sit
  side by side under its row, in the meta size, so they read as that
  provider's own.
- **Usage** (admin) is figures and charts, not settings, so like Telemetry it
  has no cards: a 920px column of titled blocks (`UsageBlock`)
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
- **Telemetry** (admin) shares Usage's 920px cardless `UsageBlock` layout,
  range picker and `?person=<accountId>` drill-down for pull request and
  finding activity: reviewed pull requests (with reviews and merges) beside
  the daily pull-requests-reviewed `LineChart`, Pull requests (PRs reviewed,
  PRs merged with merge rate, Reviews, Auto reviews with share, Avg tokens /
  review), Findings (Raised, Accepted with rate, Dismissed with rate,
  Blocking at or above `checkThreshold`, Fixed on re-review), Findings by
  severity (`StackedBar` in text-ramp greys) and Breakdown (Person,
  Repository or Day). Chart hues (`--chart-1` to `--chart-6`) mean people in
  everyone's view and repositories in one person's view.

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
`Composer`: New, a bug's Ask, the repository chat and the
comment field. There is no second implementation.

- **Shape.** One box at the card radius on `--bg-raised`, ringed with
  `--shadow-composer`; `--shadow-composer-focus` brightens its hairline while
  the field has focus, and the edge tints toward danger while the text is invalid. Roomy text on top
  (22px lines, 14px from the left, 16px at `lg`), a bar at the foot whose
  28px controls sit 6px in from the edges (8px at `lg`). A press on the box's
  empty parts puts the caret in the field.
- **Bar.** Quiet tools at the start (`ComposerTool`: ghost icon buttons
  named by tooltips), then the note, then the caller's controls (the models)
  and the action. The action is `ComposerSend`, the region's one primary
  button, which spins in place while sending; while a reply arrives it is
  `ComposerStop`. The note is right-aligned meta text, danger for what stops
  Enter, secondary for what Enter does first.
- **Sizes.** `lg` is a page's main field (New): 15px text, two rows, and it
  grows to eight before it scrolls. `md` is everything else, two rows. The `row` layout puts the field and the
  action on one line for the comment field; an empty note takes no room.
- **"/" menu.** A slash typed at the start of the field or after a space,
  or the "/" tool beside attach, opens one list over the composer, across its
  width at its radius: the commands under "Commands", a hairline, then the
  repository's skills under "Skills". A row is a glyph, the name at medium
  weight and what it does, muted, on one line. Arrows move, Enter or Tab
  picks, Escape shuts it until the text changes. A command puts its question
  in the field to send; a skill puts `/name`, which shows as an embed with
  the puzzle mark, and the message loads that skill. A chat offers only what
  it can do now: `/review` only when a new run can start. New has no
  commands, only skills, because the pull request has to lead its text.
- **"+".** In a bug's Ask, "+" opens a searchable dialog of
  the pull request's changed files and adds the chosen path to the text; the
  chat takes text only. Focus comes back to the field, caret at the end.
- **Models.** A quiet trigger in the bar shows the mark of the agent that
  serves the Reviewer model and names the model; it opens a menu: the
  Reviewer and Subagent models (each opens the Settings model dialog) and the
  Reviewer effort. On New in Review mode the menu also holds the review's
  speed, Standard or Spark, and Spark's bolt follows the name on the trigger.
  No route takes a model per message, so a pick saves to Settings at once;
  the menu only adds a line when the admin sets the member's models. The
  comment field has no models; the sample shows only the speed.
- **Keys.** Enter sends, Shift+Enter starts a line. Text over the server's
  limit says by how much and cannot send; a refused send says why and keeps
  the text.

## Motion

Motion explains a change and never makes the person wait.

- Things that move: the sidebar slides, the highlight under the pointer in a
  menu or list follows it, collapsibles and the provider dialog change height.
  Menus, selects, the palette, dialogs, tooltips and the link card fade in
  from a 0.97 scale, with no blur: menus in 180ms and out in 150ms, dialogs in
  180ms and out in 130ms. Entrances and exits share one strong ease-out
  (`cubic-bezier(0.23, 1, 0.32, 1)`), so a closing menu clears in its first
  frames instead of lingering. A link that becomes an embed settles in place: its
  tint fades in over `--dur-swap`, with no change of size. Settings enters
  and leaves as every dialog does; changing its section swaps the pane at
  once, scrolled to the top.
- Things that do not move: the open tab, the chosen segment and the active
  nav row are filled in place, never slid there. Keyboard moves (j/k, tabs 1
  to 4) swap content at once. A pressed button shades and never shrinks.
  A page paints once, fully formed: no half renders and no content that
  jumps after the first paint.
- Loading is Skullet's (`Skeleton`, `SkeletonBox`, `SkeletonRows` and
  `SkeletonText` in the kit). A screen wraps its content in `Skeleton` and,
  while it loads, renders the same components from stand-in data
  (`lib/<feature>/loading-*.ts`); Skullet lays that out unseen and draws a
  bar over every line and control, so the skeleton has the content's own
  geometry. With an `id` it remembers the shape the content had, and the
  next load draws that. Content then takes the skeleton's place whole, in
  one 170ms crossfade. Where the content cannot be laid out (a settings
  group, a chart, one value), `SkeletonRows`, `SkeletonText` and
  `SkeletonBox` stand at its exact size. Never draw a bar by hand.
- Pages are static. A page change shows the new page in the same frame:
  no fade, rise, slide or stagger on the page or its lists. The only motion
  between pages is the skeleton standing in while data loads and its
  crossfade to the content.
- A click changes the page in the same frame. The app renders in the browser
  only, so `Link` and `navigate` (`components/common/link.tsx`,
  `lib/shell/navigation.ts`) change the address with the History API and the
  screen for it renders at once from `components/shell/screens.tsx`; nothing
  waits on the server that serves the app. Never import `next/link` or
  `next/navigation`. A screen that has no data yet shows its skeleton; it
  never holds the old page.
- Durations and easings come from the kit tokens (`--dur-*`, `--motion-*`,
  `--ease-menu`) and the kit's motion presets (`DURATION`). Hover takes 80ms
  and the menu highlight 90ms. Nothing on a keyboard path runs longer than
  about 130ms.
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
- **One primary button per region**, in light blue. Ghost, quiet and icon
  buttons are quiet at rest: no background until hover. Secondary and outline
  buttons carry their edge at rest (see Surfaces).

## Buttons

A button is compact: a 13px label in the regular weight (the primary alone
is medium), its edge and lift from the surface recipes (see Surfaces). The
side an icon sits on gets 2px less padding than a side with text.

| Size           | Height      | Padding (text / icon side) | Radius | Use                                                                                                              |
| -------------- | ----------- | -------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------- |
| `md` (default) | 28px        | 9 / 7px                    | 5px    | Everywhere, including the 44px page bar and list rows. Omit `size`.                                              |
| `sm`           | 24px        | 7 / 5px, 12.5px label      | 4px    | Inside a line of text or a dense group: a retry in a sentence, suggestion chips, actions on collapsed bug lines. |
| `lg`           | 32px        | 11 / 9px, 13.5px label     | 5px    | Not used in the app today.                                                                                       |
| `icon`         | 28px square | none                       | 5px    | Every icon-only action.                                                                                          |

| Variant       | At rest                          | Use                                                                                                 |
| ------------- | -------------------------------- | --------------------------------------------------------------------------------------------------- |
| `primary`     | Light blue, raised               | The one next step of a region: Post to pull request, Merge, Save. Never repeated down a list.       |
| `secondary`   | A raised plate                   | A standalone action with no primary beside it: Try again in an error notice, Back to pull requests. |
| `outline`     | An edge with no fill             | The action beside a primary, and the action a list row offers (Review, Track, Connect).             |
| `ghost`       | Muted text, nothing else         | Tertiary actions and row controls: Accept, Dismiss, Disconnect, Cancel, icon buttons.               |
| `quiet`       | Full-strength text, nothing else | Triggers that name their value: the filter, the model picker.                                       |
| `destructive` | Red text on a red tint           | A step that deletes, inside its confirmation.                                                       |

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

Corners are soft, a step rounder than Capy Desktop's (6px buttons, 8px cards,
12px panels), and come from five kit tokens. A surface's radius is its inset
plus the radius of the rows in it, so a 6px row in a menu with a 4px inset
sits in a 10px panel, and a 6px segment in a track with a 2px inset in an 8px
track. Use the tokens, never a raw radius.

| Token               | Radius | On                                                                      |
| ------------------- | ------ | ----------------------------------------------------------------------- |
| `--radius-chip`     | 6px    | Badges, keycaps, checkboxes, menu rows, `sm` buttons, segments          |
| `--radius-control`  | 7px    | Buttons, fields, select triggers, tabs, tooltips                        |
| `--radius-row`      | 8px    | List rows and their highlight, segmented tracks, textareas, code blocks |
| `--radius-card`     | 10px   | Cards, menus, popovers, toasts, the palette                             |
| `--radius-composer` | 16px   | The composer; the controls in its bar take its radius less the inset    |

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
- **Fields** are 28px tall with 9px side padding, like a `md` button. They
  are wells, not plates: the field recipe, whose hairline brightens on hover
  and again on focus, with no halo.
- **Switches** are 28×16 with a 12px thumb; **checkboxes** are 14px.
- **Disclosure lines**: a `ChevronRight` that leads a `CollapsibleTrigger`
  hangs its ink on the trigger's edge, shut and open, so it lines up with the
  text under it. The kit pulls it left by a third of its size and turns it
  about (13.5, 13.5) on its 24-unit grid. A chevron that is not 14px sets
  `--disclosure-chevron-size`.
- **Shadows**: see Surfaces. Panels, rows and the page stay flat.

## Surfaces

aidan's word (AID-8): the app takes Capy Desktop's surface treatment. Every
bordered thing gets a hairline inside its edge and, in dark, a subtle dark
outline outside it, so it stays crisp on any surface; the things that should
feel pressable add a soft lift. The recipes live once, as tokens, in
`packages/ui/src/styles/tokens.css`, built from a few parts (`--edge`,
`--edge-strong`, `--edge-focus`, `--edge-outline`, `--edge-highlight`, the
`--lift-*` shadows and the `--fill-*` fills) that each theme sets. Light needs
no outline: its hairline is already dark. Components and app styles use a
recipe and never write a ring or a shadow of their own.

| Recipe | Parts | On |
| ------ | ----- | -- |
| `--shadow-primary` + `--fill-primary` | A soft vertical gradient of `--primary`, a top sheen, a ring and a short drop shadow | The primary button |
| `--shadow-raised` + `--fill-raised` | A soft fill, hairline, top highlight, dark outline and a 1px contact shadow | Secondary buttons, select triggers, the chosen segment |
| `--shadow-edge` | Hairline and dark outline | Outline buttons, chips, an empty tile |
| `--shadow-field` | Hairline and dark outline; `-hover` and `-focus` brighten the hairline | Inputs, textareas, the command bar field, the guidelines stream |
| `--shadow-card` | Hairline, top highlight and dark outline; no drop | Cards, settings groups, repository tiles, notices on a raised fill |
| `--shadow-well` + `--fill-well` | A sunken fill and a faint hairline | The segmented control's track |
| `--shadow-menu` | The edge plus a short layered float | Menus, selects, popovers, tooltips, toasts, the palette |
| `--shadow-modal` | The edge plus a deeper sheet shadow | Dialogs |
| `--shadow-composer` | The edge plus a soft lift; `-focus` brightens the hairline | The composer |

The values are Capy's own, toned down a step: the reference recipes' gradient
and contact shadow are kept, at lower contrast. Hover moves the hairline to
`--edge-strong` and the fill a step lighter; a press flattens the fill and
never changes size.

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
