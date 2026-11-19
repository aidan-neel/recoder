# Recoder app (apps/app)

The Recoder app: a Next.js 16 App Router app (React 19, Tailwind v4, zustand)
built on the shared React kit, `@recoder/ui` (`packages/ui`). It is a quiet
tool for one job: read an agent-written pull request, see what a review found,
and merge it or send the fix back. The layout is the one people know from
pull request tools: a sidebar, a list of pull requests, and a pull request
page with tabs, under a topbar of window tabs taken from Capy's desktop app.

It departs from the root `DESIGN.md` (apps/web) in six places:

- **A topbar of window tabs over an inset sidebar shell**, as in Capy. The
  topbar and the sidebar have no surface of their own and sit on the window's
  tint (`--bg-chrome`); from 1024px the page is a panel under the topbar, 8px
  in from the window's other edges, with 12px corners and a `--line-subtle`
  hairline, and scrolls inside itself. The rule "do not reintroduce the left
  sidebar" is for apps/web only. Where this file and Capy disagree on how
  people move around the app, Capy wins and this file follows.
- **One sans face.** The UI face is Inter (`--font-ui`), and the AI voice
  uses it too (`--font-ai`). There is no serif and no Cal Sans. Code, paths,
  hashes and aligned numbers are Geist Mono.
- **Near-neutral surfaces.** Near-black panels with white hairlines in dark,
  white and light grey in light, all with a faint cool tint. The sidebar sits
  a step darker than the page and menus a step lighter. One blue primary
  button (`#2f6bf0` with white ink in both themes, its hover the same blue a
  step darker;
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
  repositories, `/repos/[repoId]` a repository, `/automations`, `/guidelines`, `/settings/[section]`
  a section of Settings (live only; `/settings` is Models). `/sample`
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

- **Topbar** (40px, `--topbar-height`) across the whole window, on the
  window's tint. Over the sidebar, in the sidebar's width: the account menu
  at the window's left edge, so the top-left is never empty, and at the
  sidebar's right edge a small Search button (Cmd/Ctrl+K, it opens the
  palette) left of the sidebar's toggle. There are no Back and Forward buttons: Cmd/Ctrl+[
  and Cmd/Ctrl+] and the browser's own walk the tab on screen. The first tab
  starts on the page panel's left edge. With the sidebar hidden the part over
  it keeps its width, as Capy's toggle stays put: the account, Search and the
  toggle never move when the sidebar opens or closes. After the
  last tab, a + (tooltip "New review", Alt+T) opens New review in a new tab;
  the sidebar's first row, New review, opens it in the tab on screen. The design is variant V1,
  "Window bar", of the Paper file
  https://app.paper.design/file/01M7S67WPYQ32KY5VF219H93M0.
