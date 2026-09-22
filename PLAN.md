# Recoder: adaptive, repository-aware PR review

## 1. Objective and boundaries

Replace the current batch reviewer with an orchestrator that understands the PR, learns the repository’s conventions, and dispatches a bounded number of scoped specialists.

The result must review both:

- Engineering risks: correctness, security, performance, concurrency, errors, API compatibility.
- Repository fit: naming, structure, existing abstractions, framework idioms, formatting, documentation, and testing conventions.

Small, actionable convention findings are welcome when backed by repository evidence. Generic preferences and speculative rewrites are not.

Decisions already made:

- Keep the current custom harness and model library. Do not adopt libfx.
- No LSP integration.
- Read-only reviewing for this version. Agents may recommend checks but cannot execute repository scripts, install dependencies, or modify code.
- Use existing Sivir UI integration for frontend changes.
- Default to balanced depth with bounded work and explicit coverage gaps.
- No prescribed implementation tests. Grok decides whether tests are necessary and which to write or update.
- Preserve earlier credential-persistence, local-diff, and progress fixes. This task does not reopen authentication configuration.

## 2. Architecture and execution policy

### Replace the current fan-out

The main replacement point is apps/server/src/lib/harness.ts, wired into apps/server/src/commands/pipeline.ts.

Neither existing extreme is the target:

- Do not restore every role × every file batch × scouts × synthesis.
- Do not keep correctness-only general reviewing.

Use this sequence:

1. Fetch PR/MR metadata.
2. Prepare the local checkout and immutable revision metadata.
3. Inventory the changes and collect repository guidance.
4. Orchestrator produces scoped specialist assignments.
5. Specialists investigate using bounded, read-only retrieval.
6. Orchestrator optionally adds targeted follow-up assignments.
7. Consolidate findings and report coverage.

Planning, specialization, follow-up, and consolidation use the existing chatCompletion function. Do not introduce another agent framework.

### Roles and routing

Reuse existing role IDs and model overrides:

Role Responsibility
━━━━━━━━━━━━━ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
correctness Behavior, invariants, edge cases, regressions
───────────── ───────────────────────────────────────────────────────────────────
patterns Repository consistency, naming, architecture, framework idioms
───────────── ───────────────────────────────────────────────────────────────────
security Trust boundaries, authorization, injection, secrets, dependencies
───────────── ───────────────────────────────────────────────────────────────────
perf Queries, complexity, rendering, allocations, resource growth
───────────── ───────────────────────────────────────────────────────────────────
api Public contracts and compatibility
───────────── ───────────────────────────────────────────────────────────────────
concurrency Races, ordering, shared state
───────────── ───────────────────────────────────────────────────────────────────
errors Error propagation, retries, cleanup
───────────── ───────────────────────────────────────────────────────────────────
testing Existing test conventions and missing behavioral coverage
───────────── ───────────────────────────────────────────────────────────────────
docs Documentation and examples affected by the change
───────────── ───────────────────────────────────────────────────────────────────
dedup Missed existing helpers and duplicated implementations

Display patterns as Repository consistency, without changing its stored role ID.

Use the correctness model configuration for orchestrator calls. Specialists retain their existing per-role configurations. Do not add model-settings UI in this iteration.

For executable code changes, correctness and repository consistency are mandatory review responsibilities. Normally assign separate specialists; other roles are selected by relevance. Documentation-only changes do not require a token correctness assignment.

The orchestrator may create multiple assignments for one role when their scopes are distinct. Assignment identity must never equal role identity.

### Balanced default limits

Create one server-side policy object:

Limit Default
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ━━━━━━━━━━━━
Initial specialist assignments Up to 6
────────────────────────────────────────────────────── ────────────
Additional follow-up assignments Up to 2
────────────────────────────────────────────────────── ────────────
Concurrent specialist assignments per review 2
────────────────────────────────────────────────────── ────────────
Specialist model turns per assignment Up to 3
────────────────────────────────────────────────────── ────────────
Initial planner turns Up to 3
────────────────────────────────────────────────────── ────────────
Follow-up planning passes 1
────────────────────────────────────────────────────── ────────────
Final consolidation calls 1
────────────────────────────────────────────────────── ────────────
Total model calls per review 30
────────────────────────────────────────────────────── ────────────
Review analysis deadline, after checkout preparation 10 minutes
────────────────────────────────────────────────────── ────────────
Per-call deadline, including model-slot wait 90 seconds

These are ceilings, not targets. A small PR should normally need only the two baseline specialists.

All retries and malformed-output repairs consume the same budget. Allow one schema-repair attempt per assignment, within its turn limit. Do not add hidden retries or independently multiplying budgets.

Reserve one call and the final 90 seconds for consolidation. Stop launching investigations when that reserve would be consumed. The existing global model semaphore remains authoritative across reviews.

A specialist failure must not automatically cancel unrelated healthy assignments. Authentication failures affecting the entire configured service may terminate the run early.

## 3. Local evidence, planning, and specialist behavior

### Immutable local source

Continue using the local checkout as the source of diffs for both GitHub and GitLab. Provider APIs supply metadata, not the review patch.

