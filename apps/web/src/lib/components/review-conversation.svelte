<script lang="ts">
	import { ORCHESTRATOR_ID, type ReviewAssignment, type ReviewChatMessage, type ReviewCodeContext, type ReviewReasoningEntry, type ReviewTask, type ReviewToolCall } from '@recoder/shared';
	import type { Snippet } from 'svelte';
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Paperclip from '@lucide/svelte/icons/paperclip';
	import Square from '@lucide/svelte/icons/square';
	import X from '@lucide/svelte/icons/x';
	import { CodeBlock } from '@sivir-ui/svelte/components/code-block';
	import { Button } from '@sivir-ui/svelte/components/button';
	import { Input } from '@sivir-ui/svelte/components/input';
	import * as Collapsible from '@sivir-ui/svelte/components/collapsible';
	import * as Composer from '@sivir-ui/svelte/components/composer';
	import * as Conversation from '@sivir-ui/svelte/components/conversation';
	import * as Message from '@sivir-ui/svelte/components/message';
	import { Markdown } from '@sivir-ui/svelte/components/markdown';
	import { Spinner } from '@sivir-ui/svelte/components/spinner';
	import { ScrollArea } from '@sivir-ui/svelte/components/scroll-area';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import ReviewTaskGroup from './review-task-group.svelte';
	import { groupTranscript } from '$lib/review-transcript';

	let { assignment, messages, reasoning, toolCalls, tasks, active, now, draft = $bindable(''), codeContext = $bindable(null), compact = false, focusKey, onSend, onStop, workspace, workspaceAt, afterTranscript, afterTranscriptAt, awaitingPrompt = false }: {
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
		workspace?: Snippet;
		workspaceAt?: string;
		afterTranscript?: Snippet;
		afterTranscriptAt?: string;
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
	// Keep the specialist group at its creation point as follow-up messages arrive.
	const workspaceIndex = $derived.by(() => {
		const index = workspaceAt ? entries.findIndex((entry) => Date.parse(entry.at) > Date.parse(workspaceAt)) : -1;
		return index < 0 ? entries.length : index;
	});
	const firstAssistantIndex = $derived(entries.findIndex((entry) => entry.kind === 'message' && entry.message.from === 'assistant'));
	const resultIndex = $derived.by(() => {
		const index = afterTranscriptAt ? entries.findIndex((entry) => Date.parse(entry.at) > Date.parse(afterTranscriptAt)) : -1;
		return index < 0 ? entries.length : index;
	});
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
	<Markdown content={message.text} streaming={message.status === 'streaming'} />
{/snippet}

{#snippet codeReference(context: ReviewCodeContext)}
	<Collapsible.Root>
		<Collapsible.Trigger class="review-disclosure max-w-full" title={context.file}>
			<ChevronRight size={14} class="shrink-0" aria-hidden="true" />
			<span class="min-w-0 truncate font-mono text-xs">{context.file}:{context.startLine}{context.endLine !== context.startLine ? `–${context.endLine}` : ''}</span>
			<span class="shrink-0 text-xs">{context.side === 'old' ? 'Before' : 'After'}</span>
		</Collapsible.Trigger>
		<Collapsible.Content class="pt-2"><CodeBlock code={context.quote} lang="plaintext" class="max-h-48" /></Collapsible.Content>
	</Collapsible.Root>
{/snippet}

{#snippet reviewReasoning()}
	{#if conversationReasoning.length}
		<Collapsible.Root open={specialist}>
			<Collapsible.Trigger class="review-disclosure">
				{conversationReasoning.some((entry) => entry.status === 'streaming') && (active || generating) ? awaitingPrompt ? 'Thinking…' : 'Reviewing changes…' : reasoningSeconds ? `Reviewed for ${reasoningSeconds}s` : 'Reviewed changes'}
				<ChevronRight size={14} aria-hidden="true" />
			</Collapsible.Trigger>
			<Collapsible.Content class="space-y-3 py-2 text-sm text-foreground-muted">
				{#each conversationReasoning as entry (entry.id)}<Markdown content={entry.text} streaming={active && entry.status === 'streaming'} />{/each}
			</Collapsible.Content>
		</Collapsible.Root>
	{/if}
{/snippet}

<Conversation.Root class="min-h-0 w-full flex-1">
	<Conversation.Content aria-label={`${assignment.title} messages`} transcriptClass={`!max-w-[776px] !gap-4 !py-2 ${compact ? '!px-4' : ''}`} class="![scrollbar-gutter:auto]">
		{#each entries as item, index (item.kind + item.id)}
			{#if index === workspaceIndex && workspace}{@render workspace()}{/if}
			{#if index === resultIndex}{@render afterTranscript?.()}{/if}
			{#if index === firstAssistantIndex}{@render reviewReasoning()}{/if}
			{#if item.kind === 'message'}
				{@const message = item.message}
				<Message.Root from={message.from} status={message.status === 'done' ? 'idle' : message.status}
					class="[--font-weight-body:400]"
					name={message.forwardedFrom ? `${message.from === 'user' ? 'You →' : 'Reply from'} ${message.forwardedFrom}` : undefined}>
					<Message.Content class="!max-w-full text-sm font-normal leading-relaxed [&_[data-ui=markdown]]:text-sm">
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
		{#if workspaceIndex === entries.length && workspace}{@render workspace()}{/if}
		{#if resultIndex === entries.length}{@render afterTranscript?.()}{/if}
		{#if specialist}
			<section class="space-y-2" aria-label={`${assignment.title} activity`}>
				<Typography.Text role="status" class="flex items-start gap-2 text-sm text-foreground-muted">
					{#if active && assignment.status === 'running'}<Spinner size={14} class="mt-1 shrink-0" aria-hidden="true" />{/if}
					<span class="min-w-0 break-words">{currentOperation}</span>
				</Typography.Text>
				{#if tasks.length}
					<Collapsible.Root>
						<Collapsible.Trigger class="review-disclosure">Review activity <ChevronRight size={14} aria-hidden="true" /></Collapsible.Trigger>
						<Collapsible.Content class="py-2">
							<ScrollArea showCues={false} class="max-h-64" aria-label={`${assignment.title} tasks`}>
								{#each tasks as task (task.id)}
									<Typography.Text class="mb-3 break-words text-sm text-foreground-muted"><span class="font-medium text-foreground">{task.label}</span> · {task.status}<span class="mt-1 block">{task.message}</span></Typography.Text>
								{/each}
								</ScrollArea>
						</Collapsible.Content>
					</Collapsible.Root>
				{/if}
			</section>
		{/if}
		{#if thinking}
			<Typography.Text role="status" class="flex items-center gap-2 px-1 text-sm text-foreground-muted"><Spinner size={14} aria-hidden="true" />Thinking</Typography.Text>
		{/if}
	</Conversation.Content>
	<Conversation.ScrollButton />
</Conversation.Root>

<div class="mx-auto w-full max-w-[776px] shrink-0 {compact ? 'px-3 pb-4 pt-3' : 'px-4 pb-8 pt-4 sm:px-6'}">
	{#if codeContext}
		<div class="mb-2 flex min-w-0 items-start gap-1">
			<div class="min-w-0 flex-1">{@render codeReference(codeContext)}</div>
			<Button variant="ghost" size="icon" class="size-9 shrink-0" aria-label="Remove selected code" disabled={sending} onclick={() => codeContext = null}><X size={14} aria-hidden="true" /></Button>
		</div>
	{/if}
	{#if assignment.id !== ORCHESTRATOR_ID}<Typography.Metadata class="mb-2 block text-xs">Shared with orchestrator</Typography.Metadata>{/if}
	{#if error}<Typography.Text id={errorId} role="alert" class="mb-2 text-sm text-error">{error}</Typography.Text>{/if}
	<!-- Never write a filename back: Sivir 0.3.2 also binds value on file inputs. -->
	<div hidden><Input type="file" bind:value={() => '', () => {}} bind:element={fileInput} aria-label="Attach a text file" onchange={attachFile} /></div>
	<Composer.Root bind:value={draft} onSubmit={send} onStop={onStop ? stop : undefined} {generating} status={sending ? 'submitting' : 'idle'} disabled={!onSend} class="session-composer">
		<Composer.Input bind:element={composerInput} class="session-composer-input" aria-label={`Message ${assignment.title}`} aria-describedby={error ? errorId : undefined} aria-invalid={error ? 'true' : undefined} placeholder={codeContext ? 'Ask about this code…' : awaitingPrompt ? 'Ask Orchestrator to start a review…' : `Ask ${assignment.title} anything…`} maxlength={8000} disabled={sending || !onSend} oninput={() => error = ''} />
		<Composer.Actions class="!flex-none !flex-nowrap !gap-1 self-end !p-0">
			<Button variant="quiet" size="icon" class="group size-9 rounded-full text-foreground-muted" aria-label="Attach a text file" title="Attach a text file" disabled={!onSend || sending} onclick={() => fileInput?.click()}><span class="flex size-7 items-center justify-center rounded-full group-hover:bg-foreground/[0.08]"><Paperclip class="size-3.5" strokeWidth={1.5} aria-hidden="true" /></span></Button>
			{#if generating && onStop}
				<Button variant="ghost" size="icon" class="size-9 rounded-full !bg-transparent [&_.sivir-button-face]:text-[0px]" aria-label="Stop response" loading={stopping} onclick={stop}><span class="flex size-7 items-center justify-center rounded-full bg-primary text-[var(--color-on-primary)]"><Square class="size-2.5" fill="currentColor" aria-hidden="true" /></span></Button>
			{:else}
				<Composer.Submit class="!size-9 !min-w-9 !rounded-full !bg-transparent !p-0 [&_.sivir-button-face]:text-[0px]" disabled={generating}>
					{#snippet children()}<span class="flex size-7 items-center justify-center rounded-full bg-primary text-[var(--color-on-primary)]"><ArrowUp class="size-4" strokeWidth={1.5} aria-hidden="true" /></span>{/snippet}
				</Composer.Submit>
			{/if}
		</Composer.Actions>
	</Composer.Root>
</div>
