<script lang="ts">
	import { ORCHESTRATOR_ID, type ReviewAssignment, type ReviewChatMessage, type ReviewCodeContext, type ReviewReasoningEntry, type ReviewTask, type ReviewToolCall } from '@recoder/shared';
	import type { Snippet } from 'svelte';
	import Play from '@lucide/svelte/icons/play';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import X from '@lucide/svelte/icons/x';
	import { CopyButton } from '@sivir-ui/svelte/components/copy-button';
	import { CodeBlock } from '@sivir-ui/svelte/components/code-block';
	import { Button } from '@sivir-ui/svelte/components/button';
	import { Input } from '@sivir-ui/svelte/components/input';
	import * as Conversation from '@sivir-ui/svelte/components/conversation';
	import * as Message from '@sivir-ui/svelte/components/message';
	import { Markdown } from '@sivir-ui/svelte/components/markdown';
	import { Spinner } from '@sivir-ui/svelte/components/spinner';
	import { ScrollArea } from '@sivir-ui/svelte/components/scroll-area';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import ReviewTaskGroup from './review-task-group.svelte';
	import Disclosure from './ui/disclosure.svelte';
	import CodeRef from './code-ref.svelte';
	import ReviewComposer from './review-composer.svelte';
	import ModelPicker from './model-picker.svelte';
	import { MODEL_ROLES, modelSettingsUi } from '$lib/model-settings.svelte';
	import type { ReviewRole } from '@recoder/shared';
	import { groupTranscript } from '$lib/review-transcript';
	import { formatAgentName } from '$lib/threads.svelte';
	import { parseFixRequest, parseModelNotes, stripModelNotes } from '$lib/model-notes';
	import { fileIconUrl } from '$lib/material-icons';

	let { assignment, messages, reasoning, toolCalls, tasks, active, now, draft = $bindable(''), codeContext = $bindable(null), compact = false, focusKey, onSend, onStop, inserts = [], placeholder, awaitingPrompt = false, onStartReview = null }: {
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
		/** Blocks placed in the transcript before the first entry newer than `at` (or at the end). */
		inserts?: { key: string; at?: string; snippet: Snippet }[];
		placeholder?: string;
		awaitingPrompt?: boolean;
		/** Draft (interactive) reviews: the orchestrator offers the full review, so its latest reply carries the button. */
		onStartReview?: (() => Promise<void>) | null;
	} = $props();
	let startingReview = $state(false);
	async function startReview(): Promise<void> {
		if (!onStartReview || startingReview) return;
		startingReview = true;
		try { await onStartReview(); } finally { startingReview = false; }
	}
	const belongs = (id?: string) => (id ?? ORCHESTRATOR_ID) === assignment.id;
	const conversationMessages = $derived(messages.filter((message) => belongs(message.assignmentId)));
	const conversationReasoning = $derived(reasoning.filter((entry) => belongs(entry.assignmentId)));
	const generating = $derived(conversationMessages.some((message) => message.discussion && !message.forwardedFrom && message.status === 'streaming'));
	const conversationTools = $derived(toolCalls.filter((tool) => belongs(tool.assignmentId)));
	const specialist = $derived(assignment.id !== ORCHESTRATOR_ID);
	const working = $derived(active && ['running', 'waiting', 'queued'].includes(assignment.status));
	const currentTask = $derived(tasks.findLast((task) => task.status === 'running' || task.status === 'waiting'));
	const currentOperation = $derived(working
		? currentTask?.message || assignment.currentOperation || 'Waiting for this specialist…'
		: assignment.status === 'done' ? 'Specialist finished' : assignment.status === 'skipped' ? 'Specialist skipped' : 'Specialist review incomplete');
	const entries = $derived(groupTranscript(conversationMessages, conversationTools));
	// Keep inserted blocks (specialists, results) at their point in time as follow-ups arrive.
	const placed = $derived(inserts.map((insert) => {
		const index = insert.at ? entries.findIndex((entry) => Date.parse(entry.at) > Date.parse(insert.at!)) : -1;
		return { ...insert, index: index < 0 ? entries.length : index };
	}));
	const lastAssistantIndex = $derived(entries.findLastIndex((entry) => entry.kind === 'message' && entry.message.from === 'assistant'));
	/** Agent turns reply as `message_<reasoning id>`; discussion replies think as `reason_<reply id>`. Either way thinking sits with its reply. */
	const reasoningByMessage = $derived(new Map<string, ReviewReasoningEntry>(conversationReasoning.flatMap((entry) => [[`message_${entry.id}`, entry], [entry.id.replace(/^reason_/, ''), entry]])));
	const messageIds = $derived(new Set(entries.flatMap((entry) => entry.kind === 'message' ? [entry.id] : [])));
	const orphanReasoning = $derived(conversationReasoning.filter((entry) => !messageIds.has(`message_${entry.id}`)));
	/** Specialists narrate tasks by title ("Running Correctness of …"); only show a status that says something new. */
	const specialistStatus = $derived.by(() => {
		if (!specialist) return null;
		// Finished states are on the badge at the top; don't repeat them at the bottom.
		if (!working) return null;
		if (orphanReasoning.some((entry) => entry.status === 'streaming')) return null;
		const op = currentTask?.message || assignment.currentOperation || '';
		return /^Running\b/.test(op) || op === assignment.title ? null : op || null;
	});
	function thoughtSeconds(entry: ReviewReasoningEntry, until?: string): number | null {
		const start = Date.parse(entry.at);
		const end = Date.parse(until ?? '');
		return Number.isFinite(start) && Number.isFinite(end) && end > start ? Math.round((end - start) / 1000) : null;
	}
	/** Only while a reply is actually pending and nothing (text or thinking) has streamed for it yet. */
	const thinking = $derived(
		generating &&
		!conversationMessages.some((message) => message.status === 'streaming' && message.text.trim()) &&
		!conversationReasoning.some((entry) => entry.status === 'streaming' && entry.text.trim())
	);
	/** Thinking with no reply of its own sits where it happened in time, not lumped at the top. */
	const orphansAt = $derived.by(() => {
		const byIndex = new Map<number, ReviewReasoningEntry[]>();
		for (const entry of orphanReasoning) {
			if (!entry.text.trim()) continue;
			const found = entries.findIndex((item) => Date.parse(item.at) > Date.parse(entry.at));
			const index = found < 0 ? entries.length : found;
			byIndex.set(index, [...(byIndex.get(index) ?? []), entry]);
		}
		return byIndex;
	});
	/** Re-ask the question that led to this reply. */
	function retryFor(index: number): (() => void) | null {
		if (!onSend) return null;
		const previous = entries.slice(0, index).findLast((item) => item.kind === 'message' && item.message.from === 'user');
		if (!previous || previous.kind !== 'message') return null;
		const question = previous.message;
		return () => void onSend?.(assignment.id, question.text, question.codeContext);
	}
	const isRole = (role: string): role is ReviewRole => (MODEL_ROLES as string[]).includes(role);
	let sending = $state(false);
	let stopping = $state(false);
	let error = $state('');
	let fileInput = $state<HTMLInputElement>();
	let composerInput = $state<HTMLTextAreaElement>();
	$effect(() => {
		if (focusKey !== undefined && composerInput) composerInput.focus({ preventScroll: true });
	});
	const errorId = $props.id();
	async function attachFile(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		error = '';
		try {
			if (file.size > 32_000) throw new Error('Choose a text file under 32 KB. Messages can contain up to 8,000 characters.');
			const text = await file.text();
			if (/[\u0000\uFFFD]/.test(text)) throw new Error('Choose a text or source code file.');
			const context = `\n\nAttached file: ${file.name}\n\n${text}`;
			if (draft.length + context.length > 8000) throw new Error('This file exceeds the 8,000-character message limit. Attach a smaller excerpt.');
			draft += context;
		} catch (cause) { error = cause instanceof Error ? cause.message : 'Could not read the file.'; }
		finally { input.value = ''; }
	}
	async function send(value: string) {
		if (!onSend || sending || generating || !value.trim()) return;
		if (value.trim().length > 8000) { error = 'Keep your message under 8,000 characters.'; return; }
		sending = true;
		error = '';
		const selection = codeContext;
		try {
			await onSend(assignment.id, value.trim(), selection ?? undefined);
			draft = '';
			if (codeContext === selection) codeContext = null;
		}
		catch (cause) { error = cause instanceof Error ? cause.message : 'Message could not be sent.'; }
		finally { sending = false; }
	}
	async function stop() {
		if (stopping) return;
		stopping = true;
		error = '';
		try { await onStop?.(assignment.id); }
		catch (cause) { error = cause instanceof Error ? cause.message : 'Could not stop the reply.'; }
		finally { stopping = false; }
	}
