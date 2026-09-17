<script lang="ts">
	import { ORCHESTRATOR_ID, type ReviewAssignment, type ReviewChatMessage, type ReviewReasoningEntry, type ReviewTask, type ReviewToolCall } from '@recoder/shared';
	import * as Composer from '@sivir-ui/svelte/components/composer';
	import * as Conversation from '@sivir-ui/svelte/components/conversation';
	import * as Message from '@sivir-ui/svelte/components/message';
	import * as Card from '@sivir-ui/svelte/components/card';
	import { Markdown } from '@sivir-ui/svelte/components/markdown';
	import { ResponseStream } from '@sivir-ui/svelte/components/response-stream';
	import { Spinner } from '@sivir-ui/svelte/components/spinner';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import ReviewTaskGroup from './review-task-group.svelte';
	import { groupTranscript } from '$lib/review-transcript';

	let { assignment, messages, reasoning, toolCalls, tasks, active, now, draft = $bindable(''), onSend, onStop }: {
		assignment: ReviewAssignment;
		messages: ReviewChatMessage[];
		reasoning: ReviewReasoningEntry[];
		toolCalls: ReviewToolCall[];
		tasks: ReviewTask[];
		active: boolean;
		now: number;
		draft?: string;
		onSend?: (id: string, text: string) => Promise<void>;
		onStop?: (id: string) => Promise<void>;
	} = $props();
	const belongs = (id?: string) => (id ?? ORCHESTRATOR_ID) === assignment.id;
	const conversationMessages = $derived(messages.filter((message) => belongs(message.assignmentId)));
	const conversationReasoning = $derived(reasoning.filter((entry) => belongs(entry.assignmentId)));
	const generating = $derived(conversationMessages.some((message) => message.discussion && !message.forwardedFrom && message.status === 'streaming'));
	const conversationTools = $derived(toolCalls.filter((tool) => belongs(tool.assignmentId)));
	const entries = $derived(groupTranscript(conversationMessages, conversationTools));
	const thinking = $derived(
		!conversationMessages.some((message) => !message.forwardedFrom && message.status === 'streaming' && message.text.trim()) &&
		!conversationTools.some((tool) => tool.status === 'running' && active) &&
		(generating || (active && (conversationReasoning.some((entry) => entry.status === 'streaming') ||
			tasks.some((task) => task.status === 'running' && ['model', 'planning', 'consolidation'].includes(task.kind ?? '')))))
	);
	let sending = $state(false);
	let error = $state('');
	async function send(value: string) {
		if (!onSend || sending || generating || !value.trim()) return;
		sending = true;
		error = '';
		try { await onSend(assignment.id, value.trim()); draft = ''; }
		catch (cause) { error = cause instanceof Error ? cause.message : 'Message could not be sent.'; }
		finally { sending = false; }
	}
	async function stop() {
		try { await onStop?.(assignment.id); }
		catch (cause) { error = cause instanceof Error ? cause.message : 'Could not stop the reply.'; }
	}
</script>

{#snippet response(message: ReviewChatMessage)}
	{#if message.status === 'streaming' && !/[\n*#`\[>_]/.test(message.text)}
		<ResponseStream textStream={message.text} streaming speed={100} class="font-normal leading-relaxed" />
	{:else}<Markdown content={message.text} streaming={message.status === 'streaming'} />{/if}
{/snippet}

<Conversation.Root class="mx-auto min-h-0 w-full max-w-3xl flex-1">
	<Conversation.Content aria-label={`${assignment.title} messages`} transcriptClass="!max-w-none !gap-4">
		{#each entries as item (item.kind + item.id)}
			{#if item.kind === 'message'}
				{@const message = item.message}
				<Message.Root from={message.from} status={message.status === 'done' ? 'idle' : message.status}
					class="[--font-weight-body:400]"
					name={message.forwardedFrom ? `${message.from === 'user' ? 'You →' : 'Reply from'} ${message.forwardedFrom}` : undefined}>
					<Message.Content>
						{#if message.from === 'assistant'}
							<Card.Root class="w-full !p-4"><Card.Content>{@render response(message)}</Card.Content></Card.Root>
						{:else}{@render response(message)}{/if}
					</Message.Content>
				</Message.Root>
			{:else}
				<ReviewTaskGroup tools={item.tools} {active} {now} />
			{/if}
		{:else}
			<Conversation.Empty title={active ? assignment.id === ORCHESTRATOR_ID ? 'Preparing the review' : 'Waiting for this specialist' : 'Start a conversation'} description="" />
		{/each}
		{#if thinking}
			<Typography.Text role="status" class="flex items-center gap-2 px-1 text-sm text-foreground-muted"><Spinner size={14} aria-hidden="true" />Thinking</Typography.Text>
		{/if}
	</Conversation.Content>
	<Conversation.ScrollButton />
</Conversation.Root>

<div class="mx-auto w-full max-w-3xl shrink-0 px-4 pb-4 pt-3 sm:px-6">
	{#if error}<Typography.Text role="alert" class="mb-2 text-sm text-error">{error}</Typography.Text>{/if}
	<Composer.Root bind:value={draft} onSubmit={send} onStop={stop} {generating} status={sending ? 'submitting' : error ? 'error' : 'idle'} disabled={!onSend}>
		<Composer.Input aria-label={`Message ${assignment.title}`} placeholder={`Message ${assignment.title.toLowerCase()}…`} maxlength={8000} disabled={sending || generating || !onSend} />
		<Composer.Toolbar>
			<Composer.Actions>
				{#if assignment.id !== ORCHESTRATOR_ID}<Typography.Metadata>Shared with orchestrator</Typography.Metadata>{/if}
			</Composer.Actions>
			<Composer.Submit />
		</Composer.Toolbar>
	</Composer.Root>
</div>