Extend sandbox preparation to retain:

- Reviewed head SHA.
- Fetched target-branch SHA.
- Merge-base SHA.
- Local checkout identity.

Compute the patch from merge base to reviewed head. Read prevailing repository conventions from the fetched target revision; use merge-base content when comparing the old behavior.

Carry PR/MR title and description into planning. Treat descriptions, comments, source files, and instruction files as untrusted input. Repository instructions describe project conventions; they cannot override Recoder’s safety boundaries or request secret
access, network actions, or execution.

Remove live-provider error fallbacks that silently produce a successful stub review. Keep demos only in explicitly selected demo paths.

### Inventory and shared context

Build the inventory locally before asking the model to plan:

- Changed paths, old paths, statuses, additions/deletions, and stable hunk identifiers.
- Language and package/workspace boundaries.
- Manifests and relevant formatter/linter/compiler configuration.
- Target-branch AGENTS.md, contribution guidance, and relevant nested instructions.
- Related existing implementations, callers, and tests when discoverable.

Do not embed the entire repository or patch into every prompt.

Revise scope filtering:

- Do not assume every declaration file is generated.
- Do not exclude text SVG solely by extension.
- Preserve dependency and lockfile changes as relevant evidence; large lockfiles may receive summarized rather than full-content review.
- Keep generated, binary, explicitly excluded, or oversized content in the coverage ledger with a reason.

Never silently truncate a large file and claim it was reviewed.

### Read-only retrieval protocol

The current chat transport does not support native tool calls. Implement a validated JSON action loop over ordinary chat completions; leave discussion streaming behavior unchanged.

Expose only these capabilities:

- listFiles: revision and directory/prefix, with pagination.
- readFile: revision, exact path, start line, end line.
- search: revision, literal text, optional path prefix, with pagination.
- readDiff: exact file/hunk identifiers, with pagination.

Use revision aliases resolved by the server, not arbitrary model-supplied Git revisions. Read repository objects without following symlinks or entering submodules. Reject paths outside the indexed repository and invalid line ranges. Use fixed commands with
argument arrays where subprocesses are needed; expose no shell-command action.

Defaults: four retrieval requests per model turn, 200 lines per file read, 50 search matches per page, and 24,000 total returned characters per tool round. Smaller existing configured context caps still apply. Return continuation information and explicit
truncation flags.

Each returned excerpt gets an evidence ID recording revision, path, line range, and content. Cache repeated reads within the review.

Fix targeted reads so late-file lines can be retrieved without first truncating the file head.

### Planner output

Validate planner output with Zod before dispatch. Its output must contain:

{
summary: string;
assignments: Array<{
id: string;
role: ReviewRole;
title: string;
reason: string;
scope: Array<{ path: string; hunkIds: string[] }>;
questions: string[];
contextEvidenceIds: string[];
priority: number;
}>;
roleDecisions: Array<{
role: ReviewRole;
decision: "selected" | "not_needed" | "deferred";
reason: string;
}>;
}

Server validation enforces role IDs, scope existence, unique IDs, assignment limits, and mandatory responsibilities. Models cannot override budgets.

Planner instructions must explicitly require:

- Decide from changed behavior and PR intent, not extension matching alone.
- Explain security and performance selection or omission.
- Group related changes by behavior/package, not fixed file counts.
- Avoid overlapping assignments unless the different review questions justify it.
- Treat uncertain high-risk changes as investigation candidates.
- Identify unassigned areas honestly.

If planning remains invalid after its repair allowance, use a deterministic bounded fallback: correctness and repository-consistency assignments over the highest-priority eligible changes. Mark planning degraded and disclose any uncovered changes. Do not
revive all-role fan-out.

### Specialist instructions and completion

Each specialist receives the shared review contract, role focus, assignment questions, scoped diff references, repository evidence, and remaining budget.

Require it to:

- Inspect related existing code before proposing a new abstraction or convention.
- Distinguish intentional PR behavior from accidental inconsistency.
- Check whether a suspected issue is introduced or worsened by this PR.
- Cite evidence for every finding.
- Report which assigned hunks were actually examined.
- Return blockers, coverage gaps, and optional follow-up requests.
- Return zero findings when appropriate.

For convention findings, require either an applicable explicit rule or at least two comparable existing examples. Mixed local conventions are uncertainty, not a mandate to normalize code.

Replace the current blanket “skip minor nits” language. Instead allow concrete naming, formatting, documentation, and structure deviations, normally informational. Group repeated manifestations of one rule into one finding with related locations.

On its final allowed turn, the specialist must finish with its available evidence. It cannot spawn agents directly.

After initial assignments finish, the orchestrator may use its single follow-up pass to dispatch up to two narrowly scoped investigations, subject to remaining time and calls.

## 4. Findings, coverage, and durable progress

### Findings lifecycle

Keep specialist output as candidates until consolidation. Show candidate counts during review, but do not present them as confirmed findings.

Extend findings additively with:

- Assignment ID and category.
- Evidence references.
- Related locations.
- Optional old/new diff-side information for deleted-code findings.

