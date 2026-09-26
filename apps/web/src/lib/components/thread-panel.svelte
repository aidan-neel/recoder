<script lang="ts">
	import { tick } from 'svelte';
	import Check from '@lucide/svelte/icons/check';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import X from '@lucide/svelte/icons/x';
	import { Button } from '@sivir-ui/svelte/components/button';
	import { Badge } from '@sivir-ui/svelte/components/badge';
	import * as Card from '@sivir-ui/svelte/components/card';
	import * as Conversation from '@sivir-ui/svelte/components/conversation';
	import * as DropdownMenu from '@sivir-ui/svelte/components/dropdown-menu';
	import { Markdown } from '@sivir-ui/svelte/components/markdown';
	import * as Message from '@sivir-ui/svelte/components/message';
	import { ResponseStream } from '@sivir-ui/svelte/components/response-stream';
	import { ScrollArea } from '@sivir-ui/svelte/components/scroll-area';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import ModelPicker from './model-picker.svelte';
	import ReviewComposer from './review-composer.svelte';
	import { MODEL_ROLES, modelSettingsUi } from '$lib/model-settings.svelte';
	import type { ReviewRole } from '@recoder/shared';
	import { findingsStore } from '$lib/findings.svelte';
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
	let replyController = $state<AbortController | null>(null);
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
		const controller = new AbortController();
		replyController = controller;
		try {
			try {
				const result = await serverApi.discussStream(reviewId, payload, push, controller.signal);
				threadsStore.finishReply(findingId, placeholderId, result.agent, result.model);
			} catch (e) {
				// Nothing arrived — likely transient (model hiccup, dropped stream).
				// Retry once before giving up; a partial reply is kept as-is.
				if (controller.signal.aborted || streamedSoFar() !== '') throw e;
				const result = await serverApi.discussStream(reviewId, payload, push, controller.signal);
				threadsStore.finishReply(findingId, placeholderId, result.agent, result.model);
			}
		} catch (e) {
			if (streamedSoFar() !== '') {
				threadsStore.finishReply(findingId, placeholderId);
			} else {
				threadsStore.dropReply(findingId, placeholderId);
			}
			if (!controller.signal.aborted) sendError = e instanceof Error ? e.message : 'The reviewer did not respond.';
		} finally {
			sending = false;
			if (replyController === controller) replyController = null;
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
		class="thread-panel-enter relative min-h-0 min-w-0 w-full xl:w-[400px] xl:shrink-0 2xl:w-[440px]"
	>
	<Card.Root class="h-full !gap-0 overflow-hidden rounded-none border-0 border-s border-border-subtle bg-background !p-0 shadow-none">
		<div class="flex min-h-12 w-full shrink-0 items-center gap-2 border-b border-border-subtle px-4">
			{#if finding}
				<!-- No visible title: the finding card below names it. Kept for screen readers. -->
				<Typography.Title level={2} class="sr-only">{finding.title}</Typography.Title>
				<Button
					variant="ghost"
					size="icon"
					class="ml-auto -mr-2"
					aria-label={contextOpen ? 'Collapse finding card' : 'Expand finding card'}
					aria-expanded={contextOpen}
					onclick={() => (contextOpen = !contextOpen)}
				>
					<ChevronDown size={15} class="motion-safe:transition-transform {contextOpen ? '' : '-rotate-90'}" />
				</Button>
			{:else}
				<Typography.Title level={2} class="sr-only">Discussion</Typography.Title>
			{/if}
			<Button
				variant="ghost"
				size="icon"
				class="{finding ? '' : 'ml-auto'} shrink-0"
				aria-label="Close discussion"
				onclick={() => void close()}
			>
				<X size={16} aria-hidden="true" />
			</Button>
		</div>

		{#if finding && contextOpen}
			<div class="mx-4 mt-3 shrink-0 border-b border-border-subtle pb-3">
			<ScrollArea showCues={false} style="max-height: min(14rem, 28dvh)" aria-label="Finding context">
				<Typography.Metadata class="flex items-center gap-1.5 font-mono text-xs">
					<span class="truncate">{finding.file}:{finding.startLine}</span>
				</Typography.Metadata>
				<div class="mt-2 min-w-0 text-sm">
					<Markdown content={finding.body} class="text-sm" />
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
			</ScrollArea>
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

		<div class="shrink-0 space-y-2 px-3 pb-4 pt-2">
			<div class="flex min-w-0 items-center justify-between gap-2">
					<DropdownMenu.Root>
						<DropdownMenu.Trigger
							variant="ghost"
							class="h-9 min-w-0 max-w-full gap-1.5 font-sans text-xs !font-normal text-foreground-muted"
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
					<Button
						variant="ghost"
						class="h-9 shrink-0 font-sans text-xs !font-normal text-foreground-muted"
						disabled={composerBusy || !threadsStore.reviewId}
						title={threadsStore.reviewId
							? 'Ask for a fix in chat'
							: 'Needs a backend review'}
						onclick={() => suggestViaChat()}
					>
						Suggest fix
					</Button>
			</div>
			{#if attachedQuote}
				<Button variant="secondary" onclick={() => attachedQuote = null} aria-label="Remove attached code" class="max-w-full gap-2 font-mono text-xs"><span class="truncate">{attachedQuote.split('\n')[0].slice(0, 48)}</span><X size={12} aria-hidden="true" /></Button>
			{/if}
			{#if sendError}<Typography.Text class="break-words text-sm text-error" role="alert">{sendError}</Typography.Text>{/if}
			<div data-composer>
				<ReviewComposer
					bind:value={draft}
					bind:inputEl
					size="panel"
					label={finding ? 'Ask about this finding' : 'Select a finding'}
					placeholder={finding ? `Reply to ${formatAgentName(active)}…` : 'Select a finding'}
					{sending}
					generating={composerBusy && !sending}
					disabled={!finding}
					onSubmit={() => send()}
					onAttach={attachSelection}
					attachDisabled={!selectionAvailable || composerBusy}
					attachLabel="Attach selected code"
				>
					{#snippet leading()}
						<Typography.Metadata class="truncate text-[12px] text-fg-faint">Shared with Orchestrator</Typography.Metadata>
					{/snippet}
					{#snippet picker()}
						<ModelPicker
							value={modelSettingsUi.specialist}
							onSelect={(choice) => void modelSettingsUi.selectSpecialist(choice)}
							size="panel"
							label="Specialist model"
						/>
					{/snippet}
				</ReviewComposer>
			</div>
		</div>
	</Card.Root>
	</section>
