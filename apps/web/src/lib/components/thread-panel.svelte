<script lang="ts">
	import { tick } from 'svelte';
	import Check from '@lucide/svelte/icons/check';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Paperclip from '@lucide/svelte/icons/paperclip';
	import X from '@lucide/svelte/icons/x';
	import { Button } from '@sivir-ui/svelte/components/button';
	import { Badge } from '@sivir-ui/svelte/components/badge';
	import * as Card from '@sivir-ui/svelte/components/card';
	import * as Composer from '@sivir-ui/svelte/components/composer';
	import * as Conversation from '@sivir-ui/svelte/components/conversation';
	import * as DropdownMenu from '@sivir-ui/svelte/components/dropdown-menu';
	import { Markdown } from '@sivir-ui/svelte/components/markdown';
	import * as Message from '@sivir-ui/svelte/components/message';
	import { ResponseStream } from '@sivir-ui/svelte/components/response-stream';
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
	let returnFocus: HTMLElement | null = null;
	$effect(() => {
		if (!inputEl) return;
		returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		inputEl.focus({ preventScroll: true });
	});

	async function close(): Promise<void> {
		threadsStore.close();
		await tick();
		if (returnFocus?.isConnected) returnFocus.focus();
	}

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
	const composerBusy = $derived(sending || thread.messages.some((message) => message.streaming));

	function suggestViaChat(): void {
		if (!findingId || composerBusy) return;
		draft = 'Suggest a fix for this finding';
		void send();
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
		// Keep stream callbacks on this finding even if the panel closes or switches.
		const findingId = threadsStore.openId;
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

</script>

	<svelte:window onkeydown={(event) => {
		// Let the agent menu consume Escape before closing its parent panel.
		if (event.key === 'Escape' && !event.defaultPrevented &&
			document.activeElement?.closest('#finding-thread')) {
			event.preventDefault();
			void close();
		}
	}} />

	<section
		id="finding-thread"
		aria-label="Finding discussion"
		class="thread-panel-enter relative min-h-0 min-w-0 w-full xl:w-[440px] xl:shrink-0 2xl:w-[520px]"
	>
	<Card.Root class="h-full overflow-hidden bg-background p-0">
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
					aria-expanded={contextOpen}
					onclick={() => (contextOpen = !contextOpen)}
				>
					<ChevronDown size={15} class="motion-safe:transition-transform {contextOpen ? '' : '-rotate-90'}" />
				</Button>
			{:else}
				<span class="text-[15px] font-medium">Discussion</span>
			{/if}
			<Button
				variant="ghost"
				size="icon"
				class="ml-auto shrink-0"
				aria-label="Close discussion"
				onclick={() => void close()}
			>
				<X size={16} aria-hidden="true" />
			</Button>
		</div>

		{#if finding && contextOpen}
			<div class="mx-3 mt-3 max-h-[30%] shrink-0" aria-label="Finding context">
			<Card.Root class="max-h-full overflow-y-auto p-3">
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
							<Badge variant="success">Fixed</Badge>
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
							class="font-sans text-[14px]"
							onclick={() => findingsStore.reopen(finding.id)}
						>
							Undo
						</Button>
					</div>
				{/if}
			</Card.Root>
			</div>
		{/if}

		<Conversation.Root class="min-h-0 w-full flex-1">
			<Conversation.Content
				aria-label="Thread messages"
				transcriptClass="flex flex-col gap-4 p-4"
			>
				{#each thread.messages as message (message.id)}
					{#if message.role === 'agent'}
						<Message.Root from="assistant" status={message.streaming ? 'streaming' : 'idle'}>
								<Message.Content>
									{#if message.streaming}
										<ResponseStream textStream={message.body} streaming class="font-normal" />
									{:else}
										<Markdown content={message.body} />
									{/if}
								</Message.Content>
						</Message.Root>
					{:else}
						<Message.Root from="user">
								<Message.Content>
									<Markdown content={message.body} />
								</Message.Content>
						</Message.Root>
					{/if}
				{:else}
					{#if finding}
						<Conversation.Empty title="No replies yet" description="" />
					{:else}
						<Conversation.Empty title="Select a finding" description="" />
					{/if}
				{/each}
			</Conversation.Content>
			<Conversation.ScrollButton />
		</Conversation.Root>

		<Composer.Root
			data-composer
			class="m-3 shrink-0"
			bind:value={draft}
			status={sendError ? 'error' : sending ? 'submitting' : 'idle'}
			disabled={composerBusy || !finding}
			onSubmit={() => send()}
		>
			<Composer.Input
				bind:element={inputEl}
				rows={2}
				name="discussion"
				placeholder={finding
					? `Ask ${formatAgentName(active)} about this finding…`
					: 'Select a finding'}
				aria-label={finding ? 'Ask about this finding' : 'Select a finding'}
				class="min-h-16 max-h-[120px] text-base sm:text-[14px]"
			/>
			{#if sendError}
				<p class="break-words px-2 text-[13px] font-medium text-error" role="alert">{sendError}</p>
			{/if}
			{#if attachedQuote || selectionAvailable}
				<div class="flex min-w-0">
					{#if attachedQuote}
						<Button
							variant="secondary"
							size="sm"
							onclick={() => (attachedQuote = null)}
							aria-label="Remove attached code"
							class="min-w-0 max-w-full gap-1.5 font-mono text-[12px]"
						>
							<span class="truncate">{attachedQuote.split('\n')[0].slice(0, 32)}</span>
							<X size={12} class="shrink-0" aria-hidden="true" />
						</Button>
					{:else}
						<Button variant="ghost" size="sm" onclick={attachSelection}>
							<Paperclip size={13} aria-hidden="true" />
							Attach selection
						</Button>
					{/if}
				</div>
			{/if}
			<Composer.Toolbar variant="inset">
					<DropdownMenu.Root>
						<DropdownMenu.Trigger
							variant="ghost"
							size="sm"
							class="h-9 min-w-0 max-w-full gap-1.5 font-sans text-[13px]"
							aria-label={`Choose agent: ${formatAgentName(active)}`}
						>
							<span class="truncate">{formatAgentName(active)}</span>
							<ChevronDown size={12} class="shrink-0 text-foreground-muted" aria-hidden="true" />
						</DropdownMenu.Trigger>
						<DropdownMenu.Content class="min-w-[12rem]">
							<DropdownMenu.Label>Reviewer</DropdownMenu.Label>
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
					<div class="ml-auto flex shrink-0 items-center gap-1.5">
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
					<Composer.Submit
						class="h-9 min-w-16"
						disabled={!finding || composerBusy}
						loadingLabel="Sending"
					/>
				</div>
			</Composer.Toolbar>
		</Composer.Root>
	</Card.Root>
	</section>
