import type { ReviewInventory } from '../review/pipeline/inventory.js';
import { REVIEW_POLICY } from '../review/session/review-policy.js';
import type { ExecWorkspace } from '../sandbox/exec-workspace.js';
import { actionCommand, finishedReport, reportedInput } from './format.js';
import { normalizeActions } from './parse-actions.js';
import { existingFiles, retrieve } from './retrieval.js';
import { runCommand, writeSandboxFile } from './sandbox-actions.js';
import {
	failure,
	type EvidenceRecord,
	type EvidenceSnapshot,
	type RetrievalAction,
	type ReviewRevision,
	type RevisionAlias,
	type ToolCallReport,
	type ToolResult
} from './types.js';

/** Calls the dashboard observer; observers cannot break retrieval, so their errors are swallowed. */
function notify(onTool: ((tool: ToolCallReport) => void) | undefined, tool: ToolCallReport): void {
	try {
		onTool?.(tool);
	} catch {}
}

/**
 * Cuts a result to what is left of the round budget, so the dashboard reports the same bounded
 * evidence the agent receives. The cut may land inside the last hunk, so that hunk is not claimed as shown.
 */
function fitRoundBudget(result: ToolResult, used: number): ToolResult {
	if (used + result.content.length <= REVIEW_POLICY.maxToolRoundChars) return result;

	const room = Math.max(0, REVIEW_POLICY.maxToolRoundChars - used);

	return {
		...result,
		content: result.content.slice(0, room),
		hunkIds: room === 0 ? [] : result.hunkIds?.slice(0, -1),
		truncated: true,
		continuation: result.continuation ?? 'round-budget'
	};
}

function sameRecord(a: Omit<EvidenceRecord, 'id'>, b: Omit<EvidenceRecord, 'id'>): boolean {
	return (
		a.revision === b.revision &&
		a.path === b.path &&
		a.startLine === b.startLine &&
		a.endLine === b.endLine &&
		a.content === b.content &&
		a.agentId === b.agentId
	);
}

/** Every piece of evidence a review's agents retrieved, with stable ids that findings can cite. */
export class EvidenceStore {
	readonly records = new Map<string, EvidenceRecord>();
	private readonly cache = new Map<string, ToolResult>();
	private seq = 0;
	private toolSeq = 0;

	/** Where `run` and `writeFile` execute; null keeps the review read-only. */
	exec: ExecWorkspace | null = null;

	/** Why `exec` is null, shown to agents that ask to run something. */
	execUnavailable = 'Running code is unavailable in this review.';

	constructor(
		readonly revision: ReviewRevision | null,
		readonly inventory: ReviewInventory,
		readonly maxFileChars: number
	) {}

	/** The records a checkpoint needs, plus the id counters so restored and new ids never collide. */
	snapshot(ids: Iterable<string>): EvidenceSnapshot {
		const records = [...new Set(ids)].flatMap((id) => {
			const record = this.records.get(id);

			return record ? [{ ...record }] : [];
		});

		return { records, seq: this.seq, toolSeq: this.toolSeq };
	}

	restore(snapshot: EvidenceSnapshot): void {
		for (const record of snapshot.records) this.records.set(record.id, { ...record });

		this.seq = Math.max(this.seq, snapshot.seq);
		this.toolSeq = Math.max(this.toolSeq, snapshot.toolSeq);
	}

	providedIds(): Set<string> {
		return new Set(this.records.keys());
	}

	get(id: string): EvidenceRecord | undefined {
		return this.records.get(id);
	}

	/** Discover optional regular files before issuing observable read requests. */
	existingFiles(revision: RevisionAlias, paths: readonly string[], signal?: AbortSignal): Promise<string[]> {
		return existingFiles(this, revision, paths, signal);
	}

	/**
	 * Runs up to `maxActions` retrievals whose combined content stays within one
	 * round's character budget. `owner` names the agent, so its runs see only
	 * the scratch files it wrote. `spent` is what the round already used, when
	 * its actions arrive one call at a time.
	 */
	async executeRound(
		rawActions: unknown,
		signal?: AbortSignal,
		onTool?: (tool: ToolCallReport) => void,
		maxActions: number = REVIEW_POLICY.maxRetrievalsPerTurn,
		owner?: string,
		spent = 0
	): Promise<ToolResult[]> {
		const actions = normalizeActions(rawActions).slice(0, maxActions);
		const results: ToolResult[] = [];
		let used = spent;
		let runs = 0;

		for (const action of actions) {
			if (signal?.aborted) {
				results.push(failure(action.action, 'review aborted'));
				continue;
			}

			if (action.action === 'run' && ++runs > REVIEW_POLICY.maxRunsPerTurn) {
				results.push(
					failure('run', `at most ${REVIEW_POLICY.maxRunsPerTurn} run actions per turn; request it next turn`)
				);

				continue;
			}

			const result = await this.executeReported(action, used, signal, onTool, owner);

			results.push(result);
			used += result.content.length;
		}

		return results;
	}

	/** Runs one action between a `running` and a finished dashboard report of its budget-bounded result. */
	private async executeReported(
		action: RetrievalAction,
		used: number,
		signal: AbortSignal | undefined,
		onTool: ((tool: ToolCallReport) => void) | undefined,
		owner: string | undefined
	): Promise<ToolResult> {
		const startedMs = Date.now();

		const started = {
			id: `tool_${++this.toolSeq}`,
			command: actionCommand(action),
			input: reportedInput(action),
			startedAt: new Date(startedMs).toISOString()
		};

		notify(onTool, { ...started, status: 'running', exitCode: null });

		let result: ToolResult;

		try {
			result = await this.executeOne(action, signal, owner);
		} catch (error) {
			notify(onTool, {
				...started,
				status: 'error',
				exitCode: null,
				finishedAt: new Date().toISOString(),
				elapsedMs: Date.now() - startedMs,
				summary: error instanceof Error ? error.message : 'Retrieval failed'
			});

			throw error;
		}

		const bounded = fitRoundBudget(result, used);

		notify(onTool, finishedReport(started, startedMs, bounded));

		return bounded;
	}

	/** Runs and writes change state, so they are never served from the cache. */
	private async executeOne(action: RetrievalAction, signal?: AbortSignal, owner?: string): Promise<ToolResult> {
		if (action.action === 'run') {
			const { result, record } = await runCommand(this, action, signal, owner);

			if (record) result.evidenceId = this.remember(record).id;

			return result;
		}

		if (action.action === 'writeFile') return writeSandboxFile(this, action, signal, owner);

		const cacheKey = JSON.stringify(action);
		const cached = this.cache.get(cacheKey);

		if (cached) return cached;

		const result = await retrieve(this, action, signal);

		if (result.ok && result.content) {
			const stored = this.remember({
				revision: result.revision ?? 'head',
				path: result.path ?? '',
				startLine: result.startLine ?? 1,
				endLine: result.endLine ?? result.startLine ?? 1,
				content: result.content,
				truncated: result.truncated
			});

			result.evidenceId = stored.id;
		}

		this.cache.set(cacheKey, result);

		return result;
	}

	/** Stores a record, reusing the existing id when the same content was already retrieved. */
	private remember(record: Omit<EvidenceRecord, 'id'>): EvidenceRecord {
		for (const existing of this.records.values()) {
			if (sameRecord(existing, record)) return existing;
		}

		const stored: EvidenceRecord = { ...record, id: `ev_${++this.seq}` };

		this.records.set(stored.id, stored);

		return stored;
	}
}
