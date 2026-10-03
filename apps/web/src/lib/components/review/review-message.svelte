<script lang="ts">
	import type { ReviewChatMessage } from '@recoder/shared';
	import Play from '@lucide/svelte/icons/play';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as Message from '@sivir-ui/svelte/components/message';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import DotLoader from '../ui/dot-loader.svelte';
	import CodeRef from '../findings/code-ref.svelte';
	import ConversationFixes from '../findings/conversation-fixes.svelte';
	import FailureNotice from './failure-notice.svelte';
	import StreamingMarkdown from './streaming-markdown.svelte';
	import { findingsStore } from '$lib/findings/findings.svelte';
	import { parseFixRequest, parseModelNotes, stripModelNotes } from '$lib/review/model-notes';

	/**
	 * One chat message in a review transcript. A failure explains itself in a notice or a note, so
	 * it gets no "Failed" label or empty reply; a reply that stopped partway says why.
	 */
	let {
		message,
		quietSignIn,
		quietUsage,
		onRetry,
		startingReview,
		onStartReview
	}: {
		message: ReviewChatMessage;
		/** A later message already carries the sign-in notice; this one only notes it went unanswered. */
		quietSignIn: boolean;
		/** A later message already carries the usage-limit notice. */
		quietUsage: boolean;
		/** Re-asks the question that led to this reply. */
		onRetry: (() => void) | null;
		startingReview: boolean;
		/** The message's own action: the orchestrator's latest reply offers the full review. */
		onStartReview: (() => void) | null;
	} = $props();
</script>

{#snippet response()}
	{#if message.codeContext}
		<CodeRef context={message.codeContext} />
	{/if}
	{#if message.from === 'assistant' && (message.text.includes('```recoder-note') || message.text.includes('```recoder-fix'))}
		{@const fixRequest = parseFixRequest(message.text)}
		<StreamingMarkdown content={stripModelNotes(message.text)} streaming={message.status === 'streaming'} />
		{#each parseModelNotes(message.text) as note, i (i)}
			<p class="model-note-added">
				Added a note on <span class="font-mono"
					>{note.file.split('/').at(-1)}:{note.startLine}{note.endLine !== note.startLine
						? `–${note.endLine}`
						: ''}</span
				>
			</p>
		{/each}
		{#if findingsStore.fixBatches[message.id]}
			<ConversationFixes ids={findingsStore.fixBatches[message.id]} />
		{:else if fixRequest && message.status !== 'streaming'}
			<p class="model-note-added">
				Fixes for {fixRequest === 'all'
					? 'every open finding'
					: `${fixRequest.length} ${fixRequest.length === 1 ? 'finding' : 'findings'}`} are on the Findings tab.
			</p>
		{/if}
	{:else}
		<StreamingMarkdown
			content={message.text}
			streaming={message.status === 'streaming'}
			normalize={message.from === 'assistant'}
		/>
	{/if}
{/snippet}

<Message.Root
	from={message.from}
	status={message.status === 'streaming' ? 'streaming' : 'idle'}
	class="[--font-weight-body:400]"
	name={message.forwardedFrom
		? `${message.from === 'user' ? 'You →' : 'Reply from'} ${message.forwardedFrom}`
		: undefined}
>
	{#if message.text.trim() || !message.failure}
		<Message.Content
			class={message.from === 'assistant'
				? 'review-prose'
				: message.from === 'user'
					? 'review-bubble'
					: '!max-w-full text-sm'}
		>
			{@render response()}
		</Message.Content>
	{/if}
	{#if message.from === 'assistant' && message.status === 'streaming' && message.text.trim()}
		<span class="message-writing" role="status" aria-label="Still writing"><DotLoader /></span>
	{/if}
	{#if message.failure?.signIn && quietSignIn}
		{#if message.status === 'error'}<Typography.Metadata class="text-fg-faint"
				>Not answered: signed out of ChatGPT</Typography.Metadata
			>{/if}
	{:else if message.failure?.usageLimit && quietUsage}
		{#if message.status === 'error'}<Typography.Metadata class="text-fg-faint"
				>Not answered: {message.failure.usageLimit.name} was out of usage</Typography.Metadata
			>{/if}
	{:else if message.failure}
		<FailureNotice
			class="message-failure"
			title={message.failure.signIn ? 'Signed out of ChatGPT' : 'Reply failed'}
			reason={message.failure.reason}
			signIn={message.failure.signIn}
			usageLimit={message.failure.usageLimit}
			{onRetry}
		/>
	{:else if message.status === 'error' && message.from === 'assistant'}
		<Typography.Metadata class="message-cut-off">
			{#if message.cutOff}<RotateCcw size={12} class="message-cut-off-icon" aria-hidden="true" />{:else}<CircleAlert
					size={12}
					class="message-cut-off-icon"
					aria-hidden="true"
				/>{/if}
			<span
				><span class="message-cut-off-title">Reply cut off.</span>
				{message.cutOff ?? 'The model stopped before it finished this reply.'}</span
			>
		</Typography.Metadata>
	{/if}
	{#if onStartReview}
		<div class="review-start-cta">
			<Button class="brief-action" loading={startingReview} onclick={onStartReview}>
				<Play size={12} fill="currentColor" aria-hidden="true" /> Run full review
			</Button>
		</div>
	{/if}
</Message.Root>
