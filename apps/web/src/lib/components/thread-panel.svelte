<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Paperclip from '@lucide/svelte/icons/paperclip';
	import X from '@lucide/svelte/icons/x';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as Conversation from '@sivir-ui/svelte/components/conversation';
	import * as DropdownMenu from '@sivir-ui/svelte/components/dropdown-menu';
	import { Markdown } from '@sivir-ui/svelte/components/markdown';
	import * as Message from '@sivir-ui/svelte/components/message';
	import { ResponseStream } from '@sivir-ui/svelte/components/response-stream';
	import Shortcut from '@sivir-ui/svelte/components/shortcut';
	import { Spinner } from '@sivir-ui/svelte/components/spinner';
	import SeverityPill from './severity-pill.svelte';
	import { SEVERITY_DOT, findingsStore } from '$lib/findings.svelte';
	import { serverApi } from '$lib/server-api';
	import { formatAgentName, threadsStore, type Thread } from '$lib/threads.svelte';

	const BASE_PARTICIPANTS = [
		'security',
		'perf',
		'correctness',
		'docs',
		'dedup',
		'patterns',
		'testing',
		'errors',
		'concurrency',
		'api'
	];

	let active = $state(BASE_PARTICIPANTS[0]);
	let draft = $state('');
	let attachedQuote = $state<string | null>(null);
	let selectionAvailable = $state(false);
	let sending = $state(false);
	let sendError = $state<string | null>(null);
	let inputEl: HTMLTextAreaElement | undefined = $state();

	const findingId = $derived(threadsStore.openId);
	const finding = $derived(findingsStore.items.find((f) => f.id === findingId));
	/** Collapse for the floating finding card. Reopens when switching threads. */
	let contextOpen = $state(true);
	$effect(() => {
		if (findingId) contextOpen = true;
	});

	// A card's "Suggest fix" queues a canned message; send it like typed text.
	$effect(() => {
		const pending = threadsStore.pendingMessage;
		if (!pending || pending.findingId !== findingId || composerBusy) return;
		threadsStore.pendingMessage = null;
		draft = pending.text;
		void send();
	});
	const participants = $derived(
		finding && !BASE_PARTICIPANTS.includes(finding.agent)
			? [...BASE_PARTICIPANTS, finding.agent]
			: BASE_PARTICIPANTS
	);
	const thread = $derived<Thread>(
		findingId
			? (threadsStore.get(findingId) ?? { findingId, messages: [] })
			: { findingId: '', messages: [] }
	);
	/** Composer locked while a reply streams. */
	const composerBusy = $derived(sending);

	function suggestViaChat(): void {
		if (!findingId || composerBusy) return;
		draft = 'Suggest a fix for this finding';
		void send();
	}

	function autoresize(): void {
		if (!inputEl) return;
		inputEl.style.height = 'auto';
		inputEl.style.height = `${Math.min(inputEl.scrollHeight, 120)}px`;
	}

	function onSelectionChange(): void {
		const selection = window.getSelection();
		const text = selection?.toString().trim() ?? '';
		if (!selection || selection.isCollapsed || text === '') {
			selectionAvailable = false;
			return;
		}
		const node = selection.anchorNode;
		const element = node instanceof Element ? node : node?.parentElement;
		const inDiff = Boolean(element?.closest?.('#diff-panel'));
		const inComposer = Boolean(element?.closest?.('[data-composer]'));
		selectionAvailable = inDiff && !inComposer;
	}

	function attachSelection(): void {
		const text = window.getSelection()?.toString().trim() ?? '';
		if (!text) return;
		attachedQuote = text;
		selectionAvailable = false;
		window.getSelection()?.removeAllRanges();
	}

	// Follow the finding's own reviewer when the thread changes.
	$effect(() => {
		const agent = finding?.agent;
		if (findingId && agent && participants.includes(agent)) {
			active = agent;
		}
	});

	async function send(): Promise<void> {
		if (!findingId || composerBusy) return;
		const body = draft.trim();
		if (!body) return;
		const quote = attachedQuote
			? `${attachedQuote.split('\n').map((line) => `> ${line}`).join('\n')}\n\n`
			: '';
		const question = `${quote}${body}`;
		const history = (threadsStore.get(findingId)?.messages ?? []).map((m) => ({
			role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
			body: m.body
		}));
		threadsStore.send(findingId, question);
		draft = '';
		attachedQuote = null;
		sendError = null;
		if (inputEl) inputEl.style.height = 'auto';

		// Local-only demo threads have no backend review to answer.
		const reviewId = threadsStore.reviewId;
		if (!reviewId || !finding) return;
		sending = true;
		const replyAuthor = active;
		const placeholderId = threadsStore.beginReply(findingId, replyAuthor);
		const payload = {
			agent: active,
			finding: {
				file: finding.file,
				line: finding.startLine,
				endLine: finding.endLine,
				severity: finding.severity,
				message: finding.body,
				agent: finding.agent
			},
			history,
			question
		};
		const push = (text: string) => threadsStore.appendReply(findingId, placeholderId, text);
		const streamedSoFar = (): string =>
			threadsStore.get(findingId)?.messages.find((m) => m.id === placeholderId)?.body.trim() ?? '';
		try {
			try {
				const result = await serverApi.discussStream(reviewId, payload, push);
				threadsStore.finishReply(findingId, placeholderId, result.agent, result.model);
			} catch (e) {
				// Nothing arrived — likely transient (model hiccup, dropped stream).
				// Retry once before giving up; a partial reply is kept as-is.
				if (streamedSoFar() !== '') throw e;
				const result = await serverApi.discussStream(reviewId, payload, push);
				threadsStore.finishReply(findingId, placeholderId, result.agent, result.model);
			}
		} catch (e) {
			if (streamedSoFar() !== '') {
				threadsStore.finishReply(findingId, placeholderId);
			} else {
				threadsStore.dropReply(findingId, placeholderId);
			}
			sendError = e instanceof Error ? e.message : 'The reviewer did not respond.';
		} finally {
			sending = false;
		}
	}

	$effect(() => {
		document.addEventListener('selectionchange', onSelectionChange);
		return () => document.removeEventListener('selectionchange', onSelectionChange);
	});

	function onKeydown(event: KeyboardEvent): void {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			send();
		}
	}