- **Window tabs** are 200px by 28px with `--radius-row` corners and 2px
  between them, and read like the sidebar's rows: bare at rest, a light wash
  of `--bg-hover` when pointed at, and the tab on screen flat on
  `--bg-hover`, the sidebar's selected-row fill, with no shadow or lift and
  its X always shown. Only colours change between these states, never a
  weight, border or padding, so selecting a tab moves nothing. Each tab
  holds any page and its own Back and Forward history, and every tab, its history and the tab on screen are kept in this
  browser, so a reload comes back to them (the sample keeps its own). A tab
  shows its screen's icon, the page's own name (a pull request's or chat's
  title, a repository's name, a section of Settings) ending in an ellipsis,
  and at its end the state of a running review, a review with bugs, or one
  that failed; pointed at or focused, an X takes that place. Tabs narrow to
  112px and then scroll sideways, the one on screen kept in view. A drag
  reorders them; a middle click or the X closes one. A right click opens the
  tab's menu in three groups, text only with shortcuts at the right, as in a
  browser: New tab (Alt+T), Duplicate tab, Copy link; Close tab (Alt+W on the
  tab on screen), Close other tabs, Close tabs to the right; Reopen closed tab
  (Alt+Shift+T). A duplicate opens right after its tab with its history.
  Closing the last tab leaves one on the pull request list. While Alt (Option)
  is held the first nine tabs show the number that reaches them.
- **How a link opens**, as in Capy: a plain click opens the page in the tab
  on screen and adds it to that tab's history; a page another tab already
  shows brings that tab forward instead; Cmd or Ctrl with a click, or the
  middle button, opens it in a new tab at the end of the row, on screen. A
  tab of a page (a pull request's Changes or Review) swaps the address in
  place, so Back leaves the page. The browser's own Back and Forward walk the
  same history: every entry the app makes names its tab and step. An address
  opened from outside the app (a pasted link, a reload of a page no tab
  shows) opens in a new tab, never over one in use.
- **Shortcuts.** The browser keeps Cmd/Ctrl with T, W, Shift+T, 1–9 and Tab
  for its own tabs, so the window tabs answer to Alt (Option) instead: Alt+T
  a new tab (New review), Alt+W close, Alt+Shift+T reopen, Alt+1…8 that tab
  and Alt+9 the last, Alt+[ and Alt+] the previous and next tab. Back and
  Forward in a tab are Cmd/Ctrl+[ and Cmd/Ctrl+], the sidebar Cmd/Ctrl+B (or
  `[`), Settings Cmd/Ctrl+,. Alt with a letter or a digit works in a text
  field too; Alt with a bracket stays with the field, as on a Mac it types
  quotes.
- **Sidebar** (248px, `--sidebar-width`) starts under the topbar with no head
  of its own: New review (a + and its label, the first row), Pull requests
  (with the open count), Repositories, Automations
  and Guidelines, all rows of one kind; then Reviews,
  Chats and Repositories, each under a title drawn as Capy draws its groups
  (`SidebarSection`): the title size (14px) in regular weight and
  `--text-primary`, on the rows' text lane, with no chevron. At its right, at
  rest and without a fill, a quiet + that starts one (a new review, a new
  chat, Add repository) and a ⋯ that collapses or hides the group, in
  `--text-faint` until pointed at. A click on the title folds the group too.
  Settled uses the same title. Reviews, Chats and Settled draw every row
  with one component (`ThreadRow`, `styles/thread-row.css`), Paper variant
  V3 of AID-18, in two densities picked in Settings → Appearance → Sidebar
  rows (saved in this browser, set on `<html>` before first paint, applied
  at once). Detailed, the default, is two lines with no tile: the title in
  `--text-secondary` (full ink when pointed at, open or unread) and its age,
  then where it lives (a pull request mark and "api #214", or a chat mark and
  the repository) and the state as a kit `Pill` at the line's end: "2 bugs"
  high, "No bugs" ok, "Failed" danger, "Reviewing" neutral with the spinner,
  and "New reply" in the accent on a chat with news. Compact is one 30px
  line: the review's `StatusGlyph` (or a chat mark), the title, then the
  unread dot and the age. Settled is always compact, its glyph how the pull
  request ended, its title in `--text-muted`. A row that changed since this
  browser last had it open is unread (a running review never is): a 6px
  `--accent` dot, in the list's gutter when detailed and before the age
  when compact, and its title at weight 500. The open row is marked seen
  through every change it goes through. Both densities are always in the
  markup and the setting only decides what shows, and a row's two lines have
  fixed heights, so a change of setting or of state never moves a row.
  Pointed at or focused, the age gives way to a quiet Settle (✓) and ⋯;
  the open row sits on `--bg-hover`. A repository is one line on
  the places' lanes: the forge's mark, the name, and a `--sev-high` dot while
  it has an open high bug. Then Settled; and at the foot the model reviews run with,
  the shortcuts and the theme switch. A review a person cancelled wears a
  quiet slashed circle, never the failure triangle. The sample has no
  Automations, Guidelines or Settings, so its sidebar, account menu, palette,
  model chip and ⌘, leave them out instead of leading to the live app's
  sign-in. The first Tab stop on every page is "Skip to content", which moves
  focus past the topbar and the sidebar to the page.
- **Narrow windows**: under 1024px the sidebar is a drawer over the page,
  under the topbar, opened by the topbar's toggle, Cmd/Ctrl+B or `[` and shut
  by the toggle, its scrim, Escape or going to another page; it always starts
  shut. The tab row keeps its tabs and
  buttons and the review's facts drop to a line under it. Under 860px of
  page the file sidebar steps out of Changes.
  Under 640px a list row stacks its title (which wraps), its meta line, then
  its fact and size; the pull request's title wraps over its buttons, with
  the merge button filling their line; the bar keeps the last two crumbs and
  icon actions. Nothing is cut off.
- **Sidebar body**: everything above the foot scrolls as one
  region, so the foot never moves and no list is squeezed shut; with
  room to spare, Settled sits at the bottom. A right click anywhere on it, or
  the context-menu key, opens a menu of three checks: Reviews, Chats and
  Repositories. A row with its own menu (a chat, a review, a settled row) keeps
  its menu. Unchecked, a list is left out whole, title and all, in this
  browser; hiding is apart from folding. Hiding Chats or Reviews takes its
  rows out of Settled too, and Settled goes when nothing is left in it.
- **Settings** is a page in the tab on screen, opened from the account menu,
  the palette, the model chip, a link that names a section, or ⌘, (which
  goes back to the page Settings opened over). The tab is named for the
  section. Settings' sections take over the sidebar: a way back ("← Settings",
  to the page before Settings in this tab, or the pull request list), a search
  field that keeps the sections whose name or
  keywords (their groups and rows) hold every word typed (Enter opens the
  first, and with none left it says so), then Models, Providers, Connections
  and Appearance, each with its icon, and the admin's own under an Admin
  label: Recoder (the running server, its updates, the branch a git checkout
  runs and a switch to another, the global review guidelines and its people),
  Limits, Telemetry and Usage. The open section sits on a still fill. The
  topbar stays as it is. The page's bar holds the crumbs (Settings › the
  section) and the section's own control (the range on Usage and Telemetry);
  under it the section scrolls in the settings column. A member sent to an
  admin section gets Models.
