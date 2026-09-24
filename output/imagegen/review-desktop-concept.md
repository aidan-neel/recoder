# Recoder desktop review concept

Design exploration only. Generated with the built-in imagegen tool; application code and review behavior are unchanged. Sample review content is illustrative.

## Direction

Keep code central within the existing Midnight Ledger theme. Make review activity visible throughout the workspace and make the reviewer's context explicit.

- Replace the ambiguous view-switching “Conversation” control with visible “Code changes” and “Review activity” navigation.
- Keep “Ask reviewer” as the consistently named toggle and panel title. Use an integrated panel with a code-context chip, a readable transcript, and a rectangular Sivir Composer.
- Give the running review a persistent status strip: explicit running label, spinner, elapsed time, actual pipeline stage, completed specialist count, current operation, and most recent update.
- Bound the file rail to 248px by default, with a 220–280px range for a future implementation. Truncate long names and reveal full paths in Sivir Tooltip. Keep counts from expanding the row.
- Preserve the existing collapsible application rail. The concept depicts its collapsed state to maximize code space.

## Existing tokens

Values come from the final declarations in apps/web/src/app.css. Earlier radius declarations are overridden later in that file.

| Role | Token | Dark | Light |
| --- | --- | --- | --- |
| Workspace | --color-background | #0f0f0f | #fafafa |
| App chrome | --color-chrome | #111111 | #f3f3f3 |
| Cards and panels | --color-card / --color-panel | #171717 | #ffffff |
| Secondary surface | --color-secondary | #191919 | #efefee |
| Border | --color-border | #2a2a2a | #dedede |
| Subtle divider | --color-border-subtle | #1f1f1f | #e5e5e5 |
| Primary action | --color-primary | #281ee6 | #281ee6 |
| Readable activity accent | --color-info-vivid | #a5b4fc | #2f3ac7 |
| Focus ring | --color-ring | #a5a0ff | #827bff |

Use existing severity and syntax tokens. Inter is the UI face; JetBrains Mono is for code, paths, and elapsed time. Final radii are 4 / 6 / 12 / 16px. Spacing follows the 4px unit. Standard controls use default md; icon controls use size="icon" with at least 36px hit areas. Headings have titles only.

## Sivir component mapping

| Design element | Existing Sivir primitives |
| --- | --- |
| Workspace and finding surfaces | Card |
| Navigation and file filters | Tabs |
| Live review strip | Card, Spinner, Progress, TaskSteps, Typography |
| File search and rows | Input, Button, Collapsible, Badge, Tooltip |
| Reviewer transcript | Conversation, Message, Markdown, Typography |
| Code-context disclosure | Collapsible, CodeBlock |
| Message input and actions | Composer, Button |
| Independent panel scrolling | ScrollArea with showCues={false} |
| Overflow and display options | DropdownMenu |

## State and sizing notes for later implementation

The image shows one moment during a review. Animate only the spinner and indeterminate progress accent while running; keep the explicit status label and current operation visible with reduced motion. Use existing motion-duration tokens for interactions.

Do not convert stage position or completed-specialist count into an invented overall percentage or ETA. Counts and current operations must come from actual review events. “Updated” must reflect review work events rather than a connection heartbeat. Preserve the latest content and show “Reconnecting” when the stream disconnects.

The actual pipeline stages are Checkout, Understand changes, Specialist review, and Consolidation. A completed review replaces running indicators with its outcome; failures and incomplete reviews remain explicit. If provisional findings are exposed during a run, label them accordingly; the image does not imply that live provisional findings are already supported.

At a logical width of 1600px: global rail about 56px, file rail 248px, reviewer 344px, diff takes the remaining space. At narrower desktop widths, collapse the global/file rail before allowing the diff to become unreadable. Long code scrolls horizontally inside its own region. These are proposed constraints, not implemented behavior.

## Verification

Inspected the current theme, session workspace, review conversation, sidebar, live progress, and relevant installed Sivir components. The existing assets/session.png was used as a visual reference; its older layout was not treated as the current implementation.

The Browser connection was unavailable, so the current running application was not visually inspected. This deliverable is a generated design image, not an interactive prototype. No application changes were made and no application check/build was required for the image and notes.

