import {
	agentCli,
	prettyModelName,
	type ReviewMetrics,
	type TokenAggregate,
	type TokenBudget,
	type TokenStage,
	type TokenUsage
} from '@recoder/shared';
import { formatCompact, formatShare, type BarSegment } from '@recoder/ui';

import { plural } from '../shell/format';
import { formatWhole, rankColor } from '../usage/report-shared';

export type TokenUsageKind = 'review' | 'chat';

interface TokenModelRow {
	id: string;
	model: string;
	provider: string;
	providerName: string;
	color: string;
	tokens: string;
	share: number | null;
	shareLabel: string | null;
	detail: string;
}

interface TokenBreakdownRow {
	id: string;
	label: string;
	tokens: string;
	share: string | null;
	calls: string;
}

export interface TokenUsageSummary {
	totalTokens: number | null;
	totalLabel: string;
	callsLabel: string;
	budgetLabel: string | null;
	segments: BarSegment[];
	models: TokenModelRow[];
	breakdown: TokenBreakdownRow[];
	notes: string[];
}

const STAGE_LABELS: Record<TokenStage, string> = {
	reviewer: 'Reviewer',
	subagent: 'Subagent',
	'second-look': 'Second look',
	investigator: 'Investigator',
	worker: 'Worker',
	verifier: 'Verifier',
	repair: 'Repair',
	intent: 'Intent',
	ledger: 'Ledger',
	other: 'Other'
};

const BUDGET_LABELS: Record<TokenBudget, string> = {
	low: 'Low budget',
	medium: 'Medium budget',
	high: 'High budget'
};