- **Page bar** (44px, `--bar-height`): breadcrumbs on the left, the page's own
  actions on the right. Every page's content starts under it, so borders line
  up across pages.
- **One content column a page** (`.page-column`, base.css). Each page's body,
  and a pull request's header and tab row, sit in one: its edges are the bar's
  20px gutter (`--page-gutter`, 16px on a phone), or with `--page-measure`
  set a centred column (Chat 720px, Settings 704px, New 760px) that never
  comes closer to the panel than the gutter. The outermost ink at rest lands on
  those edges, nothing passes them: a card's or field's box, a list's marks and
  last facts, a quiet button's text or icon. Quiet controls and row fills reach
  past by their own padding, so their hover fill shows outside the edge, never
  their ink. The gutter is 20px, not the sidebar's 16, because a row fill
  reaching 12px past it then sits 8px from the panel's side, as the sidebar's
  highlight sits 8px from the window's. A part that spans the panel (the tab
  row's rule) is the column itself, its line edge to edge. Changes is a
  workbench: its file sidebar is full height against the panel's side and
  keeps the gutter on both sides of its rule (the filter's box, a top row's
  chevron and a row's last letter; the rows' fill 8px past them), its filter's
  top on the first file card's, and the diff column starts a gutter past the
  sidebar's rule.
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
  which opens New in Chat on this repository, and a + (tooltip "New review"),
  the one primary, which opens New in Review on it. Under the bar, the forge's mark and
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
  the dock share one centred 760px page column, edge to edge with the find
  field and the composer, a row's mark and choice mark on its edges; the dock stays outside the
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
  shows its open bugs as the count. The page has one control that starts a
  review: the Review split button at the end of the title's row, before the
  menu and the merge button, on every tab. It reads Review until a review has
  run and Review again after; `r` presses it, its menu offers Spark, and on a
  failed review at the same head it continues from where the review stopped.
  It is the region's primary, with its `r` keycap, while a review is the next
  step (none yet, cancelled, failed, out of date) and an outline otherwise.
  While a review is queued, runs or is paused it is gone, and the Review tab's
  row holds Pause and Cancel. Nothing else on the page starts a review. The tabs:
  - **Changes**: one reading column of diffs, as Capy Desktop shows a pull
    request; nothing sits beside it. See Changes below.
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
    review's own facts as badges (commit, when, model, duration) and posting the
    review. While a review is queued, runs or is paused, there is
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
    review gets a banner that says where it stands (a failure adds why, the
    steps it kept and Open settings when the server offers it); the header's
    Review button is its next step. Old
    `?tab=bugs` links open this tab.
  - **Commits**.
    The merge strip under the title shows checks and mergeability and holds the
    merge button. It merges at the head commit the page shows, and never with
    admin rights. The button is the primary only when no review is due, no finding
    is open and no review runs; otherwise it is an outline, so the page's one primary is the
    next step. Its checks open under it as a grid of rows (glyph and name;
    the forge link shows on hover) in a scroll area capped at about eight
    rows: failed first, then running, then passed, with skipped checks folded
    into one "N skipped" row.
