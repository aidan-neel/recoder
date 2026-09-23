<script lang="ts">
	import { ORCHESTRATOR_ID, type ReviewAssignment, type ReviewChatMessage, type ReviewCodeContext, type ReviewReasoningEntry, type ReviewTask, type ReviewToolCall } from '@recoder/shared';
	import type { Snippet } from 'svelte';
	import X from '@lucide/svelte/icons/x';
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
	import { parseModelNotes, stripModelNotes } from '$lib/model-notes';
	import { fileIconUrl } from '$lib/material-icons';

	let { assignment, messages, reasoning, toolCalls, tasks, active, now, draft = $bindable(''), codeContext = $bindable(null), compact = false, focusKey, onSend, onStop, inserts = [], placeholder, awaitingPrompt = false }: {
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
	} = $props();
	const belongs = (id?: string) => (id ?? ORCHESTRATOR_ID) === assignment.id;
	const conversationMessages = $derived(messages.filter((message) => belongs(message.assignmentId)));
	const conversationReasoning = $derived(reasoning.filter((entry) => belongs(entry.assignmentId)));
	const generating = $derived(conversationMessages.some((message) => message.discussion && !message.forwardedFrom && message.status === 'streaming'));
	const conversationTools = $derived(toolCalls.filter((tool) => belongs(tool.assignmentId)));
	const specialist = $derived(assignment.id !== ORCHESTRATOR_ID);
	const currentTask = $derived(tasks.findLast((task) => task.status === 'running' || task.status === 'waiting'));
	const currentOperation = $derived(active && ['running', 'waiting', 'queued'].includes(assignment.status)
		? currentTask?.message || assignment.currentOperation || 'Waiting for this specialist…'
		: assignment.status === 'done' ? 'Specialist finished' : assignment.status === 'skipped' ? 'Specialist skipped' : 'Specialist review incomplete');
	const entries = $derived(groupTranscript(conversationMessages, conversationTools));
	// Keep inserted blocks (specialists, results) at their point in time as follow-ups arrive.
	const placed = $derived(inserts.map((insert) => {
		const index = insert.at ? entries.findIndex((entry) => Date.parse(entry.at) > Date.parse(insert.at!)) : -1;
		return { ...insert, index: index < 0 ? entries.length : index };
	}));
	const firstAssistantIndex = $derived(entries.findIndex((entry) => entry.kind === 'message' && entry.message.from === 'assistant'));
	const reasoningSeconds = $derived.by(() => {
		const start = Date.parse(conversationReasoning[0]?.at ?? '');
		const end = Date.parse(entries[firstAssistantIndex]?.at ?? '');
		return Number.isFinite(start) && Number.isFinite(end) && end > start ? Math.round((end - start) / 1000) : null;
	});
	const thinking = $derived(
		!conversationMessages.some((message) => !message.forwardedFrom && message.status === 'streaming' && message.text.trim()) &&
		!conversationTools.some((tool) => tool.status === 'running' && active) &&
		(generating || (active && (conversationReasoning.some((entry) => entry.status === 'streaming') ||
			tasks.some((task) => task.status === 'running' && ['model', 'planning', 'consolidation'].includes(task.kind ?? '')))))
	);
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
	{#if message.from === 'assistant' && message.text.includes('```recoder-note')}
		<Markdown content={stripModelNotes(message.text)} streaming={message.status === 'streaming'} />
		{#each parseModelNotes(message.text) as note, i (i)}
			<p class="model-note-added">Added a note on <span class="font-mono">{note.file.split('/').at(-1)}:{note.startLine}{note.endLine !== note.startLine ? `–${note.endLine}` : ''}</span></p>
		{/each}
	{:else}
		<Markdown content={message.text} streaming={message.status === 'streaming'} />
	{/if}
{/snippet}

{#snippet codeReference(context: ReviewCodeContext)}
	<CodeRef {context} />
{/snippet}

{#snippet reviewReasoning()}
	{#if conversationReasoning.length}
		{@const reasoningLive = conversationReasoning.some((entry) => entry.status === 'streaming') && (active || generating)}
		<Disclosure open={specialist} status={reasoningLive ? 'running' : undefined} bodyClass="!gap-3">
			{#snippet label()}{reasoningLive ? awaitingPrompt ? 'Thinking…' : 'Reviewing changes…' : reasoningSeconds ? `Reviewed changes for ${reasoningSeconds}s` : 'Reviewed changes'}{/snippet}
			{#each conversationReasoning as entry (entry.id)}<Markdown content={entry.text} streaming={active && entry.status === 'streaming'} />{/each}
		</Disclosure>
	{/if}
{/snippet}

<div class="review-chat" data-compact={compact || undefined}>
<Conversation.Root class="min-h-0 w-full flex-1">
	<Conversation.Content aria-label={`${assignment.title} messages`} transcriptClass={compact ? '!max-w-[776px] !gap-4 !px-4 !pt-5 !pb-2' : 'review-transcript'} class="![scrollbar-gutter:auto]">
		{#each entries as item, index (item.kind + item.id)}
			{#each placed.filter((insert) => insert.index === index) as insert (insert.key)}{@render insert.snippet()}{/each}
			{#if index === firstAssistantIndex}{@render reviewReasoning()}{/if}
			{#if item.kind === 'message'}
				{@const message = item.message}
				<Message.Root from={message.from} status={message.status === 'done' ? 'idle' : message.status}
					class="[--font-weight-body:400]"
					name={message.forwardedFrom ? `${message.from === 'user' ? 'You →' : 'Reply from'} ${message.forwardedFrom}` : undefined}>
					<Message.Content class={message.from === 'assistant' ? 'review-prose ai-voice' : message.from === 'user' ? 'review-bubble' : '!max-w-full text-sm'}>
						{@render response(message)}
					</Message.Content>
				</Message.Root>
			{:else}
				<ReviewTaskGroup tools={item.tools} {active} {now} />
			{/if}
		{:else}
			{#if !awaitingPrompt && !specialist}<Typography.Text class="py-4 text-sm text-foreground-muted" role="status">{compact ? 'Select code in the diff or ask a question about this review.' : active ? 'Preparing the review…' : 'Ask a question about this review.'}</Typography.Text>{/if}
		{/each}
		{#if firstAssistantIndex < 0}{@render reviewReasoning()}{/if}
		{#each placed.filter((insert) => insert.index === entries.length) as insert (insert.key)}{@render insert.snippet()}{/each}
		{#if specialist}
			<section class="space-y-2" aria-label={`${assignment.title} activity`}>
				<Typography.Text role="status" class="flex items-start gap-2 text-sm text-foreground-muted">
					{#if active && assignment.status === 'running'}<Spinner size={14} class="mt-1 shrink-0" aria-hidden="true" />{/if}
					<span class="min-w-0 break-words">{currentOperation}</span>
				</Typography.Text>
				{#if tasks.length}
					<Disclosure meta={String(tasks.length)}>
						{#snippet label()}Review activity{/snippet}
						<ScrollArea showCues={false} class="max-h-64" aria-label={`${assignment.title} tasks`}>
							{#each tasks as task (task.id)}
								<Typography.Text class="review-log"><span class="text-fg-secondary">{task.label}</span> · {task.status}{#if task.message}<span class="mt-0.5 block">{task.message}</span>{/if}</Typography.Text>
							{/each}
						</ScrollArea>
					</Disclosure>
				{/if}
			</section>
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
		placeholder={codeContext ? 'Ask about this code…' : placeholder ?? (awaitingPrompt ? 'Ask Orchestrator to start a review…' : `Ask ${assignment.title} anything…`)}
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