</script>

	<section
		aria-label="Finding thread"
		class="relative flex min-h-0 w-[440px] shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-background xl:w-[520px]"
	>
		<div class="flex h-11 w-full shrink-0 items-center gap-2 border-b border-border px-4">
			{#if finding}
				<SeverityPill severity={finding.severity} />
				<span class="font-mono text-[13px] font-semibold">{finding.code}</span>
				<span class="min-w-0 flex-1 truncate font-mono text-[12px] text-foreground-muted">
					{formatAgentName(finding.agent)}{finding.model ? ` · ${finding.model}` : ''}
				</span>
				<Button
					variant="ghost"
					size="icon"
					class="-mr-2"
					aria-label={contextOpen ? 'Collapse finding card' : 'Expand finding card'}
					onclick={() => (contextOpen = !contextOpen)}
				>
					<ChevronDown size={15} class="transition-transform {contextOpen ? '' : '-rotate-90'}" />
				</Button>
			{:else}
				<span class="text-[15px] font-medium">Discussion</span>
			{/if}
		</div>

		{#if finding && contextOpen}
			<div
				class="mx-3 mt-3 shrink-0 rounded-xl border border-border bg-card p-3"
				aria-label="Finding context"
			>
				<p
					class="m-0 flex items-center gap-1.5 font-mono text-[13px]"
					style:color={SEVERITY_DOT[finding.severity]}
				>
					<span
						class="h-1.5 w-1.5 shrink-0 rounded-full"
						style:background-color={SEVERITY_DOT[finding.severity]}
					></span>
					<span class="truncate">{finding.file}:{finding.startLine}</span>
				</p>
				<div class="mt-1.5 min-w-0">
					<Markdown content={finding.body} />
				</div>
				{#if finding.status !== 'open'}
					<div class="mt-2 flex items-center gap-2">
						{#if finding.status === 'accepted'}
							<span
								class="rounded bg-success/15 px-1.5 py-0.5 font-sans text-[13px] font-semibold text-success"
							>
								Fixed
							</span>
							{#if finding.fixedBy}
								<span class="font-mono text-[12px] text-foreground-muted">
									· {formatAgentName(finding.fixedBy)}
								</span>
							{/if}
						{:else}
							<span class="font-mono text-[13px] text-foreground-muted">Dismissed</span>
						{/if}
						<Button
							variant="ghost"
							size="sm"
							class="font-sans text-[14px]"
							onclick={() => findingsStore.reopen(finding.id)}
						>
							Undo
						</Button>
					</div>
				{/if}
			</div>
		{/if}

		<Conversation.Root class="min-h-0 w-full flex-1">
			<Conversation.Content
				aria-label="Thread messages"
				transcriptClass="flex flex-col gap-4 p-4"
			>
				{#each thread.messages as message (message.id)}
					{#if message.role === 'agent'}
						<div class="message-in">
							<Message.Root from="assistant" status={message.streaming ? 'streaming' : 'idle'}>
								<Message.Content>
									{#if message.streaming}
										<ResponseStream textStream={message.body} streaming class="font-normal" />
									{:else}
										<Markdown content={message.body} />
									{/if}
								</Message.Content>
							</Message.Root>
						</div>
					{:else}
						<div class="message-in">
							<Message.Root from="user">
								<Message.Content>
									<Markdown content={message.body} />
								</Message.Content>
							</Message.Root>
						</div>
					{/if}
				{:else}
					{#if finding}
						<Conversation.Empty
							title="No replies yet"
							description="Ask {formatAgentName(active)} about this finding below."
						/>
					{:else}
						<Conversation.Empty title="Select a finding" />
					{/if}
				{/each}
			</Conversation.Content>
			<Conversation.ScrollButton />
		</Conversation.Root>

		<div class="w-full shrink-0 p-3">
			<div data-composer class="rounded-xl border border-border bg-background p-3">
			<textarea
				bind:this={inputEl}
				bind:value={draft}
				oninput={autoresize}
				onkeydown={onKeydown}
				rows={3}
				placeholder={finding
					? `Ask ${formatAgentName(active)} about this finding…`
					: 'Select a finding'}
				aria-label={finding ? 'Ask about this finding' : 'Select a finding'}
				disabled={composerBusy || !finding}
				class="max-h-[120px] w-full resize-none rounded-lg bg-secondary px-2.5 py-2 text-[14px] leading-relaxed outline-none placeholder:text-foreground-muted/70 disabled:opacity-60"
			></textarea>
			{#if sendError}
				<p class="mt-2 text-[13px] font-medium text-error" role="alert">{sendError}</p>
			{/if}
			<div class="mt-2 flex items-center gap-1">
					<DropdownMenu.Root>
						<DropdownMenu.Trigger
							variant="ghost"
							size="sm"
							class="h-9 gap-1.5 font-sans text-[13px] transition-[width]"
							style="interpolate-size: allow-keywords"
							aria-label="Choose agent"
						>
							{formatAgentName(active)}
							<ChevronDown size={12} class="text-foreground-muted" />
						</DropdownMenu.Trigger>
						<DropdownMenu.Content class="min-w-[12rem]">
							<DropdownMenu.Label>Model</DropdownMenu.Label>
							{#each participants as participant (participant)}
								<DropdownMenu.Item callback={() => (active = participant)}>
									<span class="flex-1">{formatAgentName(participant)}</span>
									{#if active === participant}
										<Check size={13} class="text-primary" />
									{/if}
								</DropdownMenu.Item>
							{/each}
						</DropdownMenu.Content>
					</DropdownMenu.Root>
					{#if attachedQuote}
						<button
							type="button"
							onclick={() => (attachedQuote = null)}
							title="Remove attached code"
							class="flex max-w-[12rem] items-center gap-1.5 rounded-md border border-border bg-secondary px-2 py-1.5 font-mono text-[12px] text-foreground-muted transition-colors hover:text-foreground"
						>
							<span class="truncate">{attachedQuote.split('\n')[0].slice(0, 32)}</span>
							<X size={12} class="shrink-0" />
						</button>
					{:else if selectionAvailable}
						<button
							type="button"
							onclick={attachSelection}
							class="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] text-foreground-muted transition-colors hover:text-foreground"
						>
							<Paperclip size={13} />
							Attach selection
						</button>
					{/if}
					<Button
						variant="ghost"
						size="sm"
						class="h-9 font-sans text-[13px]"
						disabled={composerBusy || !threadsStore.reviewId}
						title={threadsStore.reviewId
							? 'Ask for a fix in chat'
							: 'Needs a backend review'}
						onclick={() => suggestViaChat()}
					>
						Suggest fix
					</Button>
					<Button
						variant="primary"
						size="sm"
						class="ml-auto h-9"
						disabled={!finding || !draft.trim() || composerBusy}
						aria-label={sending ? 'Sending' : 'Send'}
						onclick={() => void send()}
					>
						{#if sending}
							<Spinner size={14} />
						{:else}
							Send
							<Shortcut shortcut="enter" />
						{/if}
				</Button>
			</div>
			</div>
		</div>
	</section>