- **Automations**, **Guidelines** and **Settings** are one 704px column of
  titled cards (`SettingsPage`, `SettingsGroup`), centred on the page, 32px
  under the bar.
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
  `ComposerStop`, a square in the same primary fill, as in Capy. The note is right-aligned meta text, danger for what stops
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

## Thread

A repository chat reads like a Capy thread (Paper variant D, "Line", in the
AID-8 file).

- **Column.** The thread and the composer share one 864px column
  (`--page-measure`), with 24px between turns.
- **Turns.** The person's question sits on `--bg-bubble` at the right,
  7px by 12px inside, at most 77% of the column. The hour shows centred over
  a question that opens a conversation or follows a rest of more than five
  minutes. Recoder's reply is prose on the page in the primary ink on 20px
  lines; links take the accent, inline code a chip, list markers the
  reply's own ink. A fenced block is a code block titled with its language,
  and a table is one rounded box with hairlines between rows.
- **What it did.** Under the question, one centred line in the meta size and
  `--text-dim`: `Working for 8s`, which sweeps from send to done and
  whose seconds roll like Capy's counters (`AnimatedNumber`), then crossfades
  to `Worked for 13s`, counted to the moment the reply ended
  (`endedAt`). The line is the same one line from send to done and its
  height never changes. The steps start folded, while the reply works too;
  pressing the line opens them, a hairline runs out to the column's edges on
  either side of it while they are open, and the thread keeps the person's
  choice. Each step is one 32px line in the muted ink ending in how long it
  took; its chevron shows only under the pointer or once it is open. A step
  with more to show (the files a search or a read found, a command and its
  output, a thought's text) opens under its own line on request, and only a
  failed command starts open. A live trail opened at the end stays in view
  as it grows.
- **Composer.** `--radius-card` on the composer's ground, one row tall at
  rest, the placeholder in `--text-ghost`.
- **Streaming.** The reply's text goes out a few words at a time, and each
  stretch that arrives fades from transparent to its colour over 160ms on a
  strong ease-out, drawn with CSS custom highlights so nothing moves or
  blurs (`useStreamFade`). Code stands at once.
- **Scroll.** The thread follows a reply while the person reads the end.
  Scrolling up stops the following and shows a Scroll to end button centred
  over the composer, on the page's ground so the text under it stays out of
  sight, which brings the end back and follows again.

## Motion

Motion explains a change and never makes the person wait.

- The sidebar slides on `--dur-toggle` with the strong ease-out. The page's
  left edge rides the sidebar's and the page takes its true width in every
  frame, as a Mac app's content does beside its sidebar: what sits on the
  gutter moves with the edge, a centred column (Settings, Chat, New) glides at
  half the pace, what sits at the right holds still, and nothing snaps when the
  slide ends. A column centres on 100% of the page, not 100cqw, which
  resolves in style rather than layout. A page
  that changes layout at a width keys it to `--page-rest`, the width the page
  settles at, which the frame sets the moment the sidebar toggles: the pull
  request header splits its badges onto their own line from it, so they move
  with the click, never mid-slide. A reload never slides, and under reduced
  motion it snaps.
- A window tab that closes gets out of the way: its name fades in 120ms while
  it narrows to nothing in 150ms, gap and all, so the tabs after it and the +
  close up behind it; the page it leaves for shows at once. The fill of the tab
  on screen moves to the next tab in one frame, never crossing two fills.
  Closing the last tab puts the new one in its place at once, and under
  reduced motion a tab goes at once.
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
  `--ease-menu`, `--ease-hover`) and the kit's motion presets (`DURATION`).
  Hover eases in and out over `--dur-hover` (120ms on `--ease-hover`) on
  buttons, rows, menu items, the segmented control, fields and the composer
  edge, so a pointer crossing a list leaves a soft wake rather than a
  flicker. A press shades in faster, over `--dur-tap` (60ms), and eases back
  on release. The menu highlight still travels between items in 90ms
  (`--motion-hover`) and lands on the item before its fade ends. Nothing on
  a keyboard path runs longer than about 130ms.