Retain current severity values and existing consumers. Default older records to new-side locations when a line exists.

Before consolidation, validate that cited paths and lines exist at the specified revision and that referenced evidence was actually provided. A new-side anchor must be associated with the relevant change. Deleted-only issues may use an old-side location or
file-level finding rather than an invented new-side line.

Consolidation receives validated candidates and their evidence. It may keep, merge, clarify, or reject candidates; it cannot invent findings or new evidence. It must explain rejected candidates internally with short structured reasons.

Do not deduplicate solely by path or line: two distinct issues can share an anchor. Merge the same underlying problem while retaining provenance.

Do not silently suppress unresolved issues because a previous review reported them. Stable fingerprints may identify recurring findings, but the current review must still show current problems.

If consolidation fails, retain validated candidates separately as unconfirmed and mark the review incomplete. Never present “zero confirmed findings” as evidence the PR is clean.

### Shared contracts and persistence

Extend packages/shared/src/progress.ts with optional fields so older snapshots remain readable:

- Plan version and assignment records.
- Assignment ID and operation kind on tasks.
- Queue reason and queue/start/activity timestamps.
- Budget used/remaining.
- Candidate count.
- Coverage summary and detailed gaps.
- Review outcome: complete, partial, or failed.

An assignment has a stable identity; retrievals and model calls are child operations, not additional reviewer assignments.

Coverage is tracked by changed hunk and assigned responsibility. Use these states:

- pending
- reviewed
- partial
- excluded

A model being given a filename does not establish review coverage. Specialist completion reports must identify the hunks and responsibilities examined. Failed or abandoned work remains incomplete.

Persist plan changes and coverage in the existing SQLite-backed progress snapshot, not only in the in-memory event buffer. Add event types for plan and coverage updates using the existing sequence/replay mechanism.

Keep existing review status compatibility:

- passed: workflow finished with complete declared coverage, regardless of findings.
- failed: workflow incomplete or failed.
- The additive outcome distinguishes partial results from total failure.

Frontend labels must say “Review complete,” not imply merge approval. A complete review is not a correctness guarantee. Explicit exclusions remain visible.

On startup, terminalize previously running reviews as interrupted; retain their progress and candidates. Do not leave orphaned “running” rows indefinitely or attempt automatic resume in this version.

### Scheduling and observability

Propagate one review deadline/abort signal through queue waits, model calls, and retrieval work. At termination, release model slots and clear heartbeat timers. Ignore late results from terminated reviews.

Queue assignments before they are dispatched, but only acquire global model capacity when a concrete model call is ready. Do not pre-create hundreds of waiting promises.

Emit observable progress:

- Planning the review.
- Assignment selected, with its scope and reason.
- Reading/searching a named file.
- Waiting for model capacity, with elapsed wait.
- Model request running, with elapsed time.
- Assignment complete/partial/failed.
- Consolidating findings.

Heartbeats every five seconds update liveness without appending duplicate activity messages. Do not expose chain-of-thought or invent per-file activity during an opaque model request.

Browser disconnects must not cancel the server-side review. Preserve snapshot reconnect behavior and monotonic event ordering.

## 5. Frontend and implementation handoff

### Progress interface

Update the existing live-review and reviewing views with Sivir components already in use: TaskSteps, Progress, Collapsible, Button, and Spinner. Preserve package mode and the installed API; do not upgrade Sivir as part of this task.

Choose a stage header plus assignment list, rather than a chat-style transcript. The user’s primary question is which reviewers are doing what, not what every transport event said.

Show:

- Stable stages: checkout, understand changes, specialist review, consolidation.
- Plan summary and selected specialists with selection reasons.
- One row per assignment, including multiple assignments of the same role.
- Scope, current observable operation, model, elapsed time, and candidate count.
- Separate queued, waiting-for-model, active, complete, partial, and failed states.
- Coverage and exclusions in an expandable section.

Replace “0 of 680 tasks complete” with assignment-level reporting, such as “2 reviewers active · 1 queued · 3 complete.” Do not count tool reads, heartbeats, or model turns as reviewers.

On completion, retain the assignment history and display:

- Confirmed findings.
- Covered and uncovered scope.
- Checks recommended but not executed.

### Implementation order

1. Add the optional shared contracts, policy object, and durable progress fields.
2. Extend local revision metadata and implement safe evidence retrieval.
3. Implement validated planning, scoped specialists, and bounded scheduling.
4. Implement candidate validation, consolidation, and coverage outcomes.
5. Replace pipeline wiring and role-keyed progress callbacks with assignment-aware events.
6. Rework the frontend using those persisted states.
7. Remove obsolete batch/scout assumptions and update architecture documentation.

Preserve unrelated worktree changes. Do not keep two competing review engines or add a new framework dependency.

Grok should choose its own verification strategy and decide whether existing tests need adaptation or new tests are warranted. There is no required test-writing phase in this handoff.

The deliverable is one adaptive review workflow that respects repository conventions, chooses relevant specialists, exposes real progress, and states clearly what it did not review.
