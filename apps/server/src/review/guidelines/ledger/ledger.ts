import { configForOrchestrator } from '../../../models/models.js';
import { readCache, writeCache } from '../../../util/json-cache.js';
import { runJsonAgent } from '../../pipeline/agent-loop.js';
import { orchestratorAgentOptions, type ReviewRun } from '../../pipeline/harness/context.js';
import { ruleAppliesTo } from './glob.js';
import { LEDGER_FINAL_EXAMPLE, LEDGER_SYSTEM_PROMPT, ledgerUserPrompt } from './prompt.js';
import { hashSources, readLedgerSources, type LedgerSource } from './sources.js';
import { ruleCitation, ruleSummary, type RepoRule, type RuleLedger } from './types.js';
import { ledgerReplySchema, toLedger, type LedgerReply } from './validate.js';

export { ruleCitation } from './types.js';

const CACHE_NAMESPACE = 'rule-ledger';

/** One model call that turns the sources into rules; null when it can't run or answer. */
async function distill(run: ReviewRun, sources: LedgerSource[]): Promise<LedgerReply | null> {
	const config = configForOrchestrator();

	const result = await runJsonAgent({
		stage: 'ledger',
		label: 'rule ledger',
		...orchestratorAgentOptions(run, config),
		system: LEDGER_SYSTEM_PROMPT,
		user: ledgerUserPrompt(sources),
		maxTurns: 1,
		deadlineAt: run.investigationDeadline,
		finalExample: LEDGER_FINAL_EXAMPLE,
		parse: (raw) => {
			const parsed = ledgerReplySchema.safeParse(raw);

			return parsed.success ? parsed.data : null;
		},
		onLog: (message) => run.events?.onLog?.(message)
	});

	if (result.error) run.events?.onLog?.(`Rule ledger: ${result.error}`);

	return result.value;
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
 * ledger and only the first one spends a model call. Null when there are no
 * sources, no rules, or the call could not run.
 */
export async function buildRuleLedger(run: ReviewRun): Promise<RuleLedger | null> {
	const sources = await readLedgerSources(run.input.revision, run.controller.signal);

	if (!sources.length) return null;

	const sourcesHash = hashSources(sources);
	const cached = cachedLedger(sourcesHash);

	if (cached) return cached.rules.length ? withSourceRevisions(cached, sources) : null;
	if (!run.budget.canSpend(1)) return null;

	const reply = await distill(run, sources);

	if (!reply) return null;

	const ledger = toLedger(reply, sources, sourcesHash);

	writeCache(CACHE_NAMESPACE, sourcesHash, ledger);

	return ledger.rules.length ? ledger : null;
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
