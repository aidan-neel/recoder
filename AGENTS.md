# AGENTS.md

## Commands

- Web (SvelteKit): `bun run --filter @recoder/web check` · `bun run --filter @recoder/web build`
- Server: `bun run --filter @recoder/server check` · `bun run --filter @recoder/server test`
- Shared: `bun run --filter @recoder/shared check`

Run the relevant `check` (and tests) before finishing a change.

## UI requirement (mandatory — no exceptions)

- **ALL UI must be built with Sivir UI components** from `@sivir-ui/svelte`.
  This is a hard requirement. Never hand-roll a control or surface when a Sivir
  component exists (buttons, triggers, modal/sheet/popover/dialog, menus,
  selects, inputs, cards, collapsibles/disclosures, alerts, badges, tabs,
  tooltips, scroll areas, skeletons, progress, typography, etc.).
- **Before making ANY UI change**, first find the Sivir component(s) that cover
  it, then build with them. Do not ship raw `<div>`/`<details>`/`<dl>`/native
  form controls or bespoke overlays as a substitute for Sivir primitives.
- **Verify it actually works before finishing.** At minimum run
  `bun run --filter @recoder/web check` and `bun run --filter @recoder/web build`,
  and confirm the interaction/render is correct. Do not claim a UI change works
  without this verification.

## UI conventions

- **Default control size is `size="md"`.** Sivir `Button`, `Select.Trigger`,
  `Modal.Trigger`, `Modal.Close`, and other button-based triggers already
  default to `md`, so omit the `size` prop rather than passing it.
- Do **not** pass `size="sm"` unless a compact control is explicitly required
  (e.g. a dense toolbar row). Prefer `md` everywhere else.
- For square icon-only controls use `size="icon"`; keep the hit target at least
  `size-9`.

