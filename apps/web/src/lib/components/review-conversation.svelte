<script lang="ts">
	import { ORCHESTRATOR_ID, type ReviewAssignment, type ReviewChatMessage, type ReviewCodeContext, type ReviewReasoningEntry, type ReviewTask, type ReviewToolCall } from '@recoder/shared';
	import type { Snippet } from 'svelte';
	import Play from '@lucide/svelte/icons/play';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import X from '@lucide/svelte/icons/x';
	import * as Tooltip from '@sivir-ui/svelte/components/tooltip';
	import { CodeBlock } from '@sivir-ui/svelte/components/code-block';
	import { Button } from '@sivir-ui/svelte/components/button';
	import { Input } from '@sivir-ui/svelte/components/input';
	import * as Conversation from '@sivir-ui/svelte/components/conversation';
	import * as Message from '@sivir-ui/svelte/components/message';
	import { Spinner } from '@sivir-ui/svelte/components/spinner';
	import { ScrollArea } from '@sivir-ui/svelte/components/scroll-area';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import ReviewTaskGroup from './review-task-group.svelte';
	import Disclosure from './ui/disclosure.svelte';
	import ThoughtLabel from './ui/thought-label.svelte';
	import DotLoader from './ui/dot-loader.svelte';
	import CodeRef from './code-ref.svelte';
	import { findingsStore } from '$lib/findings.svelte';
	import ConversationFixes from './conversation-fixes.svelte';
	import CopyAction from './copy-action.svelte';
	import FailureNotice from './failure-notice.svelte';
	import StreamingMarkdown from './streaming-markdown.svelte';
	import ReviewComposer from './review-composer.svelte';
	import ModelPicker from './model-picker.svelte';
	import { MODEL_ROLES, modelSettingsUi, summarizesReasoning } from '$lib/model-settings.svelte';
	import type { ReviewRole } from '@recoder/shared';
	import { groupTranscript, taskGroupLabel, taskGroupStatus } from '$lib/review-transcript';
	import { formatAgentName } from '$lib/threads.svelte';
	import { parseFixRequest, parseModelNotes, stripModelNotes } from '$lib/model-notes';
	import { fileIconUrl } from '$lib/material-icons';

	let { assignment, messages, reasoning, toolCalls, tasks, active, now, draft = $bindable(''), codeContext = $bindable(null), compact = false, focusKey, onSend, onStop, inserts = [], placeholder, awaitingPrompt = false, onStartReview = null, signInShown = false, intro }: {
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
		/** A sign-in notice already shows above the transcript. */
		signInShown?: boolean;
		/** Opening card at the top of a new session; it carries Run full review while it shows. */
		intro?: Snippet;
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
	/** Only the latest sign-in failure carries the notice; earlier ones would repeat it. */
	const lastSignInIndex = $derived(signInShown ? -1 : entries.findLastIndex((entry) => entry.kind === 'message' && !!entry.message.failure?.signIn));
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
	/** Only while a reply is actually pending and nothing (text or thinking) has streamed for it yet. */
	const thinking = $derived(
		generating &&
		!conversationMessages.some((message) => message.status === 'streaming' && message.text.trim()) &&
		!conversationReasoning.some((entry) => entry.status === 'streaming')
	);
	/** Thinking with no reply of its own sits where it happened in time, not lumped at the top. */
	const orphansAt = $derived.by(() => {
		const byIndex = new Map<number, ReviewReasoningEntry[]>();
		for (const entry of orphanReasoning) {
			if (!entry.text.trim() && entry.status !== 'streaming') continue;
			const found = entries.findIndex((item) => Date.parse(item.at) > Date.parse(entry.at));
			const index = found < 0 ? entries.length : found;
			byIndex.set(index, [...(byIndex.get(index) ?? []), entry]);
		}
		return byIndex;
	});
	type Trace =
		| { kind: 'thought'; key: string; entry: ReviewReasoningEntry; until?: string }
		| { kind: 'tasks'; key: string; tools: ReviewToolCall[] };
	type Row =
		| { kind: 'insert'; key: string; snippet: Snippet }
		| { kind: 'message'; key: string; message: ReviewChatMessage; index: number }
		| { kind: 'traces'; key: string; traces: Trace[] };
	/** Transcript in order, with back-to-back thoughts and tool groups folded into one row. */
	const rows = $derived.by(() => {
		const out: Row[] = [];
		const trace = (item: Trace) => {
			const previous = out.at(-1);
			if (previous?.kind === 'traces') previous.traces.push(item);
			else out.push({ kind: 'traces', key: `traces-${item.key}`, traces: [item] });
		};
		const before = (index: number) => {
			for (const insert of placed) if (insert.index === index) out.push({ kind: 'insert', key: `insert-${insert.key}`, snippet: insert.snippet });
			for (const entry of orphansAt.get(index) ?? []) trace({ kind: 'thought', key: `thought-${entry.id}`, entry });
		};
		entries.forEach((item, index) => {
			before(index);
			if (item.kind === 'tasks') { trace({ kind: 'tasks', key: `tasks-${item.id}`, tools: item.tools }); return; }
			const ownThought = reasoningByMessage.get(item.message.id);
			if (ownThought) trace({ kind: 'thought', key: `thought-${ownThought.id}`, entry: ownThought, until: item.message.at });
			out.push({ kind: 'message', key: `message-${item.id}`, message: item.message, index });
		});
		before(entries.length);
		return out;
	});
	function thoughtLive(entry: ReviewReasoningEntry, until?: string): boolean {
		return !until && entry.status === 'streaming' && (active || generating);
	}
	/** The row a folded run shows: its most recent trace's label and glyph. */
	type TraceHead = { label: string; status?: 'running' | 'error' | 'done'; thought?: { working: boolean; time?: string } };
	function traceHead(item: Trace): TraceHead {
		if (item.kind === 'tasks') {
			const { status, failed } = taskGroupStatus(item.tools, active);
			return { label: `${taskGroupLabel(item.tools, status === 'running')}${failed ? ` · ${failed} failed` : ''}`, status };
		}
		const working = thoughtLive(item.entry, item.until);
		return { label: '', thought: { working, time: working ? elapsed(item.entry.at) : elapsed(item.entry.at, item.until) } };
	}
	/** Pending reply with nothing streamed yet: time it from when it was asked for. */
	const pendingSince = $derived(conversationMessages.findLast((message) => message.discussion && !message.forwardedFrom && message.status === 'streaming')?.at);
	const anyLive = $derived(thinking || conversationReasoning.some((entry) => entry.status === 'streaming' && (active || generating)));
	let clock = $state(Date.now());
	$effect(() => {
		if (!anyLive) return;
		clock = Date.now();
		const timer = setInterval(() => (clock = Date.now()), 100);
		return () => clearInterval(timer);
	});
	/** Seconds from `since` to `until` (or now), to a tenth; minutes past 60s. */
	function elapsed(since?: string, until?: string): string | undefined {
		const start = Date.parse(since ?? '');
		const end = until === undefined ? clock : Date.parse(until);
		if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return undefined;
		const tenths = Math.floor((end - start) / 100);
		return tenths < 600 ? `${(tenths / 10).toFixed(1)}s` : `${Math.floor(tenths / 600)}m ${((tenths % 600) / 10).toFixed(1)}s`;
	}
	/** Models that hide their reasoning leave nothing to open. */
	const hasBody = (item: Trace) => item.kind === 'tasks' || (!item.entry.summary && !summarizesReasoning(item.entry.model) && !!item.entry.text.trim());
	/** Re-ask the question that led to this reply. */
	function retryFor(index: number): (() => void) | null {
		if (!onSend) return null;
		const previous = entries.slice(0, index).findLast((item) => item.kind === 'message' && item.message.from === 'user');
		if (!previous || previous.kind !== 'message') return null;
		const question = previous.message;
		return () => void onSend?.(assignment.id, question.text, question.codeContext);
	}
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
		<StreamingMarkdown content={stripModelNotes(message.text)} streaming={message.status === 'streaming'} />
		{#each parseModelNotes(message.text) as note, i (i)}
			<p class="model-note-added">Added a note on <span class="font-mono">{note.file.split('/').at(-1)}:{note.startLine}{note.endLine !== note.startLine ? `–${note.endLine}` : ''}</span></p>
		{/each}
		{#if findingsStore.fixBatches[message.id]}
			<ConversationFixes ids={findingsStore.fixBatches[message.id]} />
		{:else if fixRequest && message.status !== 'streaming'}
			<!-- An earlier visit's fixes live on their findings. -->
			<p class="model-note-added">Fixes for {fixRequest === 'all' ? 'every open finding' : `${fixRequest.length} ${fixRequest.length === 1 ? 'finding' : 'findings'}`} are on the Findings tab.</p>
		{/if}
	{:else}
		<StreamingMarkdown content={message.text} streaming={message.status === 'streaming'} />
	{/if}
{/snippet}

{#snippet codeReference(context: ReviewCodeContext)}
	<CodeRef {context} />
{/snippet}

{#snippet headLabel(head: TraceHead)}
	{#if head.thought}<ThoughtLabel working={head.thought.working} time={head.thought.time} />{:else if head.status === 'running'}<span class="shimmer-text">{head.label}</span>{:else}{head.label}{/if}
{/snippet}

{#snippet traceRow(item: Trace)}
	{#if item.kind === 'tasks'}
		<ReviewTaskGroup tools={item.tools} {active} {now} />
	{:else}
		{@const head = traceHead(item)}
		{@const entry = item.entry}
		{@const live = thoughtLive(item.entry, item.until)}
		<Disclosure bodyClass="thought-body !gap-3" children={hasBody(item) ? thoughtText : undefined}>
			{#snippet label()}{@render headLabel(head)}{/snippet}
		</Disclosure>
		{#snippet thoughtText()}<StreamingMarkdown content={entry.text} streaming={live} />{/snippet}
	{/if}
{/snippet}

<div class="review-chat" data-compact={compact || undefined}>
<Conversation.Root class="min-h-0 w-full flex-1">
	<Conversation.Content aria-label={`${assignment.title} messages`} transcriptClass={compact ? '!max-w-[776px] !gap-3 !px-4 !pt-5 !pb-2' : 'review-transcript'} class="![scrollbar-gutter:auto]">
		{#if intro}{@render intro()}{/if}
		{#each rows as row (row.key)}
			{#if row.kind === 'insert'}
				{@render row.snippet()}
			{:else if row.kind === 'message'}
				{@const message = row.message}
				{@const index = row.index}
				<!-- A failure explains itself in a notice, so it gets no "Failed" label or empty reply. -->
				<Message.Root from={message.from} status={message.status === 'done' || message.failure ? 'idle' : message.status}
					class="[--font-weight-body:400]"
					name={message.forwardedFrom ? `${message.from === 'user' ? 'You →' : 'Reply from'} ${message.forwardedFrom}` : undefined}>
					{#if message.text.trim() || !message.failure}
						<Message.Content class={message.from === 'assistant' ? 'review-prose ai-voice' : message.from === 'user' ? 'review-bubble' : '!max-w-full text-sm'}>
							{@render response(message)}
						</Message.Content>
					{/if}
					{#if message.from === 'assistant' && message.status === 'streaming' && message.text.trim()}
						<span class="message-writing" role="status" aria-label="Still writing"><DotLoader /></span>
					{/if}
					{#if message.failure?.signIn && index !== lastSignInIndex}
						{#if message.status === 'error'}<Typography.Metadata class="text-fg-faint">Not answered: signed out of ChatGPT</Typography.Metadata>{/if}
					{:else if message.failure}
						<FailureNotice class="message-failure" title={message.failure.signIn ? 'Signed out of ChatGPT' : 'Reply failed'}
							reason={message.failure.reason} signIn={message.failure.signIn}
							onRetry={message.status === 'error' && message.discussion && !generating ? retryFor(index) : null} />
					{/if}
					<!-- The message's own actions (start the review) sit in it, above Copy and Retry. -->
					{#if onStartReview && !intro && !specialist && index === lastAssistantIndex && message.status !== 'streaming'}
						<div class="review-start-cta">
							<Button class="brief-action" loading={startingReview} onclick={() => void startReview()}>
								<Play size={12} fill="currentColor" aria-hidden="true" /> Run full review
							</Button>
						</div>
					{/if}
					{#if message.from === 'assistant' && message.status !== 'streaming' && message.text.trim() && (message.discussion || (index === lastAssistantIndex && !working))}
						{@const retry = message.discussion && !generating && !message.failure ? retryFor(index) : null}
						<Message.Actions class="message-actions">
							{#if retry}
								<Tooltip.Root placement="top" delay={750} closeDelay={80}>
									<Tooltip.Trigger class="flex">
										<Button variant="ghost" size="icon" aria-label="Retry" onclick={retry}><RotateCcw aria-hidden="true" /></Button>
									</Tooltip.Trigger>
									<Tooltip.Content>Retry</Tooltip.Content>
								</Tooltip.Root>
							{/if}
							<CopyAction text={stripModelNotes(message.text)} />
						</Message.Actions>
					{/if}
				</Message.Root>
			{:else if row.traces.length === 1}
				{@render traceRow(row.traces[0])}
			{:else}
				{@const traces = row.traces}
				{@const head = traceHead(traces[traces.length - 1])}
				<Disclosure status={head.status} bodyClass="!gap-3" children={traces.some(hasBody) ? foldedTraces : undefined}>
					{#snippet label()}{@render headLabel(head)}{/snippet}
				</Disclosure>
				{#snippet foldedTraces()}
					{#each traces as item (item.key)}{@render traceRow(item)}{/each}
				{/snippet}
			{/if}
		{/each}
		{#if specialist}
			{#if specialistStatus}
				<Typography.Text role="status" class="flex items-start gap-2 text-sm text-foreground-muted">
					{#if working}<Spinner size={14} class="mt-1 shrink-0" aria-hidden="true" />{/if}
					<span class="min-w-0 break-words">{specialistStatus}</span>
				</Typography.Text>
			{/if}
		{/if}
		{#if thinking}
			<Typography.Text role="status" class="review-thinking"><ThoughtLabel working time={elapsed(pendingSince)} /></Typography.Text>
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
		busy={working || conversationMessages.some((message) => message.status === 'streaming')}
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
			{:else}
				<ModelPicker
					value={modelSettingsUi.specialist}
					onSelect={(choice) => void modelSettingsUi.selectSpecialist(choice)}
					size={compact ? 'panel' : 'md'}
					label="Specialist model"
				/>
			{/if}
		{/snippet}
	</ReviewComposer>
	</div>
</div>
</div>
