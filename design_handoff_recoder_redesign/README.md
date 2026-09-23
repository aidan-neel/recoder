# Handoff: Recoder dark redesign

## Overview
A dark-mode redesign of the Recoder web app (`apps/web`, SvelteKit) in the style of a modern AI coding tool. It covers the app shell (top bar with session tabs), Home, the live review, the diff + findings workspace, the finding thread, Ask reviewer, Settings, first run, the ⌘K palette, the composer's model menu, and the interaction layer (hover, press, loading, streaming, async buttons, toasts).

Companion files in this folder:
- `DESIGN.md`: the design system (tokens, type, components, motion). Put it in the repo root.
- `AGENTS.md`: rules for coding agents working on the UI. Put it in the repo root.
- `PROMPT.md`: the prompt to paste into Claude Code.

## About the design files
The `.dc.html` files here are **design references built in HTML**. They are prototypes that show the intended look and behavior; they are not production code. Recreate them in the existing SvelteKit app, using its patterns and the Sivir component library (https://sivir.dev/llms.txt). Restyle Sivir components through tokens instead of forking them. Open the files in a browser to inspect them. `support.js` is only the runtime for the reference files.

## Fidelity
**High fidelity.** Colors, type, spacing, radii and motion are final. Match them exactly. The copy is realistic sample data.

## Screens to build
The ids refer to labelled artboards in `Recoder Redesign.dc.html`. Everything uses the **top bar shell**. 2f was drawn with the old sidebar; build it inside the top bar (3d shows exactly that).

| id | Screen |
|---|---|
| 3a | Home: AI brief + flat PR list |
| 3b | Live review, running |
| 3c | Diff workspace, **Inline** mode (findings inline in the diff) |
| 2f / 3d | Diff workspace, **Focus** mode (ranked findings list + focused diff + finding detail) |
| 4a | Finding discussion thread (right panel) |
| 4b | Ask reviewer with selected code (right panel) |
| 4c | Settings modal: Models |
| 4d | First run |
| 4e | ⌘K command palette |
| 5c | Composer model/effort menu (the only composer pattern; ignore 5a, 5b, 5d, 5e) |
| Interactions | `Recoder Interactions.dc.html`: working reference for every hover, press, loading and motion rule |

3c and 2f are two modes of the same workspace. Offer both behind a segmented control in the session header (`Conversation · Diff` for Inline, `Conversation · Findings · Files` for Focus). Inline is the default. Confirm this with the owner before shipping.

### Shell (all screens)
- Page background `#0d0c0b`. **Top bar**: 46px tall, padding `0 10px 0 14px`, gap 4px.
  - Left: the "Recoder" wordmark (14px/500). There is **no logo mark**.
  - Then the tabs: Home, a 1px × 16px divider `#262422`, one tab per open session, and a `+` button.
  - Right: search field (up to 260px wide, min 170px, 30px tall, radius 8, bg `#151413`, inset ring `#1f1e1c`, placeholder "Search or ask Recoder", ⌘K keycap), then the usage meter, settings, and a 26px avatar.
- **Tab**: 30px tall, padding `0 10px`, radius 8, 13px. Contents: status icon, repo name, `#PR` in mono 11.5 `#6f6a63`, and a badge (mono 10.5, radius 4, padding `0 5px`).
  - Running session: spinning loader `#e9c07a`, badge "4/6".
  - Passed: PR icon `#86c98c`, badge = finding count.
  - Failed: `#f08a7e` icon, badge "failed" on `rgba(240,138,126,.12)`.
  - Has a high finding: badge "1 high", `#f4a097` on `rgba(240,138,126,.13)`.
  - Inactive text `#a39e96`. Active text `#ede9e3` on a pill `#1c1b19` with inset 1px `#2a2826`.
- **Canvas card**: fills the rest of the page with 8px margin on the sides and bottom. Bg `#141312`, 1px border `#201f1d`, radius 14, overflow hidden. Focus mode uses a deeper canvas `#100f0e` with the header on `#141312`.

### 3a Home
- Centered column, max-width 920, padding `56px 40px 40px`.
- **Brief line**: 12.5px `#6f6a63` with "Brief" in `#a39e96`/500, "· Tuesday, September 22 · updated 7:30 PM".
- **Brief**: serif 27px, line-height 1.38, letter-spacing -0.005em, body color `#8f8a82`. Key phrases are `#ede9e3`. PR numbers are underlined: 1px `#4a453f`, underline offset 5px. Tone is conversational, e.g. "Evening, Aidan. Four pull requests are open across two repos…".
- **Actions**, 22px below: primary button "Review #158" (34px, radius 9, padding `0 14px`, 13.5/500) and secondary "Open #88" (inset ring `#2a2826`) with a "1 high" badge.
- **Filter row**, 44px below:
  - Search field: 40px, radius 10, bg `#181716`, ring `#242220`, text "Filter open PRs, or paste a URL", `/` keycap.
  - A 40px refresh icon button.
- **Repo chips**, 14px below: 30px, radius 8. Active chip `#1f1e1c` with ring `#2a2826`. The "Interactive review" switch is on the right.
- **Groups**, 30px below, 28px apart. Group header: GitHub icon, repo name in mono, count.
- **Rows**: padding `14px 12px`, 1px bottom divider `#1f1e1c`.
  - Content: PR icon `#86c98c`, title 14.5px, `#num` in mono 12 `#6f6a63`, then a meta line in mono 11.5 (head → base · files +add −del · age).
  - Right side: status chip and chevron.
  - On hover, those swap for "Interactive" (secondary) and "Review" (primary) buttons (see Interactions).
- Empty repo line: "aidan-neel/skills · no open pull requests" in `#57534d`.

### 3b Live review (running)
- **Session header**: 52px, padding `0 10px 0 18px`.
  - Title 14px with ellipsis.
  - Meta in mono 11.5 `#8a857d`: branch, "ledger-api #4127", "6 files +73 −34".
  - Segmented control: container `#1a1918` with inset ring `#232120`, padding 3, radius 9. Items 26px, radius 7; active item `#262422`.
  - `…` menu.
- **Step row** under the header: padding `0 18px 12px`, bottom border `#1d1c1a`. Steps are joined by 28px × 1px lines `#2a2826`.
  - Done step: 16px circle `#232120` with a `#86c98c` check.
  - Current step: spinner `#e9c07a` with `#ede9e3` label.
  - Upcoming step: ring `#34312d` with `#6f6a63` label.
  - Right end: pulse dot plus "Live · 2:14" in mono.
- **Transcript**: max-width 740, centered, padding `30px 24px 180px`, gap 18.
  - User bubble: `#211f1d`, radius `14 14 4 14`, padding `10px 14px`, 14/21 `#e4dfd8`, right-aligned, max 520.
  - "Reviewed changes for 12s ›" in 13px `#6f6a63`.
  - **AI prose**: serif 18px, line-height 1.55, `#e4dfd8`. Inline code: mono 14, bg `#211f1d`, radius 4, padding `1px 5px`.
  - Tool group: header "Read 4 files, searched once" with a check. Children are indented behind a 1px `#2a2826` left rule (margin-left 6, padding-left 14). Each child row is 26px: action (62px column), target in mono `#bdb8b0`, duration in mono `#57534d`.
  - "Created 5 specialists ›", then a list. Rows have padding `11px 4px` and a `#211f1d` divider.
    - Left: name 13.5 with model in mono 11 `#57534d`, then the current op in mono 11.5 `#8a857d`.
    - Right: status chip (12px, radius 6, padding `3px 8px`, spinner while running) and a chevron.
  - Footer line: spinner plus "Waiting on correctness and performance".
- **Composer**: floats at the bottom over a gradient fade (`transparent → #141312` at 40%), inner max-width 740. See the 5c spec.

### 3c Diff: Inline mode
- **Header**: as in 3b, with the Diff segment active.
- **Toolbar**: padding `0 14px 12px 18px`, bottom border `#1d1c1a`, all items 32px tall.
  - Findings stepper (ring `#2a2826`, radius 9): "Findings 2/6" with ▲▼ buttons.
  - Severity count chips: radius 9, 12.5/500, colored text on tinted background.
  - Right side: "✓ Review complete", secondary "Ask reviewer", and primary "Fix all 4" with a count badge on `rgba(0,0,0,.16)`.
- **File tree**: 256px wide, right border `#1d1c1a`, padding `14px 10px`.
  - "Changed files 6", a filter field (30px, `#181716`), and an "Only files with findings" checkbox.
  - Rows 28px, radius 7. Selected row `#191919`-ish (`#1c1b19`). Per file: mono name, +/− counts, and the finding count colored by the highest severity.
- **Diff header**: **44px**, padding `0 16px 0 20px`, bottom border `#1d1c1a`. Contents: path (dir `#6f6a63` + filename), +/− counts, "Viewed" checkbox, Unified/Split toggle.
- **Diff lines**: grid `44px 44px 18px 1fr`, mono 12.5, line-height 22.
  - Add bg `rgba(134,201,140,.08)`; delete bg `rgba(240,138,126,.08)`.
  - Lines covered by a finding get a 2px inset left bar and a line-number color matching the severity.
  - Collapsed-lines separator: centered "2 unchanged lines" between 1px `#211f1d` rules.
- **Inline finding card**: margin `8px 24px 12px 106px`, padding `13px 16px 12px`, radius 12, bg `#1a1918`, ring `#242220`.
  - Header: severity pill, category, id on the right.
  - Serif body 16.5, line-height 1.45.
  - Optional **Suggested fix** box: 1px dashed `#37332f`, radius 10, "applies cleanly" in `#86c98c`, fix lines in mono 12/19.
  - Footer: "Agent · model", then "Discuss" (ghost), "Dismiss" (ghost), and "Apply fix" (primary, 28px).

### 2f / 3d Diff: Focus mode
- Segmented control: `Conversation · Findings · Files`.
- Body: 12px padding, 12px gap, two columns.
- **Left column (410px)**: "Needs you 6 · by severity, then confidence", with filter and search icon buttons. Below it, stacked finding cards, 8px apart.
  - Card: radius 12, padding `12px 14px`, shadow `0 4px 14px rgba(0,0,0,.22)`.
  - Card contents: severity pill, category, location in mono on the right, serif 15.5/1.42 body.
  - The active card gets a stronger ring plus Dismiss and Discuss buttons.
- **Right column, focused diff card**: radius 12, bg `#161514`, ring `#242220`, shadow `0 6px 20px rgba(0,0,0,.25)`.
  - Header 42px: path, "lines 19–26", "Full file ↗".
  - Only the relevant hunk is shown.
- **Right column, detail card**: bg `#1a1918`, ring `#2a2826`, padding `14px 16px`.
  - Header: severity pill, title 13.5/500, "F-03 · Correctness · model".
  - Serif 16.5/1.5 body with inline code.
  - **Evidence** block: `#141312`, ring `#242220`, header "Evidence" plus the source reference in mono.
  - Suggested fix box.
  - Footer: "Pushes one commit to `branch`", then Dismiss, Discuss (secondary) and Apply fix (primary, 30px).

### 4a Finding thread (right panel)
- 460px panel docked to the right of the diff. Bg `#131211`, left border `#1d1c1a`.
- **Panel header is 44px**, the same height as the diff header, so the bottom borders line up.
  - Contents: severity pill, title with ellipsis, id, close ×.
- **Thread**: padding `18px 18px 0`, gap 16.
  - Original finding: meta line "Performance · model · 14 min ago", serif 16.5 body, location in mono.
  - Then a divider, the user bubble, a tool line ("✓ Searched for evictIdle, read clock.ts 1.4s"), the serif reply, and a revised suggested-fix box with Copy and Apply fix buttons.
- **Composer**: radius 16, bg `#1a1918`, ring `#2a2826`. Placeholder "Reply to Performance…".
  - Footer: "Shared with Orchestrator", "Resolve" (ghost), the model trigger (5c style, e.g. "Qwen3 Coder"), and a 28px send button.

### 4b Ask reviewer (right panel)
- Same panel frame as 4a. Header: "Orchestrator" plus close.
- Selected diff lines are highlighted with bg `rgba(127,166,245,.16)` and a 2px inset bar `#7fa6f5`.
- **User message**: a context chip (mono 11, `#1a1918`, ring `#242220`, file icon, "limiter.ts:20–23 · After") above the bubble.
- **Reply**:
  - Tool line, then serif answer.
  - Quoted code block (`#181716`, ring `#242220`, mono 12/20, highlighted line `rgba(233,192,122,.10)`).
  - Follow-up paragraph in `#a39e96`.
  - Chips "Add to F-03" and "+ New finding" (28px, ring `#2a2826`).
- **Composer**: a removable context chip, placeholder "Ask about this code…", paperclip, model trigger, send.

### 4c Settings (modal)
- **Frame**: scrim `rgba(8,7,6,.6)`. Modal 900 × 712, radius 16, bg `#161514`, ring `#2a2826`, shadow `0 30px 80px rgba(0,0,0,.6)`.
- **Left nav**: 200px, `#121110`.
  - Items Models, Connections, Review harness, Appearance: 32px, radius 8; active `#1f1e1c`.
  - Config path in mono at the bottom.
- **Header**: 56px, "Models" 15/500, close.
- **Provider cards**: two columns, radius 12, padding 14.
  - ChatGPT (signed in): green dot, account line, two usage bars (3px, fill `#cfcac2`) for the 5-hour and weekly windows.
  - OpenAI-compatible: base URL and API key fields (30px, `#141312`, ring `#262422`).
- **Roles list**: ring `#242220`, radius 12. Rows have padding `9px 12px 9px 14px` and a `#211f1d` divider.
  - Left: name 13 and description 11.5 `#6f6a63`.
  - Right: **the same quiet trigger as the composer**, e.g. `5.6 Sol` + `High` in `#8a857d`. It is transparent, gets `#232120` on hover, and opens the same 5c menu.
  - Roles without an effort control show only the model ("Qwen3 Coder"). Roles that inherit show "Same as Orchestrator" in `#8a857d`.
  - **No separate Low/Med/High segmented control.**
- **Footer**: 60px. "Overrides RECODER_REVIEW_* env vars", Cancel (esc keycap), Save (⌘↵ keycap).

### 4d First run
- The top bar shows **no session tabs** (Home only).
- Column 620px wide, starting 110px from the top.
  - "Welcome to Recoder" 12.5 `#6f6a63`.
  - Serif 28/1.35 headline: "Three steps before your first review." in `#ede9e3`, followed by a `#8f8a82` sentence.
- **Checklist card**: radius 14, bg `#1a1918`, ring `#242220`, shadow `0 8px 24px rgba(0,0,0,.25)`, rows split by `#232120`.
  1. Connect GitHub. Done: green check circle, "Signed in as `aidan-neel` via gh CLI".
  2. Add a reviewer model. Current step: row bg `#1d1c1a`, numbered ring `#cfcac2`, buttons "Sign in with ChatGPT" (primary, 34px) and "Use an API endpoint" (secondary).
  3. Track a repository. Locked: dim text and a disabled "Browse repos" button.
- Below the card: a disabled "Or paste a pull request URL" field with the note "available after step 2", then a terminal hint.

### 4e ⌘K palette
- Scrim over the diff. Palette 660px wide, top 118px, radius 14, bg `#181716`, ring `#2e2b28`, shadow `0 30px 80px rgba(0,0,0,.6)`.
- **Input row**: 54px, search icon, 15.5px text, scope hint "in ledger-api #4127" on the right.
- **Results**, in order:
  - Ask row: "Ask Orchestrator: "…"", `#24221f`, ⌘↵ keycap.
  - Findings group: severity pill, title with the query highlighted (`rgba(233,192,122,.18)`), location.
  - Files group: mono path plus +N or match count.
  - Actions group: Review a pull request… `R`, Fix all open findings `4`, Switch to conversation `⌘1`.
- Group labels: 11.5 `#6f6a63`. Rows 36–40px, radius 9.
- **Footer**: 36px with keycaps for ↑↓ navigate, ↵ open, ⌘↵ ask, and "Tab to search all sessions".

### 5c Composer model menu (used everywhere a model is picked)
- **Trigger**: a quiet text button, 30px (28px in side panels), padding `0 9px`, radius 8, 12.5px.
  - Label: model display name in `#ede9e3`, then the **full effort word** in `#8a857d`, e.g. `5.6 Sol Medium`, `5.6 Sol High`, `5.6 Sol Mini Minimal`.
  - No abbreviations ("Med" is wrong).
  - Models without an effort control show only the name.
  - **Background is transparent at rest**. It turns `#232120` on hover and `#2a2826` while the menu is open.
  - Position: right side of the composer footer, just before the send button. The paperclip sits on the far left.
- **Menu**: 250px, opens upward, anchored to the trigger's right edge with an 8px gap.
  - Bg `#1c1b19`, ring `#2e2b28`, shadow `0 20px 50px rgba(0,0,0,.55)`, radius 12, padding 6.
  - Rows are 32px, radius 7:
    - `Model › 5.6 Sol`
    - `Reasoning effort › Medium`. For models with no effort control this row shows "Not supported" dimmed and has no chevron.
    - Divider.
    - `Apply to all specialists`, with a switch.
    - `Role models…` with a ⌘, keycap. It opens Settings → Models.
  - **There is no Speed row.**
- **Submenus**: open to the left of the menu when a row is hovered, top-aligned to that row, with a 6px invisible bridge so the pointer can cross the gap.
  - Model submenu (230px): display name plus provider in 11px `#6f6a63`, check on the selected one.
  - Effort submenu (250px): check column plus label 13 and description 11.5.
  - **The effort options come from the selected model's capabilities.** Do not hardcode Low/Med/High. For example, one model offers Low/Medium/High while its Mini variant also offers Minimal.
  - Switching to a model that lacks the current effort resets effort to that model's default.

## Interactions and behavior
`Recoder Interactions.dc.html` is the working reference. Match it.

- **Hover highlight**: instant. A single highlight layer per list or tab group snaps to the hovered item and fades in and out over 120ms. It does not travel between items. Applies to the tab bar, PR rows, menus and submenus.
- **Active tab pill**: slides to the clicked tab (transform and width, 240ms `cubic-bezier(.3,.7,.2,1)`).
- **Hover color and background**: 120ms ease-out.
- **Press**: scale 0.97 over 80ms; icon buttons scale 0.92.
- **Menus**: fade in and rise 4px from the trigger (scale .98 → 1), 150ms `cubic-bezier(.2,.8,.2,1)`, with transform-origin at the trigger. Submenus slide 4px horizontally over 120ms. Close on outside click and Esc.
- **Trigger label change**: the new label fades in and rises 2px over 180ms.
- **Composer**:
  - Focus changes the ring from `#2a2826` to `#3d3935` over 150ms.
  - Send is disabled (`#232120` bg, `#57534d` icon) while the input is empty, and turns primary when there is text.
  - Enter sends; Shift+Enter inserts a newline.
  - While a reply is pending, Send becomes Stop: a 9px square with a spinning ring around the 30px button. Clicking it cancels.
  - The pending reply shows a shimmering "Thinking" line.
- **PR row**:
  - On hover, the meta text fades out and the Review button fades in while sliding 6px left (150/180ms).
  - Clicking goes through four states: Starting (spinner in the button), Running (spinner icon, shimmering "Planning" plus a 64px indeterminate bar), then Done (check icon; the finding count fades in).
  - The matching top-bar tab mirrors this status.
- **Live activity**: status line cycles "Planning review" → "Working" → "Writing" → "Done · 4.1s".
  - Tool rows grow from 0 to 26px (200ms). Each shows a spinner that becomes a check, and its duration fades in.
  - Streaming text shows a 2px blinking caret (1s, steps).
- **Shimmer**: gradient text sweep, 1.6s linear, infinite.
- **Apply fix**:
  - The button has a fixed width of 112px so it doesn't jump between states.
  - States: Apply fix → Applying (spinner) → Applied (check, transparent background, `#86c98c` text, ring `#2e2b28`).
  - The severity pill crossfades to "Fixed" (green) and the title dims to `#8a857d`.
  - A toast rises 12px and fades in over 220ms: "✓ Fix applied to limiter.ts · Undo". It dwells for 5s. Undo reverts the fix.
  - Copy flips to "✓ Copied" in green for 1.2s.
- **Skeleton → content**:
  - Skeleton bars shimmer (gradient `#1c1b19 → #262422`, 1.4s).
  - When data arrives, the skeleton fades out and the rows fade in, rising 4px over 220ms with a 40ms stagger starting at 80ms.
  - Use this for Home, the file tree and the findings lists.
- **Search field focus**: bg `#151413` → `#1a1918`, ring `#3d3935` plus a 3px `rgba(237,233,227,.06)` halo.
- **Switches**: the knob slides over 160ms `cubic-bezier(.3,.7,.2,1)`. The track is primary when on and `#34312d` when off.
- **Reduced motion**: transitions snap; spinners keep turning.

## State
- `sessions[]`: `{id, repo, pr, status: idle|starting|running|passed|failed, progress:"4/6", findingCounts}`. This drives the top-bar tabs and Home rows.
- `activeTab`: Home or a session id.
- `models[]` from the provider registry: `{id, displayName, provider, efforts: [{id, label, description}] | null, defaultEffort}`.
- `roleModels`: per role `{modelId | "inherit", effortId}`. The composer selection is the Orchestrator's, unless "Apply to all specialists" is on.
- Review stream events: step, tool call start/end (with duration), specialist status, text delta, done. These drive 3b.
- Findings: `{id, severity, category, agent, model, file, lines, body, evidence?, fix?, status: open|dismissed|applied}`.
- Fix application: `idle|applying|applied`, plus a toast queue with undo.
- Loading flags per list, which drive the skeletons.

## Assets
- Icons: Lucide, stroke 1.75, 12–16px.
- Fonts: Geist (UI), Geist Mono (code/meta), Lora (AI voice), all from Google Fonts.
- There are no images or logo mark. The brand is the "Recoder" wordmark only.

## Files
- `Recoder Redesign.dc.html`: all screen artboards (use the ids above).
- `Recoder Interactions.dc.html`: live interaction reference.
- `RecoderTopbar.dc.html`: the top bar component used by the artboards.
- `RecoderSidebar.dc.html`: the old sidebar, which only 2f uses. Do not build it.
- `support.js`: runtime for opening the reference files.
