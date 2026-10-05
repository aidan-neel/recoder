import {
	ORCHESTRATOR_ID,
	type CoverageGap,
	type CoverageSummary,
	type ModelFailure,
	type ReviewAssignment,
	type ReviewChatMessage,
	type ReviewCodeContext,
	type ReviewGuidelinesUsed,
	type ReviewReasoningEntry,
	type ReviewTask,
	type ReviewToolCall
} from '@recoder/shared';
import { formatAgentName } from '$lib/findings/threads.svelte';
import { guidelinesStore } from '$lib/settings/guidelines.svelte';
import { modelLabel } from '$lib/settings/model-settings.svelte';
import { groupAgents } from './agent-groups';
import { STAGE } from './review-progress-state';

export interface ReviewingFinding {
	id: string;
	agent: string | null;
	severity: 'high' | 'medium' | 'low';
	title: string;
	location: string | null;
	file?: string;
	line?: number | null;
	confirmed?: boolean;
}

export interface ReviewingMeta {
	prLabel: string;
	/** The pull request on its host; the PR number links to it. */
	prUrl?: string | null;
	repo: string;
	files: number | null;
	additions: number | null;
	deletions: number | null;
	elapsed: string;
	branch?: string | null;
}

/** Props for the review conversation page and the diff drawer's Ask reviewer panel. */
export interface ReviewingViewProps {
	reviewId?: string;
	title: string;
	meta: ReviewingMeta;
	assignments?: ReviewAssignment[];
	messages?: ReviewChatMessage[];
	orchestratorModel?: string;
	reasoning?: ReviewReasoningEntry[];
	toolCalls?: ReviewToolCall[];
	active?: boolean;
	awaitingPrompt?: boolean;
	completedAt?: string;
	failed?: boolean;
	errorMessage?: string | null;
	/** Why a failed review stopped, when a model call caused it. */
	failure?: ModelFailure | null;
	onStartReview?: (() => Promise<void>) | null;
	paused?: boolean;
	connectionLost?: boolean;
	onOpenDiff: (() => void) | null;
	/** Switch to the Findings or Diff workspace. Falls back to `onOpenDiff`. */
	onShowView?: ((view: 'findings' | 'diff') => void | Promise<void>) | null;
	onOpenFinding?: ((finding: ReviewingFinding) => void) | null;
	onRestart: (() => void) | null;
	/** Continue a failed review from where it stopped. */
	onContinue?: (() => Promise<void>) | null;
	onSend?: (assignmentId: string, text: string, codeContext?: ReviewCodeContext) => Promise<void>;
	onStop?: (assignmentId: string) => Promise<void>;
	restarting?: boolean;
	now?: number;
	fullscreen?: boolean;
	/**
	 * The same conversation inside the diff page's Ask reviewer drawer: no
	 * session header or results rail, reviewers open in place.
	 */
	embedded?: boolean;
	/** Orchestrator composer text and attached code (the drawer shares them with the diff). */
	draft?: string;
	codeContext?: ReviewCodeContext | null;
	/** Bumped to focus the composer. */
	focusKey?: number;
	findings: ReviewingFinding[];
	tasks?: ReviewTask[];
	stage?: number;
	stageLabel?: string;
	stageDetail?: string;
	connectionLabel?: string;
	pendingCount?: number;
	coverage?: CoverageSummary | null;
	coverageGaps?: CoverageGap[];
	/** Pipeline events (oldest first), shown while the review runs. */
	activity?: { message: string; agent?: string }[];
	/** Show the pull request's CI checks in the session bar. */
	showChecks?: boolean;
	/** The tracked repo, for its review guidelines. */
	repoId?: string | null;
	/** Owner guidelines this review ran with. */
	guidelines?: ReviewGuidelinesUsed | null;
	doneHref?: string | null;
}

/** One finalization fact, laid out in the tool-row grid (label · value · meta). */
export interface FinalFact {
	label: string;
	value: string;
	meta?: string;
	mono?: boolean;
	open?: () => void;
}

/** Link props that open a conversation: a URL on the page, a click handler in the drawer. */
export type OpenProps = (assignmentId: string) => { href?: string; onclick?: () => void };

const LIVE_STATUSES: ReviewTask['status'][] = ['running', 'waiting', 'queued'];

/** Whether a task or reviewer is still running or waiting its turn. */
export function isLive(status: ReviewTask['status'] | ReviewAssignment['status']): boolean {
	return (LIVE_STATUSES as string[]).includes(status);
}

/** URL-backed chats support browser history, reloads, and opening in a new tab. */
export function conversationHref(current: URL, assignmentId: string): string {
	const url = new URL(current);

	if (assignmentId === ORCHESTRATOR_ID) url.searchParams.delete('agent');
	else url.searchParams.set('agent', assignmentId);

	return `${url.pathname}${url.search}${url.hash}`;
}

/** The status chip for a reviewer; one still "running" after the review stopped failed. */
export function statusFor(assignment: ReviewAssignment, active: boolean): { label: string; tone: string } {
	switch (assignment.status) {
		case 'running':
			return active ? { label: 'Reviewing', tone: 'running' } : { label: 'Failed', tone: 'danger' };
		case 'waiting':
			return { label: 'Waiting', tone: 'idle' };
		case 'queued':
			return { label: 'Queued', tone: 'idle' };
		case 'done':
			return { label: 'Finished', tone: 'success' };
		case 'error':
			return { label: 'Failed', tone: 'danger' };
		case 'skipped':
			return { label: 'Skipped', tone: 'idle' };
	}
}

/** "4/6" progress for a step of agents; failed and skipped agents are not "done". */
export interface AgentCounts {
	done: number;
	failed: number;
	total: number;
}

