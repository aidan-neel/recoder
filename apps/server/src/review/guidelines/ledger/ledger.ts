import { configForOrchestrator } from '../../../models/models.js';
import { readCache, writeCache } from '../../../util/json-cache.js';
import { runJsonAgent } from '../../pipeline/agent-loop.js';
import { orchestratorAgentOptions, type ReviewRun } from '../../pipeline/harness/context.js';
import { matchesGlob } from '../../chat/directive.js';
import { LEDGER_FINAL_EXAMPLE, LEDGER_SYSTEM_PROMPT, ledgerUserPrompt } from './prompt.js';
import { hashSources, readLedgerSources, type LedgerSource } from './sources.js';
import type { RepoRule, RuleLedger } from './types.js';
import { ledgerReplySchema, toLedger, type LedgerReply } from './validate.js';

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

	if (cached) return cached.rules.length ? cached : null;
	if (!run.budget.canSpend(1)) return null;

	const reply = await distill(run, sources);

	if (!reply) return null;

	const ledger = toLedger(reply, sources, sourcesHash);

	writeCache(CACHE_NAMESPACE, sourcesHash, ledger);

	return ledger.rules.length ? ledger : null;
}

function appliesToAny(rule: RepoRule, paths: string[]): boolean {
	const glob = rule.appliesTo;

	return !glob || paths.some((path) => matchesGlob(path, glob));
}

/** Where a rule is stated: `AGENTS.md:41`, or just the path when no line is cited. */
export function ruleCitation(rule: RepoRule): string {
	return rule.source.line ? `${rule.source.path}:${rule.source.line}` : rule.source.path;
}

/**
 * The rules a reviewer of `paths` checks by reading, one `R3: text (AGENTS.md:41)`
 * line each. Mechanical rules are left out: the rule-check detector runs them.
 * Empty when none apply.
 */
export function ledgerBlock(ledger: RuleLedger | null, paths: string[]): string {
	if (!ledger) return '';

	return ledger.rules
		.filter((rule) => !rule.check && appliesToAny(rule, paths))
		.map((rule) => `${rule.id}: ${rule.text} (${ruleCitation(rule)})`)
		.join('\n');
}