</script>

{#snippet response(message: ReviewChatMessage)}
	{#if message.codeContext}
		{@render codeReference(message.codeContext)}
	{/if}
	{#if message.from === 'assistant' && (message.text.includes('```recoder-note') || message.text.includes('```recoder-fix'))}
		{@const fixRequest = parseFixRequest(message.text)}
		<Markdown content={stripModelNotes(message.text)} streaming={message.status === 'streaming'} />
		{#each parseModelNotes(message.text) as note, i (i)}
			<p class="model-note-added">Added a note on <span class="font-mono">{note.file.split('/').at(-1)}:{note.startLine}{note.endLine !== note.startLine ? `–${note.endLine}` : ''}</span></p>
		{/each}
		{#if fixRequest}
			<p class="model-note-added">Preparing fixes for {fixRequest === 'all' ? 'every open finding' : `${fixRequest.length} ${fixRequest.length === 1 ? 'finding' : 'findings'}`}. You review the patches before anything is pushed.</p>
		{/if}
	{:else}
		<Markdown content={message.text} streaming={message.status === 'streaming'} />
	{/if}
{/snippet}

{#snippet codeReference(context: ReviewCodeContext)}
	<CodeRef {context} />
{/snippet}

{#snippet thought(entry: ReviewReasoningEntry, until?: string)}
	{@const live = !until && entry.status === 'streaming' && (active || generating)}
	{@const seconds = thoughtSeconds(entry, until)}
	<Disclosure status={live ? 'running' : undefined} bodyClass="!gap-3">
		{#snippet label()}{live ? 'Thinking…' : seconds ? `Thought for ${seconds}s` : 'Thought'}{/snippet}
		<Markdown content={entry.text} streaming={live} />
	</Disclosure>
{/snippet}

{#snippet orphansBefore(index: number)}
	{#each orphansAt.get(index) ?? [] as entry (entry.id)}{@render thought(entry)}{/each}
{/snippet}

<div class="review-chat" data-compact={compact || undefined}>
<Conversation.Root class="min-h-0 w-full flex-1">
	<Conversation.Content aria-label={`${assignment.title} messages`} transcriptClass={compact ? '!max-w-[776px] !gap-4 !px-4 !pt-5 !pb-2' : 'review-transcript'} class="![scrollbar-gutter:auto]">
		{#each entries as item, index (item.kind + item.id)}
			{#each placed.filter((insert) => insert.index === index) as insert (insert.key)}{@render insert.snippet()}{/each}
			{@render orphansBefore(index)}
			{#if item.kind === 'message'}
				{@const message = item.message}
				{@const ownThought = reasoningByMessage.get(message.id)}
				{#if ownThought}{@render thought(ownThought, message.at)}{/if}
				<Message.Root from={message.from} status={message.status === 'done' ? 'idle' : message.status}
					class="[--font-weight-body:400]"
					name={message.forwardedFrom ? `${message.from === 'user' ? 'You →' : 'Reply from'} ${message.forwardedFrom}` : undefined}>
					<Message.Content class={message.from === 'assistant' ? 'review-prose ai-voice' : message.from === 'user' ? 'review-bubble' : '!max-w-full text-sm'}>
						{@render response(message)}
					</Message.Content>
					{#if message.from === 'assistant' && message.status !== 'streaming' && message.text.trim() && (message.discussion || (index === lastAssistantIndex && !working))}
						{@const retry = message.discussion && !generating ? retryFor(index) : null}
						<Message.Actions class="message-actions">
							<CopyButton text={stripModelNotes(message.text)} label="Copy" copiedLabel="Copied" class="message-action" />
							{#if retry}
								<Button variant="ghost" size="icon" class="message-action" aria-label="Retry" title="Retry" onclick={retry}><RotateCcw size={13} aria-hidden="true" /></Button>
							{/if}
						</Message.Actions>
					{/if}
				</Message.Root>
				{#if onStartReview && !specialist && index === lastAssistantIndex && message.status !== 'streaming'}
					<div class="review-start-cta">
						<Button class="brief-action" loading={startingReview} onclick={() => void startReview()}>
							<Play size={12} fill="currentColor" aria-hidden="true" /> Run full review
						</Button>
					</div>
				{/if}
			{:else}
				<ReviewTaskGroup tools={item.tools} {active} {now} />
			{/if}
		{/each}
		{@render orphansBefore(entries.length)}
		{#each placed.filter((insert) => insert.index === entries.length) as insert (insert.key)}{@render insert.snippet()}{/each}
		{#if specialist}
			{#if specialistStatus}
				<Typography.Text role="status" class="flex items-start gap-2 text-sm text-foreground-muted">
					{#if working}<Spinner size={14} class="mt-1 shrink-0" aria-hidden="true" />{/if}
					<span class="min-w-0 break-words">{specialistStatus}</span>
				</Typography.Text>
			{/if}
		{/if}
		{#if thinking}
			<Typography.Text role="status" class="review-thinking"><span class="shimmer-text">Thinking</span></Typography.Text>
		{/if}
	</Conversation.Content>
	<Conversation.ScrollButton />
</Conversation.Root>

<div class={compact ? 'mx-auto w-full max-w-[776px] shrink-0 px-3 pb-3 pt-3' : 'review-dock'}>
	<div class="review-dock-inner">
	{#if error}<Typography.Text id={errorId} role="alert" class="mb-2 text-sm text-error">{error}</Typography.Text>{/if}
	<!-- Never write a filename back: Sivir 0.3.2 also binds value on file inputs. -->
	<div hidden><Input type="file" bind:value={() => '', () => {}} bind:element={fileInput} aria-label="Attach a text file" onchange={attachFile} /></div>
	<ReviewComposer
		bind:value={draft}
		bind:inputEl={composerInput}
		size={compact ? 'panel' : 'main'}
		label={`Message ${assignment.title}`}
		placeholder={codeContext ? 'Ask about this code…' : placeholder ?? (awaitingPrompt ? 'Ask Orchestrator to start a review…' : `Ask ${specialist ? formatAgentName(assignment.role) : assignment.title} anything…`)}
		maxlength={8000}
		describedBy={error ? errorId : undefined}
		invalid={!!error}
		{sending}
		{generating}
		disabled={!onSend}
		onSubmit={send}
		onStop={onStop ? stop : undefined}
		onAttach={() => fileInput?.click()}
		attachLabel="Attach a text file"
		oninput={() => error = ''}
	>
		{#snippet context()}
			{#if codeContext}
				{@const name = codeContext.file.split('/').at(-1) ?? codeContext.file}
				<span class="composer-quote" title="{codeContext.file}{codeContext.side === 'old' ? ' (before)' : ''}">
					<img src={fileIconUrl(name)} alt="" width="14" height="14" class="composer-quote-icon" />
					<span class="min-w-0 truncate">{name}:{codeContext.startLine}{codeContext.endLine !== codeContext.startLine ? `–${codeContext.endLine}` : ''}</span>
					<Button variant="ghost" size="icon" class="composer-quote-remove" aria-label="Remove selected code" disabled={sending} onclick={() => codeContext = null}><X size={12} aria-hidden="true" /></Button>
				</span>
			{/if}
		{/snippet}
		{#snippet leading()}
			{#if specialist}<Typography.Metadata class="truncate text-[12px] text-fg-faint">Shared with Orchestrator</Typography.Metadata>{/if}
		{/snippet}
		{#snippet picker()}
			{#if !specialist}
				<ModelPicker
					value={modelSettingsUi.orchestrator}
					onSelect={(choice) => void modelSettingsUi.selectOrchestrator(choice)}
					size={compact ? 'panel' : 'md'}
					composerExtras
					label="Orchestrator model"
				/>
			{:else if isRole(assignment.role)}
				{@const role = assignment.role}
				<ModelPicker
					value={modelSettingsUi.roleChoice(role)}
					onSelect={(choice) => void modelSettingsUi.selectRole(role, choice)}
					size={compact ? 'panel' : 'md'}
					disabled={modelSettingsUi.applyToSpecialists}
					label="{assignment.title} model"
				/>
			{/if}
		{/snippet}
	</ReviewComposer>
	</div>
</div>
</div>
