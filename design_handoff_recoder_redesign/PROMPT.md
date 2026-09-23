# Prompt for Claude Code

Paste this into Claude Code from the repo root, after copying `design_handoff_recoder_redesign/` into the repo and moving `AGENTS.md` and `DESIGN.md` to the root.

---

Implement the Recoder dark redesign in `apps/web` (SvelteKit). Read these first, in order:
1. `AGENTS.md`: hard UI rules.
2. `DESIGN.md`: tokens, type, components, motion.
3. `design_handoff_recoder_redesign/README.md`: screen-by-screen spec.

The HTML files in `design_handoff_recoder_redesign/` are design references. Open them in a browser to check exact values and behavior. Recreate them with Svelte and Sivir components (https://sivir.dev/llms.txt); don't port the HTML.

Work in this order and stop after each phase for review:

1. **Foundation.**
   - Add the DESIGN.md tokens as CSS custom properties in `apps/web/src/app.css`.
   - Load Geist, Geist Mono and Lora.
   - Map Sivir's theme variables onto the tokens.
   - Build the shared pieces: Button (primary, secondary, ghost, icon), QuietTrigger, Menu with submenus, SegmentedControl, SeverityPill, Keycap, Switch, Skeleton, Shimmer text, Toast with undo, and a HoverHighlight helper (instant snap, 120ms fade).
2. **Shell.**
   - Replace the sidebar layout (`+layout.svelte`, `app-sidebar.svelte`) with the top bar.
   - The bar holds the Home tab, session tabs with live status badges, search/⌘K, the usage meter, settings and the avatar.
   - The active tab pill slides between tabs. Tabs overflow into a menu when they don't fit.
3. **Composer + model menu (5c).**
   - The model registry exposes each model's effort options.
   - Per-role selection, with "Apply to all specialists".
   - Send/Stop states, Enter to send.
4. **Home (3a).** AI brief, filter, repo chips, grouped PR rows with the hover-reveal Review button and the review lifecycle states, skeleton loading.
5. **Live review (3b).** Step row, streaming serif transcript with a caret, tool-call groups, specialist list, floating composer.
6. **Diff workspace.**
   - Inline mode (3c) and Focus mode (2f/3d) behind the session header's segmented control.
   - Findings stepper, severity chips, Fix all.
   - Inline finding cards and the Apply fix state machine with toast and undo.
7. **Right panels.** Finding thread (4a) and Ask reviewer with the selected-lines context chip (4b). Headers are 44px.
8. **Settings (4c)**, **First run (4d)**, **⌘K palette (4e)**.

Reuse the existing data model and API (findings, specialists, tool calls, review stream). Don't invent endpoints. If the design needs data that doesn't exist, list it and ask. After each phase, list any spec values you couldn't match and why.
