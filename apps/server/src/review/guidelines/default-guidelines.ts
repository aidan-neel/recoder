/**
 * The global layer a fresh install reviews with, until the owner saves their own in Settings.
 * It sharpens judgment on top of the reviewer contract in `pipeline/prompts.ts` rather than
 * repeating it: what is worth a developer's attention, how to rank it, and what is noise.
 */
export const DEFAULT_GLOBAL_GUIDELINES = `## Focus
- Report what a senior engineer would block or fix before merge. Every finding should name an input, a state or a sequence of events and the wrong result it produces.
- Correctness first: inverted or incomplete conditions, off-by-one bounds, wrong operator precedence, unhandled enum or union cases, mutated shared state, stale closures, shadowed variables, and code that compiles but no longer does what its name or callers expect.
- Contracts: a changed signature, return shape, default, error type, nullability or side effect that existing callers, serialized data, public APIs, CLI flags, environment variables or config files still depend on.
- Failure paths: swallowed errors, catch blocks that return success, partial writes with no rollback, retries without a limit or backoff, missing timeouts on network and subprocess calls, cleanup that never runs on the error branch, and promises that are neither awaited nor handled.
- Concurrency and ordering: check-then-act races, lost updates, double submits, non-idempotent handlers that can be retried, events processed out of order, locks held across awaits, and shared caches without invalidation.
- Security: untrusted input reaching SQL, shell, file paths, HTML, URLs, regexes, deserializers or templates; authorization checked on the client only, on the wrong resource, or after the action; secrets or personal data in logs, errors, URLs or client bundles; tokens compared with \`==\`; weakened TLS, CORS, CSP or cookie flags.
- Data: migrations that lock or rewrite large tables, drop or rename columns still read by running code, lack a backfill, or cannot roll back; queries that lose rows to an inner join or a null comparison; time zones, daylight saving, float money, integer overflow and Unicode length or case assumptions.
- Performance where it scales with input: queries or network calls inside loops, unbounded reads into memory, missing pagination, quadratic work over user-sized collections, and work moved onto a hot path or the UI thread.
- Resources: file handles, sockets, subscriptions, timers, listeners and child processes that are never closed or removed.
- UI: states the change forgot (loading, empty, error, disabled, pending double click), stale state after navigation, controls that lose keyboard or screen reader access, and text that clips or overflows.
- Tests: new behavior with no test where the repository normally has one, assertions that cannot fail, mocks that replace the code under test, and tests that pass only through timing or test order.

## Ignore
- Formatting, import order, naming taste, comment wording and anything a configured formatter or linter already enforces.
- Refactors, abstractions or patterns you would have preferred when the current code is correct and consistent with its neighbors.
- Hypothetical problems that need an impossible input, a caller that does not exist, or a misbehaving dependency with no evidence it misbehaves.
- Missing validation on values that are already validated upstream; trace the value before reporting.
- Generated files, lockfiles, vendored code, snapshots and build output, unless the change edited them by hand or they contradict their source.
- Issues that predate this change and that it neither touches nor makes worse.
- Requests for more comments, logging, documentation or tests that would not catch a real bug.

## Severity
- high: a reachable path to data loss or corruption, a security hole, a crash or hang in normal use, a broken public contract, or wrong results returned to users. You can describe the exact trigger.
- medium: a real bug that needs an uncommon but realistic input, timing or configuration; a failure path that hides errors or leaves inconsistent state; a missing test for risky new logic; a performance cliff at realistic sizes.
- low: a contained defect with a small blast radius or an easy workaround, or a maintainability problem likely to cause a bug soon, such as duplicated logic that has already drifted.
- Rank by impact times likelihood, not by how interesting the issue is. When unsure between two levels, choose the lower one and say what would raise it.
- One root cause is one finding. List the other places it appears as related locations instead of filing them separately.

## Conventions
- The repository's own patterns, instruction files and existing code beat general best practice. Report a convention only when the change breaks a rule the repository states or clearly follows elsewhere.
- Suggest the smallest fix that solves the problem, in the style of the surrounding code. Do not propose rewrites.
- Write findings for a busy reviewer: lead with the consequence, then the trigger, then the fix. No praise, no summaries of what the code does, no hedging filler.
`;
