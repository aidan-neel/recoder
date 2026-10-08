import type { ReviewChatMessage, ReviewReasoningEntry } from '@recoder/shared';
import type { EvidenceStore, ToolCallReport } from '../../../evidence/evidence.js';
import type { RetrievalAction, ToolResult } from '../../../evidence/types.js';
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
	/** Turns at the end of `maxTurns` on which tools are refused, so the agent answers instead of running out; 1 when absent. */
	answerTurns?: number;
	signal: AbortSignal;
	deadlineAt: number;
	consumeReserve?: boolean;
	parse: (raw: unknown) => T | null;
	validationError?: (raw: unknown) => string;
	/** What can be kept of an answer that still fails `parse` once no repair turn is left. */
	salvage?: (raw: unknown) => T | null;
	/**
	 * A valid final answer that looks premature (it announces more work, or
	 * concludes without reading anything) gets sent back with this nudge. Each
	 * distinct nudge is sent once.
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
	/** The agent may run commands and write scratch files in the sandbox, not only read. */
	exec?: boolean;
	/**
	 * Runs a `delegate` action: a worker on the specialist model does the task
	 * and its short answer comes back as the result. Absent, the agent is not
	 * offered the tool and a `delegate` request fails.
	 */
	delegate?: (action: RetrievalAction) => Promise<ToolResult>;
	onProgress?: (state: 'queued' | 'running' | 'retrieval', elapsedMs: number, detail: string) => void;
	onLog?: (message: string) => void;
	/** Accumulated provider reasoning for a turn, upserted by `id`. */
	onReasoning?: (reasoning: Pick<ReviewReasoningEntry, 'id' | 'text' | 'status' | 'summary' | 'outputRate'>) => void;
	onTool?: (tool: ToolCallReport) => void;
	onMessage?: (message: Pick<ReviewChatMessage, 'id' | 'text' | 'status' | 'cutOff' | 'outputRate'>) => void;
	getDiscussion?: () => string;
}