- `prefers-reduced-motion` turns movement into plain swaps. A transition a
  component declares lands on its end value in the frame it starts and still
  sends `transitionend` when its time is up; nothing else gets a transition,
  so a style change paints in its own frame. Hover's colour fades stay, since
  they move nothing, and a menu highlight fades in on its item without
  travelling there.

## Interaction rules

- **Keyboard first.** ⌘K searches, `c` starts a new review, `[` toggles the
  sidebar, ⌘, opens settings and `?` lists every shortcut. On the list, j/k
  move, Enter opens, `r` reviews and `/` opens a pull request by link. On a
  pull request, 1 to 4 pick a tab, j/k move between files or bugs, `v` marks
  a file viewed, `o` opens or shuts it, `n` and `p` step through the findings
  in the diff, `r` reviews (or reviews again) and `t` goes to a file. On a
  bug, Enter opens or closes it, `p` posts it, `y` copies its fix prompt and
  `x` dismisses it.
- **Enter and Space on a focused control belong to that control.** Page keys
  stand down while typing or while a dialog or menu is open.
- **Every async action shows its state**: idle, pending (same width), then
  success or failure with the server's reason. A change shows at once and
  goes back when the save fails.
- **One primary button per region**, in blue. Ghost, quiet and icon
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
  a step deeper within `--dur-tap`. It never changes size. The primary and
  secondary keep their gradient through hover and press: only its two stops
  darken (`--fill-primary-*-top` and `-bottom`, `--fill-raised-*`), blended
  as registered colours, so the fill never swaps and never flashes.
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
12px panels), and come from six kit tokens. A surface's radius is its inset
plus the radius of the rows in it, so a 6px row in a menu with a 4px inset
sits in a 10px panel, and a 6px segment in a track with a 2px inset in an 8px
track. Use the tokens, never a raw radius.

| Token               | Radius | On                                                                      |
| ------------------- | ------ | ----------------------------------------------------------------------- |
| `--radius-chip`     | 6px    | Badges, keycaps, checkboxes, menu rows, `sm` buttons, segments          |
| `--radius-control`  | 7px    | Buttons, fields, select triggers, tabs, tooltips                        |
| `--radius-row`      | 8px    | List rows and their highlight, segmented tracks, textareas, code blocks |
| `--radius-card`     | 10px   | Cards, menus, popovers, toasts, the palette                             |
| `--radius-modal`    | 14px   | Dialogs, a sheet over the page that is rounder than the cards in it     |
| `--radius-composer` | 16px   | The composer; the controls in its bar take its radius less the inset    |

