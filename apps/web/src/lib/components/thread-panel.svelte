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
	import Shortcut from '@sivir-ui/svelte/components/shortcut';
	import SeverityPill from './severity-pill.svelte';
	import { findingsStore } from '$lib/findings.svelte';
	import { threadsStore, type Thread } from '$lib/threads.svelte';

	const participants = ['security', 'orchestrator', 'perf'];

	let active = $state(participants[0]);
	let draft = $state('');
	let attachedQuote = $state<string | null>(null);
	let selectionAvailable = $state(false);
	let inputEl: HTMLTextAreaElement | undefined = $state();

	const findingId = $derived(threadsStore.openId);
	const finding = $derived(findingsStore.items.find((f) => f.id === findingId));
	const thread = $derived<Thread>(
		findingId
			? (threadsStore.get(findingId) ?? { findingId, messages: [] })
			: { findingId: '', messages: [] }
	);

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

	function send(): void {
		if (!findingId) return;
		const body = draft.trim();
		if (!body) return;
		const quote = attachedQuote
			? `${attachedQuote.split('\n').map((line) => `> ${line}`).join('\n')}\n\n`
			: '';
		threadsStore.send(findingId, `${quote}${body}`);
		draft = '';
		attachedQuote = null;
		if (inputEl) inputEl.style.height = 'auto';
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

{#if threadsStore.openId}
	<section
		aria-label="Finding thread"
		class="thread-panel-enter absolute right-4 bottom-4 z-20 flex h-[min(680px,calc(100%-2rem))] w-[520px] flex-col overflow-hidden rounded-2xl border border-border bg-card"
	>
		<div class="flex h-11 shrink-0 items-center gap-2 border-b border-border px-4">
			{#if finding}
				<SeverityPill severity={finding.severity} />
				<span class="font-mono text-[13px] font-semibold">{finding.code}</span>
			{:else}
				<span class="text-[13px] text-foreground-muted">Thread</span>
			{/if}
			<Button
				variant="ghost"
				size="icon"
				class="-mr-2 ml-auto"
				aria-label="Close thread"
				onclick={() => threadsStore.close()}
			>
				<X size={15} />
			</Button>
		</div>

		<Conversation.Root class="min-h-0 flex-1">
			<Conversation.Content
				aria-label="Thread messages"
				transcriptClass="flex flex-col gap-4 p-4"
			>
				{#each thread.messages as message (message.id)}
					{#if message.role === 'agent'}
						<Message.Root
							from="assistant"
							name={message.model ? `${message.author} · ${message.model}` : message.author}
							timestamp={message.time}
						>
							<Message.Content>
								<Markdown content={message.body} />
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
					<Conversation.Empty
						title="No replies yet"
						description="Ask {active} about this finding below."
					/>
				{/each}
			</Conversation.Content>
			<Conversation.ScrollButton />
		</Conversation.Root>

		<div class="shrink-0 p-3">
			<div data-composer class="rounded-xl border border-border bg-background p-3">
				<textarea
					bind:this={inputEl}
					bind:value={draft}
					oninput={autoresize}
					onkeydown={onKeydown}
					rows={3}
					placeholder="Ask {active} about this finding…"
					aria-label="Ask about this finding"
					class="max-h-[120px] w-full resize-none bg-transparent text-[14px] leading-relaxed outline-none placeholder:text-foreground-muted/70"
				></textarea>
				<div class="mt-2 flex items-center gap-1">
					<DropdownMenu.Root>
						<DropdownMenu.Trigger
							variant="ghost"
							size="sm"
							class="h-9 gap-1.5 font-sans text-[13px] transition-[width]"
							style="interpolate-size: allow-keywords"
							aria-label="Choose agent"
						>
							{active}
							<ChevronDown size={12} class="text-foreground-muted" />
						</DropdownMenu.Trigger>
						<DropdownMenu.Content class="min-w-[12rem]">
							<DropdownMenu.Label>Model</DropdownMenu.Label>
							{#each participants as participant (participant)}
								<DropdownMenu.Item callback={() => (active = participant)}>
									<span class="flex-1">{participant}</span>
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
						variant="primary"
						size="sm"
						class="ml-auto h-9"
						disabled={!draft.trim()}
						onclick={send}
					>
						Send
						<Shortcut shortcut="enter" />
					</Button>
				</div>
			</div>
		</div>
	</section>
{/if}
