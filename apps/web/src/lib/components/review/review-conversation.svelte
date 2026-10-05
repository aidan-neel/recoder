<script lang="ts">
	import {
		ORCHESTRATOR_ID,
		type ReviewAssignment,
		type ReviewChatMessage,
		type ReviewCodeContext,
		type ReviewReasoningEntry,
		type ReviewTask,
		type ReviewToolCall
	} from '@recoder/shared';
	import type { ComponentProps, Snippet } from 'svelte';
	import * as Conversation from '@sivir-ui/svelte/components/conversation';
	import Skeleton from '../ui/skeleton.svelte';
	import ReviewMessage from './review-message.svelte';
	import ReviewTraces from './review-traces.svelte';
	import ReviewDock from './review-dock.svelte';
	import { groupTranscript } from '$lib/review/review-transcript';
	import { latestOutputRate } from '$lib/review/output-rate';
	import {
		buildRows,
		orphansByIndex,
		placeInserts,
		reasoningByMessage,
		type TranscriptInsert
	} from '$lib/review/conversation-rows';

	let {
		assignment,
		messages,
		reasoning,
		toolCalls,
		tasks,
		active,
		now,
		draft = $bindable(''),
		codeContext = $bindable(null),
		compact = false,
		focusKey,
		onSend,
		onStop,
		onStopReview = null,
		inserts = [],
		placeholder,
		awaitingPrompt = false,
		onStartReview = null,
		signInShown = false,
		intro,
		folded = [],
		resume = null
	}: {
		assignment: ReviewAssignment;
		messages: ReviewChatMessage[];
		reasoning: ReviewReasoningEntry[];
		toolCalls: ReviewToolCall[];
		tasks: ReviewTask[];
		active: boolean;
		now: number;
		draft?: string;
		codeContext?: ReviewCodeContext | null;
		compact?: boolean;
		focusKey?: number;
		onSend?: (id: string, text: string, context?: ReviewCodeContext) => Promise<void>;
		onStop?: (id: string) => Promise<void>;
		/** Stops the whole review while it runs; Send becomes Stop when nothing is typed. */
		onStopReview?: (() => Promise<void>) | null;
		/** Blocks placed in the transcript before the first entry newer than `at` (or at the end). */
		inserts?: TranscriptInsert[];
		placeholder?: string;
		awaitingPrompt?: boolean;
		/** Draft (interactive) reviews: the orchestrator offers the full review, so its latest reply carries the button. */
		onStartReview?: (() => Promise<void>) | null;
		/** A sign-in notice already shows above the transcript. */
		signInShown?: boolean;
		/** Opening card at the top of a new session; it carries Run full review while it shows. */
		intro?: Snippet;
		/** Agents whose work reads as this conversation's own: the units the main thread reviews. */
		folded?: string[];
		/** A stopped or failed review: Continue and Restart ride on the composer. */
		resume?: ComponentProps<typeof ReviewDock>['resume'];
	} = $props();

	let startingReview = $state(false);
	let clock = $state(Date.now());

	const belongs = (id?: string) => (id ?? ORCHESTRATOR_ID) === assignment.id || (!!id && folded.includes(id));
	const conversationMessages = $derived(messages.filter((message) => belongs(message.assignmentId)));
	const conversationReasoning = $derived(reasoning.filter((entry) => belongs(entry.assignmentId)));
	const outputRate = $derived(latestOutputRate(conversationMessages, conversationReasoning));
	const conversationTools = $derived(toolCalls.filter((tool) => belongs(tool.assignmentId)));
	const orchestratorView = $derived(assignment.id === ORCHESTRATOR_ID);
	const working = $derived(active && ['running', 'waiting', 'queued'].includes(assignment.status));
	const currentTask = $derived(tasks.findLast((task) => task.status === 'running' || task.status === 'waiting'));
	const entries = $derived(groupTranscript(conversationMessages, conversationTools));

	const generating = $derived(
		conversationMessages.some(
			(message) => message.discussion && !message.forwardedFrom && message.status === 'streaming'
		)
	);

	/** Only the latest sign-in failure carries the notice; earlier ones would repeat it. */
	const lastSignInIndex = $derived(
		signInShown ? -1 : entries.findLastIndex((entry) => entry.kind === 'message' && !!entry.message.failure?.signIn)
	);

	const lastUsageIndex = $derived(
		entries.findLastIndex((entry) => entry.kind === 'message' && !!entry.message.failure?.usageLimit)
	);

	const lastAssistantIndex = $derived(
		entries.findLastIndex((entry) => entry.kind === 'message' && entry.message.from === 'assistant')
	);

	const ownThoughts = $derived(reasoningByMessage(conversationReasoning));

	const orphanReasoning = $derived.by(() => {
		const messageIds = new Set(entries.flatMap((entry) => (entry.kind === 'message' ? [entry.id] : [])));

		return conversationReasoning.filter((entry) => !messageIds.has(`message_${entry.id}`));
	});

	/**
	 * What the agent says it is doing, beside its live work. Reviewers narrate tasks by title ("Running
	 * Correctness of …"), so only a status that says something new; the main thread only says what it waits on.
	 */
	const workNote = $derived.by(() => {
		if (!working || conversationReasoning.some((entry) => entry.status === 'streaming')) return null;
		if (orchestratorView) return currentTask?.status === 'waiting' && currentTask.message ? currentTask.message : null;

		const op = currentTask?.message || assignment.currentOperation || '';

		return /^Running\b/.test(op) || op === assignment.title ? null : op || null;
	});

	/** Only while a reply is actually pending and nothing (text or thinking) has streamed for it yet. */
	const thinking = $derived(
		generating &&
			!conversationMessages.some((message) => message.status === 'streaming' && message.text.trim()) &&
			!conversationReasoning.some((entry) => entry.status === 'streaming')
	);

	/** The latest reply was cut off and the agent is asking again: the composer says so until the retry's reply or tools arrive. */
	const retryNotice = $derived.by(() => {
		const last = conversationMessages.at(-1);

		if (!active || last?.status !== 'error' || !last.cutOff) return null;

		return conversationTools.some((tool) => Date.parse(tool.startedAt) > Date.parse(last.at)) ? null : last.cutOff;
	});

	const rows = $derived(
		buildRows({
			entries,
			placed: placeInserts(inserts, entries),
			orphansAt: orphansByIndex(orphanReasoning, entries),
			ownThoughts,
			pending: working && !thinking && !conversationMessages.some((message) => message.status === 'streaming')
		})
	);

	/** A thought with nothing after it keeps counting while the agent works, even between its retries. */
	const anyLive = $derived(
		thinking || working || conversationReasoning.some((entry) => entry.status === 'streaming' && (active || generating))
	);

	$effect(() => {
		if (!anyLive) return;
		clock = Date.now();

		const timer = setInterval(() => (clock = Date.now()), 100);

		return () => clearInterval(timer);
	});

	async function startReview(): Promise<void> {
		if (!onStartReview || startingReview) return;
		startingReview = true;

		try {
			await onStartReview();
		} finally {
			startingReview = false;
		}
	}

	/** Re-ask the question that led to this reply. */
	function retryFor(index: number): (() => void) | null {
		if (!onSend) return null;

		const previous = entries
			.slice(0, index)
			.findLast((item) => item.kind === 'message' && item.message.from === 'user');

		if (!previous || previous.kind !== 'message') return null;

		const question = previous.message;

		return () => void onSend?.(assignment.id, question.text, question.codeContext);
	}
