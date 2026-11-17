import { configForOrchestrator } from '../../../models/models.js';
import { trackBackgroundWork } from '../../../util/background-work.js';
import { readCache, writeCache } from '../../../util/json-cache.js';
import { runJsonAgent } from '../../pipeline/agent-loop.js';
import { ModelBudget } from '../../pipeline/agent-loop/budget.js';
import type { JsonAgentOptions } from '../../pipeline/agent-loop/options.js';
import { orchestratorAgentOptions, type ReviewRun } from '../../pipeline/harness/context.js';
import { reviewNow } from '../../session/review-control.js';
import { REVIEW_POLICY } from '../../session/review-policy.js';
import { ruleAppliesTo } from './glob.js';
import { LEDGER_FINAL_EXAMPLE, LEDGER_SYSTEM_PROMPT, ledgerUserPrompt } from './prompt.js';
import { hashSources, readLedgerSources, repoLineage, type LedgerSource } from './sources.js';
import { ruleCitation, ruleSummary, type RepoRule, type RuleLedger } from './types.js';
import { ledgerReplySchema, toLedger, type LedgerReply } from './validate.js';

export { ruleCitation } from './types.js';

const CACHE_NAMESPACE = 'rule-ledger';

/** The sources hash of the newest ledger distilled for a repo, keyed by `repoLineage`. */
const LATEST_NAMESPACE = 'rule-ledger-latest';

/** How long a refresh for the next review may take once the review that started it has moved on. */
const REFRESH_MS = 10 * 60 * 1000;

/** Distills running for a later review, by sources hash, so reviews of one base ask once between them. */
const refreshing = new Map<string, Promise<unknown>>();

/** Where one distill call runs: inside the review that waits for it, or detached for the next review. */
type LedgerCall = Pick<JsonAgentOptions<unknown>, 'config' | 'budget' | 'evidence' | 'signal' | 'deadlineAt'> &
	Partial<Pick<JsonAgentOptions<unknown>, 'getDiscussion' | 'onMessage' | 'onReasoning' | 'onTool' | 'onLog'>>;

/** A call on the review's own budget, clock and feed, for a review that has no ledger to start from. */
function reviewCall(run: ReviewRun): LedgerCall {
	return {
		...orchestratorAgentOptions(run, configForOrchestrator()),
		deadlineAt: run.investigationDeadline,
		onLog: (message) => run.events?.onLog?.(message)
	};
}

/**
 * A call that outlives the review: its own budget of the one call and its
 * repairs, its own timeout, and nothing written to the review's feed, which
 * may have closed by the time it answers.
 */
function refreshCall(run: ReviewRun): LedgerCall {
	return {
		config: configForOrchestrator(),
		budget: new ModelBudget(1 + REVIEW_POLICY.schemaRepairAttempts, 0),
		evidence: run.evidence,
		signal: AbortSignal.timeout(REFRESH_MS),
		deadlineAt: reviewNow() + REFRESH_MS
	};
}

/** One model call that turns the sources into rules; null when it can't run or answer. */
async function distill(call: LedgerCall, sources: LedgerSource[]): Promise<LedgerReply | null> {
	const result = await runJsonAgent({
		stage: 'ledger',
		label: 'rule ledger',
		...call,
		system: LEDGER_SYSTEM_PROMPT,
		user: ledgerUserPrompt(sources),
		maxTurns: 1,
		finalExample: LEDGER_FINAL_EXAMPLE,
		parse: (raw) => {
			const parsed = ledgerReplySchema.safeParse(raw);

			return parsed.success ? parsed.data : null;
		}
	});

	if (result.error) call.onLog?.(`Rule ledger: ${result.error}`);

	return result.value;
}

/** Distills and caches the ledger of `sources`, and records it as the repo's newest. */
async function distillLedger(
	call: LedgerCall,
	sources: LedgerSource[],
	sourcesHash: string,
	lineage: string | null
): Promise<RuleLedger | null> {
	const reply = await distill(call, sources);

	if (!reply) return null;

	const ledger = toLedger(reply, sources, sourcesHash);

	writeCache(CACHE_NAMESPACE, sourcesHash, ledger);
	if (lineage) markLatest(lineage, sourcesHash);

	return ledger;
}

/** Records the ledger of `sourcesHash` as the one a later review of the repo starts from when its own is not cached. */
function markLatest(lineage: string, sourcesHash: string): void {
	writeCache(LATEST_NAMESPACE, lineage, { sourcesHash });
}

/** Starts distilling `sources` for the next review, unless a review already is. Never rejects. */
function refreshLater(run: ReviewRun, sources: LedgerSource[], sourcesHash: string, lineage: string): void {
	if (refreshing.has(sourcesHash)) return;

	const job = distillLedger(refreshCall(run), sources, sourcesHash, lineage).finally(() =>
		refreshing.delete(sourcesHash)
	);

	refreshing.set(sourcesHash, job);
	trackBackgroundWork(job);
}