/** Total tokens of an aggregate, falling back to input + output when both were reported. */
function knownTokens(usage: TokenUsage): number | null {
	if (usage.totalTokens !== null) return usage.totalTokens;

	if (usage.inputTokens !== null || usage.outputTokens !== null) {
		return (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
	}

	return null;
}

/** "5 calls", with running and failed counts appended when present. */
function formatCallSummary(aggregate: Pick<TokenAggregate, 'calls' | 'pendingCalls' | 'failedCalls'>): string {
	const parts = [plural(aggregate.calls, 'call')];

	if (aggregate.pendingCalls > 0) parts.push(`${aggregate.pendingCalls} running`);
	if (aggregate.failedCalls > 0) parts.push(`${aggregate.failedCalls} failed`);

	return parts.join(' · ');
}

/** Compact detail facts for one model row: input, output, reasoning, cached reads and call count. */
function formatModelDetail(aggregate: TokenAggregate): string {
	const { usage } = aggregate;
	const parts: string[] = [];

	if (usage.inputTokens !== null) parts.push(`${formatCompact(usage.inputTokens)} in`);
	if (usage.outputTokens !== null) parts.push(`${formatCompact(usage.outputTokens)} out`);

	if (usage.reasoningOutputTokens !== null && usage.reasoningOutputTokens > 0) {
		parts.push(`${formatCompact(usage.reasoningOutputTokens)} reasoning`);
	}

	if (usage.cachedInputTokens !== null && usage.cachedInputTokens > 0) {
		parts.push(`${formatCompact(usage.cachedInputTokens)} cached`);
	}

	parts.push(formatCallSummary(aggregate));

	return parts.join(' · ');
}

/** Stacked bar segments for uncached input, cache reads, cache writes and output. */
function buildSegments(usage: TokenUsage): BarSegment[] {
	if (usage.inputTokens === null && usage.outputTokens === null) return [];

	const input = usage.inputTokens ?? 0;
	const cacheRead = usage.cachedInputTokens ?? 0;
	const cacheWrite = usage.cacheWriteInputTokens ?? 0;
	const output = usage.outputTokens ?? 0;
	const uncached = Math.max(0, input - cacheRead - cacheWrite);

	return [
		{ id: 'input', label: 'Input', value: uncached, color: 'var(--text-subtle)' },
		{ id: 'cache-read', label: 'Cache read', value: cacheRead, color: 'var(--text-ghost)' },
		{ id: 'cache-write', label: 'Cache write', value: cacheWrite, color: 'var(--text-tertiary)' },
		{ id: 'output', label: 'Output', value: output, color: 'var(--text-primary)' }
	];
}

/** One row in the work breakdown table for a review stage or non-pipeline scope. */
function toBreakdownRow(id: string, label: string, aggregate: TokenAggregate, total: number | null): TokenBreakdownRow {
	const tokens = knownTokens(aggregate.usage);
	const share = tokens !== null && total !== null && total > 0 ? formatShare(tokens / total) : null;

	return {
		id,
		label,
		tokens: tokens === null ? '—' : formatWhole(tokens),
		share,
		calls: formatCallSummary(aggregate)
	};
}

/** Exhaustive work breakdown for a review: pipeline stages (or the pipeline scope) plus follow-ups and fixes. */
function buildReviewBreakdown(metrics: ReviewMetrics, total: number | null): TokenBreakdownRow[] {
	const rows: TokenBreakdownRow[] = [];
	const pipeline = metrics.scopes.find((entry) => entry.scope === 'pipeline');
	const discussion = metrics.scopes.find((entry) => entry.scope === 'discussion');
	const fix = metrics.scopes.find((entry) => entry.scope === 'fix');

	if (metrics.stages.length > 0) {
		const sortedStages = [...metrics.stages].sort(
			(left, right) => (knownTokens(right.usage) ?? -1) - (knownTokens(left.usage) ?? -1) || right.calls - left.calls
		);

		for (const entry of sortedStages) {
			rows.push(toBreakdownRow(`stage:${entry.stage}`, STAGE_LABELS[entry.stage], entry, total));
		}
	} else if (pipeline && pipeline.calls > 0) {
		rows.push(toBreakdownRow('scope:pipeline', 'Review', pipeline, total));
	}

	if (discussion && discussion.calls > 0) {
		rows.push(toBreakdownRow('scope:discussion', 'Follow-ups', discussion, total));
	}

	if (fix && fix.calls > 0) {
		rows.push(toBreakdownRow('scope:fix', 'Fixes', fix, total));
	}

	return rows.length > 1 || metrics.stages.length > 0 ? rows : [];
}

/** Quiet footnotes explaining missing history or partial token reporting. */
function buildNotes(metrics: ReviewMetrics, kind: TokenUsageKind): string[] {
	const notes: string[] = [];

	if (kind === 'review' && !metrics.pipelineTracked) {
		notes.push('Recording started with a follow-up, so the original review isn’t counted.');
	}

	const reported = metrics.total.reportedCalls.totalTokens;
	const calls = metrics.total.calls;

	if (calls > 0 && reported === 0) {
		notes.push('This model adapter did not report token counts for its calls.');
	} else if (calls > 0 && reported < calls) {
		notes.push(`Token counts were reported for ${reported} of ${calls} calls.`);
	}

	return notes;
}

/** Turns server `ReviewMetrics` into the display summary for a review or chat modal; null when empty. */
export function summarizeTokenUsage(metrics: ReviewMetrics | null, kind: TokenUsageKind): TokenUsageSummary | null {
	if (!metrics || metrics.total.calls === 0) return null;

	const totalTokens = knownTokens(metrics.total.usage);

	const sortedModels = [...metrics.models].sort(
		(left, right) => (knownTokens(right.usage) ?? -1) - (knownTokens(left.usage) ?? -1) || right.calls - left.calls
	);

	const models: TokenModelRow[] = sortedModels.map((entry, index) => {
		const tokens = knownTokens(entry.usage);
		const share = tokens !== null && totalTokens !== null && totalTokens > 0 ? tokens / totalTokens : null;

		return {
			id: `${entry.provider}:${entry.model}`,
			model: prettyModelName(entry.model),
			provider: entry.provider,
			providerName: agentCli(entry.provider)?.name ?? 'Endpoint',
			color: rankColor(index, sortedModels.length),
			tokens: tokens === null ? '—' : formatWhole(tokens),
			share,
			shareLabel: share !== null && sortedModels.length > 1 ? formatShare(share) : null,
			detail: formatModelDetail(entry)
		};
	});

	return {
		totalTokens,
		totalLabel: totalTokens === null ? '—' : formatWhole(totalTokens),
		callsLabel: formatCallSummary(metrics.total),
		budgetLabel: kind === 'review' && metrics.tokenBudget ? BUDGET_LABELS[metrics.tokenBudget] : null,
		segments: buildSegments(metrics.total.usage),
		models,
		breakdown: kind === 'review' ? buildReviewBreakdown(metrics, totalTokens) : [],
		notes: buildNotes(metrics, kind)
	};
}