/** A failed agent whose work moved to a `retry-` agent, so the retry stands in for it. */
function superseded(item: ReviewAssignment, agents: ReviewAssignment[]): boolean {
	return (
		item.status === 'error' && agents.some((other) => other.id !== item.id && other.id.startsWith(`retry-${item.id}`))
	);
}

/** Units and subagents that ended without a result, a retried one counted by its retry (the server's summary counts the same way). */
function countFailedAgents(agents: ReviewAssignment[]): number {
	return agents.filter((item) => item.status === 'error' && !superseded(item, agents)).length;
}

/** Done, failed and total for one step of agents, each retried agent counted once. */
export function agentCounts(agents: ReviewAssignment[]): AgentCounts {
	const counted = agents.filter((item) => !superseded(item, agents));

	return {
		done: counted.filter((item) => item.status === 'done').length,
		failed: countFailedAgents(agents),
		total: counted.length
	};
}

/** "correctness and performance", "security, docs and 2 more". */
function nameList(items: ReviewAssignment[]): string {
	const names = groupAgents(items).map(
		(group) => `${formatAgentName(group.role).toLowerCase()}${group.items.length > 1 ? ` ×${group.items.length}` : ''}`
	);

	if (names.length <= 1) return names[0] ?? '';
	if (names.length <= 3) return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

	return `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;
}

const VERIFY_STATE: Partial<Record<ReviewTask['status'], string>> = {
	running: 'Checking',
	waiting: 'Queued',
	queued: 'Queued',
	done: 'Done',
	partial: 'Unproven',
	error: 'Failed'
};

/** One verification task as a fact row: its state, the finding it checks, and its message and time. */
export function verifyRow(task: ReviewTask, now: number): { state: string; title: string; meta: string } {
	const live = task.status === 'running' || task.status === 'waiting';
	const ms = live && task.startedAt ? now - Date.parse(task.startedAt) : task.elapsedMs;
	const time = ms !== undefined ? `${Math.max(0, Math.round(ms / 1000))}s` : '';

	return {
		state: VERIFY_STATE[task.status] ?? 'Checking',
		title: task.label.replace(/^Verify: /, ''),
		meta: [task.message, time].filter(Boolean).join(' · ')
	};
}

/** Finalization at a glance: candidates, confirmed findings, coverage, guidelines and the model. */
export function finalFacts(input: {
	agents: ReviewAssignment[];
	finished: boolean;
	findingCount: number;
	coverage: CoverageSummary | null;
	guidelines: ReviewGuidelinesUsed | null;
	repoId: string | null;
	finalization: ReviewTask | undefined;
}): FinalFact[] {
	const { agents, finished, findingCount, coverage, guidelines, repoId, finalization } = input;
	const facts: FinalFact[] = [];
	const candidateCount = agents.reduce((sum, item) => sum + (item.candidateCount ?? 0), 0);

	if (candidateCount)
		facts.push({ label: 'Candidates', value: `${candidateCount} ${candidateCount === 1 ? 'finding' : 'findings'}` });
	if (finished)
		facts.push({ label: 'Confirmed', value: `${findingCount} ${findingCount === 1 ? 'finding' : 'findings'}` });
	if (coverage)
		facts.push({
			label: 'Coverage',
			value: `${coverage.reviewed} of ${coverage.total} changes${coverage.partial ? ` · ${coverage.partial} partial` : ''}`
		});

	if (guidelines?.layers.length) {
		const hasRepoLayer = guidelines.layers.some((layer) => layer.source === 'repo');

		const value = guidelines.layers
			.map((layer) =>
				layer.source === 'global'
					? 'Global'
					: `${layer.path}${layer.ref ? ` @ ${layer.ref}` : ''}${layer.sha ? ` ${layer.sha.slice(0, 7)}` : ''}`
			)
			.join(' + ');

		const target = hasRepoLayer && repoId ? { kind: 'repo' as const, repoId } : { kind: 'global' as const };

		facts.push({ label: 'Guidelines', value, open: () => guidelinesStore.open(target) });
	}

	if (finalization?.model)
		facts.push({
			label: 'Model',
			value: modelLabel(finalization.model),
			mono: false,
			meta: finalization.elapsedMs !== undefined ? `${(finalization.elapsedMs / 1000).toFixed(1)}s` : undefined
		});

	return facts;
}

/**
 * Before the reviewer stage, name the stage (installing, running checks), not the reviewers waiting for it.
 * Units are the main thread's own work, so they read as "Reviewing"; only subagents are waited on.
 */
export function footerLabel(input: {
	paused: boolean;
	stage: number;
	stageLabel: string;
	stageDetail?: string;
	verifying: boolean;
	verifications: ReviewTask[];
	working: ReviewAssignment[];
	running: ReviewAssignment[];
	units: AgentCounts;
}): string {
	const { paused, stage, stageLabel, stageDetail, verifying, verifications, working, running, units } = input;

	if (paused) return 'Paused';
	if (stage < STAGE.reviewing) return [stageLabel, stageDetail].filter(Boolean).join(' · ');

	if (verifying) {
		const verified = verifications.filter((task) => !isLive(task.status)).length;

		return `Verifying findings${verifications.length ? ` · ${verified}/${verifications.length}` : ''}`;
	}

	if (working.some((item) => item.role === 'reviewer'))
		return units.total > 1 ? `Reviewing · ${units.done} of ${units.total} units` : 'Reviewing';

	if (working.length) return `Waiting on ${nameList(working)}`;
	if (running.length) return `${running.length} ${running.length === 1 ? 'agent' : 'agents'} queued`;

	return stageLabel;
}
