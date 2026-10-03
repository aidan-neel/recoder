import type { ReviewReasoningEntry } from '@recoder/shared';
import type { EvidenceStore, ToolCallReport } from '../../../evidence/evidence.js';
import type { ModelConfig } from '../../../models/models.js';
import type { ModelBudget } from './budget.js';

export interface JsonAgentOptions<T> {
	label: string;
	/** Names this agent's scratch files and runs; one is made up when absent. */
	agentId?: string;
	system: string;
	user: string;
	config: ModelConfig;
	budget: ModelBudget;
	evidence: EvidenceStore;
	maxTurns: number;
	signal: AbortSignal;
	deadlineAt: number;
	consumeReserve?: boolean;
	parse: (raw: unknown) => T | null;
	validationError?: (raw: unknown) => string;
	/**
	 * A valid final answer that looks premature (it announces more work, or
	 * concludes without reading anything) gets sent back once with this nudge.
	 * `retrievals` counts evidence rounds this agent has run.
	 */
	checkFinal?: (value: T, state: { retrievals: number; runs: number }) => string | null;
	/**
	 * JSON schemas the reply must match: `turn` while retrieval is allowed,
	 * `final` on the last turn. Endpoints with guided decoding can then only
	 * produce a usable reply (no message-only answers, no retrieval on the final turn).
	 */
	responseSchema?: (finalTurn: boolean) => { name: string; schema: Record<string, unknown> };
	/**
	 * This agent's own time limit, on the review clock. Past `finalTurnAfterMs`
	 * the next turn is the final one, so it answers with what it has instead of
	 * running into `maxWallMs`, where it stops without an answer.
	 */
	timeLimit?: { finalTurnAfterMs: number; maxWallMs: number };
	/** A minimal valid final answer, quoted back when the model gets the shape wrong. */
	finalExample?: string;
	/** Action request examples quoted back on a malformed reply; defaults to read-only retrieval. */
	actionExamples?: string;
	onProgress?: (state: 'queued' | 'running' | 'retrieval', elapsedMs: number, detail: string) => void;
	onLog?: (message: string) => void;
	/** Accumulated provider reasoning for a turn, upserted by `id`. */
	onReasoning?: (reasoning: Pick<ReviewReasoningEntry, 'id' | 'text' | 'status' | 'summary'>) => void;
	onTool?: (tool: ToolCallReport) => void;
	onMessage?: (message: { id: string; text: string; status: 'streaming' | 'done' | 'error'; cutOff?: string }) => void;
	getDiscussion?: () => string;
}
