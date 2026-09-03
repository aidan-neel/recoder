<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as AlertDialog from '@sivir-ui/svelte/components/alert-dialog';
	import * as Collapsible from '@sivir-ui/svelte/components/collapsible';
	import * as DropdownMenu from '@sivir-ui/svelte/components/dropdown-menu';
	import Shortcut from '@sivir-ui/svelte/components/shortcut';
	import SeverityPill from './severity-pill.svelte';
	import { SEVERITY_DOT, findingsStore, type Finding } from '$lib/findings.svelte';
	import { threadsStore } from '$lib/threads.svelte';

	interface Props {
		finding: Finding;
	}

	let { finding }: Props = $props();

	const dismissed = $derived(finding.status === 'dismissed');
	const accepted = $derived(finding.status === 'accepted');
	/** Ringed while this is the navigator's current finding. */
	const focused = $derived(findingsStore.activeId === finding.id);

	/** Drives the collapse/expand animation. Derived so external resets stay in sync. */
	const expanded = $derived(!dismissed);

	let confirmOpen = $state(false);
	let fixModel = $state('security');
	const fixModels = ['security', 'orchestrator', 'perf'];

	function confirmAccept() {
		findingsStore.accept(finding.id, fixModel);
		confirmOpen = false;
	}
</script>

<div
	class="rounded-lg border border-border bg-card p-3 font-sans {focused
		? 'ring-1 ring-[#5698ff]'
		: ''}"
	onmouseenter={() => (findingsStore.hoveredId = finding.id)}
	onmouseleave={() => (findingsStore.hoveredId = null)}
	role="article"
>
	<Collapsible.Root open={expanded}>
		{#if dismissed}
			<div class="flex items-center gap-2 font-mono text-[14px] text-foreground-muted">
				<span
					class="h-1.5 w-1.5 shrink-0 rounded-full"
					style:background-color={SEVERITY_DOT[finding.severity]}
				></span>
				<span>{finding.category}</span>
				<span class="opacity-70">· Dismissed</span>
				<Button
					variant="ghost"
					size="sm"
					class="ml-auto font-sans text-[14px]"
					onclick={() => findingsStore.reopen(finding.id)}
				>
					Undo
				</Button>
			</div>
		{:else}
			<div class="flex items-center gap-2 font-mono text-[14px]">
				<SeverityPill severity={finding.severity} />
				<span class="font-medium">{finding.category}</span>
				<span class="truncate text-foreground-muted">{finding.agent}</span>
				{#if finding.code}
					<span class="ml-auto shrink-0 font-mono text-foreground-muted">{finding.code}</span>
				{/if}
			</div>
		{/if}
		<Collapsible.Content>
			<p class="mt-1.5 font-mono text-[14px] leading-relaxed">{finding.body}</p>
			{#if finding.status === 'open'}
				<div class="mt-2.5 flex items-center gap-1">
					<Button
						variant="secondary"
						size="sm"
						class="font-sans text-[14px]"
						onclick={() => {
					findingsStore.discuss(finding.id);
					threadsStore.open(finding.id);
				}}
					>
						Discuss
					</Button>
					<Button
						variant="primary"
						size="sm"
						class="font-sans text-[14px]"
				onclick={() => (confirmOpen = true)}
			>
				Fix
			</Button>
					<Button
						variant="ghost"
						size="sm"
						class="font-sans text-[14px]"
						onclick={() => {
							findingsStore.dismiss(finding.id);
							if (threadsStore.openId === finding.id) threadsStore.close();
						}}
					>
						Dismiss
					</Button>
				</div>
			{/if}

			{#if accepted}
				<div class="mt-2 flex items-center gap-2">
			<span
				class="rounded bg-success/15 px-1.5 py-0.5 font-sans text-[13px] font-semibold text-success"
			>
				Fixed
			</span>
			{#if finding.fixedBy}
				<span class="font-mono text-[12px] text-foreground-muted">· {finding.fixedBy}</span>
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
		</Collapsible.Content>
	</Collapsible.Root>

	<AlertDialog.Root bind:open={confirmOpen}>
		<AlertDialog.Content>
			<AlertDialog.Header>
				<AlertDialog.Title>Fix this finding?</AlertDialog.Title>
				<AlertDialog.Description>
					This marks the {finding.category} finding as fixed. You can undo it afterwards.
				</AlertDialog.Description>
				<div class="mt-3 flex flex-col gap-1.5">
					<span class="text-[13px] text-foreground-muted">Model</span>
					<DropdownMenu.Root>
						<DropdownMenu.Trigger
							variant="outline"
							size="sm"
							class="h-9 w-full justify-between gap-1.5 font-sans"
						>	{fixModel}
							<ChevronDown size={12} class="text-foreground-muted" />
						</DropdownMenu.Trigger>
						<DropdownMenu.Content class="min-w-[12rem]">
							<DropdownMenu.Label>Fix with</DropdownMenu.Label>
							{#each fixModels as model (model)}
								<DropdownMenu.Item callback={() => (fixModel = model)}>
									<span class="flex-1">{model}</span>
									{#if fixModel === model}
										<Check size={13} class="text-primary" />
									{/if}
								</DropdownMenu.Item>
							{/each}
						</DropdownMenu.Content>
					</DropdownMenu.Root>
				</div>
			</AlertDialog.Header>
			<AlertDialog.Footer>
				<AlertDialog.Exit>
					Cancel
					<Shortcut shortcut="esc" />
				</AlertDialog.Exit>
				<AlertDialog.Confirm variant="primary" onclick={confirmAccept}>
					Fix
					<Shortcut shortcut="enter" />
				</AlertDialog.Confirm>
			</AlertDialog.Footer>
		</AlertDialog.Content>
	</AlertDialog.Root>
</div>
