<script lang="ts">
	import { ORCHESTRATOR_ID, type ReviewAssignment, type ReviewCodeContext } from '@recoder/shared';
	import X from '@lucide/svelte/icons/x';
	import { Button } from '@sivir-ui/svelte/components/button';
	import { Input } from '@sivir-ui/svelte/components/input';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import ReviewComposer from './review-composer.svelte';
	import { attachmentText, MESSAGE_LIMIT } from '$lib/review/attachment';
	import { formatAgentName } from '$lib/findings/threads.svelte';
	import { fileIconUrl } from '$lib/diff/material-icons';

	/** The composer under a review conversation: sends, stops a reply or the review, and attaches files or code. */
	let {
		assignment,
		draft = $bindable(''),
		codeContext = $bindable(null),
		compact,
		focusKey,
		onSend,
		onStop,
		onStopReview,
		placeholder,
		awaitingPrompt,
		generating,
		working,
		streaming
	}: {
		assignment: ReviewAssignment;
		draft?: string;
		codeContext?: ReviewCodeContext | null;
		compact: boolean;
		/** Bumped to focus the composer. */
		focusKey?: number;
		onSend?: (id: string, text: string, context?: ReviewCodeContext) => Promise<void>;
		onStop?: (id: string) => Promise<void>;
		/** Stops the whole review while it runs; Send becomes Stop when nothing is typed. */
		onStopReview: (() => Promise<void>) | null;
		placeholder?: string;
		awaitingPrompt: boolean;
		/** A discussion reply is streaming. */
		generating: boolean;
		/** The specialist behind this conversation is still running. */
		working: boolean;
		/** Any message in this conversation is streaming. */
		streaming: boolean;
	} = $props();

	const specialist = $derived(assignment.id !== ORCHESTRATOR_ID);
	const errorId = $props.id();

	let sending = $state(false);
	let stopping = $state(false);
	let stoppingReview = $state(false);
	let error = $state('');
	let composerInput = $state<HTMLTextAreaElement>();

	/** Hidden file picker. Never write a filename back: Sivir 0.3.2 also binds value on file inputs. */
	let fileInput = $state<HTMLInputElement>();

	/**
	 * Sent, but the streaming reply hasn't reached this page yet. Send is Stop
	 * from the click until the reply finishes, with no gap in between.
	 */
	let awaitingReply = $state(false);

	/** Stop was pressed while the message was still on its way; stop the reply once it exists. */
	let stopAfterSend = false;
	let awaitTimer: ReturnType<typeof setTimeout> | undefined;

	$effect(() => {
		if (focusKey !== undefined && composerInput) composerInput.focus({ preventScroll: true });
	});

	$effect(() => {
		if (generating) awaitingReply = false;
	});

	const replying = $derived(sending || awaitingReply || generating);

	/** No reply in flight and nothing typed: the composer's Stop stops the review itself. */
	const stopsReview = $derived(!!onStopReview && !replying && !draft.trim());

	async function attachFile(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];

		if (!file) return;
		error = '';

		try {
			const context = await attachmentText(file);

			if (draft.length + context.length > MESSAGE_LIMIT)
				throw new Error('This file exceeds the 8,000-character message limit. Attach a smaller excerpt.');
			draft += context;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Could not read the file.';
		} finally {
			input.value = '';
		}
	}

	async function stopReview(): Promise<void> {
		if (stoppingReview || !onStopReview) return;
		stoppingReview = true;

		try {
			await onStopReview();
		} finally {
			stoppingReview = false;
		}
	}

	async function send(value: string) {
		if (!onSend || replying || !value.trim()) return;

		if (value.trim().length > MESSAGE_LIMIT) {
			error = 'Keep your message under 8,000 characters.';

			return;
		}

		sending = true;
		stopAfterSend = false;
		error = '';

		const selection = codeContext;

		try {
			await onSend(assignment.id, value.trim(), selection ?? undefined);
			draft = '';
			if (codeContext === selection) codeContext = null;
			awaitingReply = true;
			clearTimeout(awaitTimer);

			awaitTimer = setTimeout(() => {
				awaitingReply = false;
			}, 15_000);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Message could not be sent.';
		} finally {
			sending = false;
		}

		if (stopAfterSend) {
			stopAfterSend = false;
			void stop();
		}
	}

	async function stop() {
		if (sending) {
			stopAfterSend = true;

			return;
		}

		awaitingReply = false;
		if (stopping) return;
		stopping = true;
		error = '';

		try {
			await onStop?.(assignment.id);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Could not stop the reply.';
		} finally {
			stopping = false;
		}
	}
</script>

<div class={compact ? 'mx-auto w-full max-w-[776px] shrink-0 px-3 pb-3 pt-3' : 'review-dock'}>
	<div class="review-dock-inner">
		{#if error}<Typography.Text id={errorId} role="alert" class="mb-2 text-sm text-error">{error}</Typography.Text>{/if}
		<div hidden>
			<Input
				type="file"
				bind:value={() => '', () => {}}
				bind:element={fileInput}
				aria-label="Attach a text file"
				onchange={attachFile}
			/>
		</div>
		<ReviewComposer
			bind:value={draft}
			bind:inputEl={composerInput}
			size={compact ? 'panel' : 'main'}
			label={`Message ${assignment.title}`}
			placeholder={codeContext
				? 'Ask about this code…'
				: (placeholder ??
					(awaitingPrompt
						? 'Ask Orchestrator to start a review…'
						: `Ask ${specialist ? formatAgentName(assignment.role) : assignment.title} anything…`))}
			maxlength={MESSAGE_LIMIT}
			describedBy={error ? errorId : undefined}
			invalid={!!error}
			{sending}
			generating={replying || stopsReview}
			busy={working || stoppingReview || streaming}
			disabled={!onSend && !stopsReview}
			onSubmit={send}
			onStop={stopsReview ? stopReview : onStop ? stop : undefined}
			onAttach={() => fileInput?.click()}
			attachLabel="Attach a text file"
			oninput={() => (error = '')}
		>
			{#snippet context()}
				{#if codeContext}
					{@const name = codeContext.file.split('/').at(-1) ?? codeContext.file}
					<span class="composer-quote" title="{codeContext.file}{codeContext.side === 'old' ? ' (before)' : ''}">
						<img src={fileIconUrl(name)} alt="" width="14" height="14" class="composer-quote-icon" />
						<span class="min-w-0 truncate"
							>{name}:{codeContext.startLine}{codeContext.endLine !== codeContext.startLine
								? `–${codeContext.endLine}`
								: ''}</span
						>
						<Button
							variant="ghost"
							size="icon"
							class="composer-quote-remove"
							aria-label="Remove selected code"
							disabled={sending}
							onclick={() => (codeContext = null)}><X size={12} aria-hidden="true" /></Button
						>
					</span>
				{/if}
			{/snippet}
			{#snippet leading()}
				{#if specialist}<Typography.Metadata class="truncate text-[12px] text-fg-faint"
						>Shared with Orchestrator</Typography.Metadata
					>{/if}
			{/snippet}
		</ReviewComposer>
	</div>
</div>
