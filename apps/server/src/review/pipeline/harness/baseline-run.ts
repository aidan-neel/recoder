import type { EvidenceStore } from '../../../evidence/evidence.js';
import type { ToolCallReport, ToolResult } from '../../../evidence/types.js';
import { withSandboxTier } from '../../../sandbox/host-load.js';
import type { CheckInputs, ExecWorkspace } from '../../../sandbox/exec-workspace.js';
import type { SetupReport } from '../../../sandbox/workspace-setup.js';
import { REVIEW_POLICY } from '../../session/review-policy.js';
import { baselineCacheEnabled, readCachedCheck, writeCachedCheck } from './baseline-cache.js';
import { installCommand } from './baseline-checks.js';
import type { BaselineResult, HarnessEvents, TaskFn } from './types.js';

/** What the baseline checks run with and report to. */
export interface BaselineHost {
	evidence: EvidenceStore;
	workspace: ExecWorkspace | null;
	/** The install report, which says what the checks were run with. */
	report: SetupReport | null;
	signal: AbortSignal;
	events?: HarnessEvents;
	task?: TaskFn;
	/** False runs every check again, whatever an earlier review stored. */
	cache?: boolean;
}

/** A run's whole output from its evidence record; the result handed back is cut to one turn's budget. */
function fullOutput(evidence: EvidenceStore, result: ToolResult): string {
	return (result.evidenceId && evidence.get(result.evidenceId)?.content) || result.content;
}

/** What a result is stored under, or null when the cache is off or the checks cannot be told to repeat. */
async function cacheInputs(host: BaselineHost): Promise<CheckInputs | null> {
	const command = installCommand(host.report);

	if (!host.workspace || !command || host.cache === false || !baselineCacheEnabled()) return null;

	return host.workspace.checkInputs(command).catch(() => null);
}

/**
 * The baseline checks, run at once on the PR head; every reviewer that starts
 * after them sees the results. Each is bounded on its own, so a slow suite
 * can't hold up the detectors and verifiers. A check an earlier review already
 * ran on this commit with the same inputs is not run again.
 */
export async function runBaselineChecks(commands: string[], host: BaselineHost): Promise<BaselineResult[]> {
	if (!commands.length) return [];

	host.task?.('checks', 'Run checks', 'running', `Running ${commands.join(', ')}`, { kind: 'checks' });

	const inputs = await cacheInputs(host);
	const settled = await Promise.all(commands.map((command) => runCheck(command, host, inputs)));
	const results = settled.filter((result) => result !== null);
	const failed = results.filter((result) => result.exitCode !== 0).length;
	const cached = results.filter((result) => result.cached).length;
	const reused = cached ? `, ${cached} from an earlier review` : '';

	host.task?.(
		'checks',
		'Run checks',
		failed ? 'partial' : 'done',
		failed
			? `${failed} of ${results.length} checks failed on the PR head${reused}`
			: `${results.length} check${results.length === 1 ? '' : 's'} passed${reused}`,
		{ kind: 'checks' }
	);

	return results;
}

/** One baseline check in a prep slot, cut short at `baselineCheckTimeoutMs`; null when it did not run. */
async function runCheck(
	command: string,
	host: BaselineHost,
	inputs: CheckInputs | null
): Promise<BaselineResult | null> {
	const { evidence, signal } = host;

	if (signal.aborted) return null;

	const onTool = (tool: ToolCallReport) => host.events?.onTool?.({ ...tool, role: 'orchestrator' });

	const stored = inputs ? await readCachedCheck(inputs, command) : null;

	if (stored) {
		const replayed = evidence.replayRun(command, stored, onTool);

		return {
			command,
			evidenceId: replayed.evidenceId,
			exitCode: stored.exitCode,
			output: stored.content,
			cached: true
		};
	}

	const [result] = await withSandboxTier('prep', () =>
		evidence.executeRound(
			[{ action: 'run', command, timeoutSec: Math.floor(REVIEW_POLICY.baselineCheckTimeoutMs / 1000) }],
			signal,
			onTool
		)
	);

	if (!result) return null;

	const output = fullOutput(evidence, result);

	if (inputs && !signal.aborted) await storeFinished(inputs, command, evidence, result, output);

	return { command, evidenceId: result.evidenceId, exitCode: result.exitCode ?? null, output, error: result.error };
}

/**
 * Stores a run that finished by itself and kept all of its output. A failing
 * run counts like a passing one; one that was killed, timed out or hit the
 * output bound says nothing about the code, so it is not stored. A failure to
 * store costs nothing but the next hit.
 */
async function storeFinished(
	inputs: CheckInputs,
	command: string,
	evidence: EvidenceStore,
	result: ToolResult,
	output: string
): Promise<void> {
	const record = result.evidenceId ? evidence.get(result.evidenceId) : undefined;

	if (!result.ok || typeof result.exitCode !== 'number' || !record || record.truncated) return;

	await writeCachedCheck(inputs, command, {
		exitCode: result.exitCode,
		content: output,
		elapsedMs: result.elapsedMs ?? 0
	}).catch(() => undefined);
}