</script>

<div class="review-chat" data-compact={compact || undefined}>
	<Conversation.Root class="min-h-0 w-full flex-1">
		<Conversation.Content
			aria-label={`${assignment.title} messages`}
			transcriptClass={compact ? '!max-w-[776px] !gap-3 !px-4 !pt-5 !pb-2' : 'review-transcript'}
			class="![scrollbar-gutter:auto]"
		>
			{#if intro}{@render intro()}{/if}
			{#each rows as row (row.key)}
				{#if row.kind === 'insert'}
					{@render row.snippet()}
				{:else if row.kind === 'message'}
					{@const message = row.message}
					<ReviewMessage
						{message}
						quietSignIn={row.index !== lastSignInIndex}
						quietUsage={row.index !== lastUsageIndex}
						onRetry={message.status === 'error' && message.discussion && !generating ? retryFor(row.index) : null}
						{startingReview}
						onStartReview={onStartReview &&
						!intro &&
						orchestratorView &&
						row.index === lastAssistantIndex &&
						message.status !== 'streaming'
							? () => void startReview()
							: null}
					/>
				{:else}
					<ReviewTraces
						traces={row.traces}
						{active}
						streaming={working || generating}
						{now}
						{clock}
						pending={row.pending}
						note={row.pending ? workNote : null}
					/>
				{/if}
			{/each}
			{#if thinking}
				<div class="reply-skeleton" role="status" aria-label="Waiting for a reply">
					<Skeleton class="reply-skeleton-line" />
					<Skeleton class="reply-skeleton-line" />
					<Skeleton class="reply-skeleton-line" />
				</div>
			{/if}
		</Conversation.Content>
		<Conversation.ScrollButton />
	</Conversation.Root>

	<ReviewDock
		{assignment}
		bind:draft
		bind:codeContext
		{compact}
		{focusKey}
		{onSend}
		{onStop}
		{onStopReview}
		{placeholder}
		{awaitingPrompt}
		{generating}
		{working}
		notice={retryNotice}
		{outputRate}
		{resume}
		streaming={conversationMessages.some((message) => message.status === 'streaming')}
	/>
</div>