- **Tabs** are text, 26px tall. The open tab is brighter on a quiet fill
  (`--bg-hover`) drawn in place. Every tab has the same weight, so nothing
  shifts when the open tab changes. The segmented control works the same way:
  the chosen segment is filled where it is.
- **Menus and selects**: rows 26px tall with a 14px icon, on a 4px inset in
  a panel at least 160px wide, 4px from the trigger. The palette's rows are
  30px, with icons in a 16px lane so every label starts at the same x.
- **Dialogs** follow Capy's: 20px padding, the title 4px over its
  description, the close button 12px in from the corner. A dialog that
  belongs to a section names it first, as a breadcrumb in quieter ink
  (`ModalTitle`'s `context`: Providers › Add provider). The footer is the
  panel's last row, full width under a hairline, with Back or Check again at
  the left (`start`) and the actions at the right, 6px apart. Popovers have
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
| `--shadow-primary` + `--fill-primary-*` | A soft vertical gradient of `--primary`, a top sheen, a ring and a short drop shadow | The primary button |
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

## Changes

The diff reads as one column, capped at 1080px and centred, so the code gets
the width and the eye keeps one lane. The changed files stand beside it as a
tree.

- **The file sidebar** is flat, at the sidebar's level: no fill, a hairline
  on its right, the kit's `Tree` with each file's finding dot and size at
  its end, or a check once viewed (a viewed file's name goes faint). Lone
  folder chains read as one row (`apps/server/src`). The file in view is
  marked as the diff scrolls; pressing a file brings it to the top. Its
  width drags (200 to 480px, kept per browser), and the tree button in the
  tab row hides or shows it, kept per browser. Under 860px of page the
  sidebar steps out and the Files button stands in for it. Bars stand in
  while the diff loads; a diff with no files has no sidebar.
- **Tab row tools**, left to right: the sidebar button; Files (`t`, shown
  while the sidebar is not) opens a search dialog of every file by folder
  (or by the guide's parts in guide order), each with its finding dot and
  its size, or a check once viewed, and `t` opens it either way; Findings with a
  severity glyph, its place (`2/3`) and previous and next (`p`, `n`),
  stepping through the open findings in reading order and wrapping; how
  many files are viewed, with a meter; Files or Guide; collapse or expand
  every file.
- **A file** is a card with the kit's card edge, drawn over its content so
  the coloured lines and the sticky header never cover it. Its 40px header
  stays in view while its diff scrolls: caret, the language's mark, the
  name in ink and its folder quiet (the folder gives way first), then its
  findings pill, the size and Viewed. Marking it viewed shuts it; a diff
  over 800 lines starts shut behind Show it; a renamed or binary file says
  it has no lines. Off screen it skips layout and paint, and its diff
  mounts only as it nears the view.
- **Hunks** are numbered on both sides, a new file on its own side only.
  Where the diff skips lines, a quiet row says how many are unchanged.
- **A finding** sits under the line it ends on as one raised line: severity
  glyph, title, evidence and a caret, so the code around it stays
  readable. Pressed, it opens in place to its explanation, with Open in
  Review. Its lines wear the bug's red wash and bar. The same card is the
  Review tab's: its header line keeps its place open or shut, so the caret
  and title never move, and the whole line washes on hover and shuts it
  again, as do Enter and Space on it and Escape anywhere in the card. On
  the Review tab an open card's header stays at the top while its body
  scrolls under it, and shutting from there keeps the header where it is.
- **Jumps** (the file menu, the stepper, `j` and `k`, a file badge in the
  Summary) bring the file to the top and a line or finding to the middle,
  open the file and the finding, focus the finding and write the place to
  the address: `#file=<path>`, `#file=<path>&line=<n>` (that line wears
  the accent's wash and bar) or `#finding=<id>`. Opening such an address
  goes there.

## Code

Code renders with the kit's `CodeLines`. The diff uses the server's hunks;
syntax colours are the `--syn-*` tokens.