/** The newest ledger distilled for the repo at any base, when its entry is still in the cache. */
function latestLedger(lineage: string): RuleLedger | null {
	const latest = readCache<{ sourcesHash?: unknown }>(LATEST_NAMESPACE, lineage);

	return typeof latest?.sourcesHash === 'string' ? cachedLedger(latest.sourcesHash) : null;
}

/** A ledger as a review uses it: null without rules, else with each rule's revision read from `sources`. */
function usable(ledger: RuleLedger, sources: LedgerSource[]): RuleLedger | null {
	return ledger.rules.length ? withSourceRevisions(ledger, sources) : null;
}

/** A cached ledger, when the entry has the shape this version writes. */
function cachedLedger(sourcesHash: string): RuleLedger | null {
	const cached = readCache<RuleLedger>(CACHE_NAMESPACE, sourcesHash);

	return cached && Array.isArray(cached.rules) && cached.sourcesHash === sourcesHash ? cached : null;
}

/** Refreshes each rule's `source.revision` from the current run's sources when reading a cached ledger. */
function withSourceRevisions(ledger: RuleLedger, sources: LedgerSource[]): RuleLedger {
	const revisions = new Map(sources.map((source) => [source.path, source.revision]));

	return {
		...ledger,
		rules: ledger.rules.map((rule) => {
			const revision = revisions.get(rule.source.path);
			const { path, line, endLine } = rule.source;
			const base = { path, ...(line !== undefined && { line }), ...(endLine !== undefined && { endLine }) };

			return { ...rule, source: revision ? { ...base, revision } : base };
		})
	};
}

/**
 * The repo's guidelines as numbered rules. Read at the base commit and cached
 * by the sources' hash, so every review of the same base reads the same
 * ledger. When the guidelines changed since the repo's last ledger, the review
 * goes on with that ledger and the new one is distilled behind it for the next
 * review: a model call here holds every reviewer back for minutes. Only a
 * repo's first standard review waits for one. A Spark review never distills:
 * it runs its models at low effort, and a ledger is cached for every review of
 * its sources, so it takes the newest ledger there is, or goes on without
 * rules. Null when there are no sources, no rules, or the call could not run.
 */
export async function buildRuleLedger(run: ReviewRun): Promise<RuleLedger | null> {
	const { revision } = run.input;
	const sources = await readLedgerSources(revision, run.controller.signal);

	if (!sources.length) return null;

	const sourcesHash = hashSources(sources);
	const lineage = revision ? await repoLineage(revision, run.controller.signal) : null;
	const cached = cachedLedger(sourcesHash);

	if (cached) {
		if (lineage) markLatest(lineage, sourcesHash);

		return usable(cached, sources);
	}

	const previous = lineage ? latestLedger(lineage) : null;

	const spark = run.input.speed === 'spark';

	if (lineage && previous && !spark) refreshLater(run, sources, sourcesHash, lineage);
	if (previous) return usable(previous, sources);
	if (spark || !run.budget.canSpend(1)) return null;

	const ledger = await distillLedger(reviewCall(run), sources, sourcesHash, lineage);

	return ledger?.rules.length ? ledger : null;
}

function appliesToAny(rule: RepoRule, paths: string[]): boolean {
	return paths.some((path) => ruleAppliesTo(rule, path));
}

/** What reviewers are told about a rule's standing with the repository's people. */
const STANDING_NOTE: Record<NonNullable<RepoRule['standing']>, string> = {
	'acted-on': ' People here usually act on findings of this rule.',
	'often-dismissed': ' People here usually dismiss findings of this rule; report only a clear break.'
};

function formatLedgerLine(rule: RepoRule): string {
	const levelNote = rule.level === 'advisory' ? ' [advisory]' : '';
	const exceptions = rule.exceptions?.length ? ` Exceptions: ${rule.exceptions.join('; ')}.` : '';
	const standing = rule.standing ? STANDING_NOTE[rule.standing] : '';

	return `${rule.id}${levelNote}: ${ruleSummary(rule)} (${ruleCitation(rule)})${exceptions}${standing}`;
}

/**
 * The rules a reviewer of `paths` checks by reading, one `R3: text (AGENTS.md:41)`
 * line each, in the ledger's order, with a note on a rule's level, exceptions and
 * standing when present. Mechanical rules are left out: the rule-check detector
 * runs them. Empty when none apply.
 */
export function ledgerBlock(ledger: RuleLedger | null, paths: string[]): string {
	if (!ledger) return '';

	return ledger.rules
		.filter((rule) => !rule.check && appliesToAny(rule, paths))
		.map(formatLedgerLine)
		.join('\n');
}
