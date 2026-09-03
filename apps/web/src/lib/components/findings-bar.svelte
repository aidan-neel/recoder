<script lang="ts">
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronUp from '@lucide/svelte/icons/chevron-up';
	import { Button } from '@sivir-ui/svelte/components/button';
	import { Spinner } from '@sivir-ui/svelte/components/spinner';
	import {
		SEVERITIES,
		findingsStore,
		type FindingSeverity
	} from '$lib/findings.svelte';

	const sevLabel: Record<FindingSeverity, string> = {
		high: 'High',
		medium: 'Medium',
		low: 'Low',
		info: 'Info'
	};

	const pillStyle: Record<FindingSeverity, string> = {
		high: 'bg-error/15 text-error',
		medium: 'bg-warning/15 text-warning',
		low: 'bg-[#141c28] text-[#5698ff]',
		info: 'bg-secondary text-foreground-muted'
	};

	/** Severities currently filtered out of navigation. */
	let hidden = $state(new Set<FindingSeverity>());
	let index = $state(0);

	const openItems = $derived(findingsStore.items.filter((f) => f.status !== 'dismissed'));

	const counts = $derived(
		Object.fromEntries(SEVERITIES.map((s) => [s, openItems.filter((f) => f.severity === s).length])) as Record<
			FindingSeverity,
			number
		>
	);

	const visible = $derived(
		openItems
			.filter((f) => !hidden.has(f.severity))
			.sort((a, b) => a.startLine - b.startLine || a.id.localeCompare(b.id))
	);

	/** 0-based position of the current finding within the visible list. */
	const position = $derived.by(() => {
		const at = visible.findIndex((f) => f.id === findingsStore.activeId);
		if (at !== -1) return at;
		return Math.min(index, Math.max(0, visible.length - 1));
	});

	function scrollTo(id: string): void {
		document.getElementById(`finding-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
	}

	function go(i: number): void {
		if (visible.length === 0) return;
		index = (i + visible.length) % visible.length;
		const finding = visible[index];
		findingsStore.discuss(finding.id);
		scrollTo(finding.id);
	}

	function toggle(severity: FindingSeverity): void {
		if (hidden.has(severity)) hidden.delete(severity);
		else hidden.add(severity);
	}

	// Hijack browser find: Ctrl/Cmd+F steps through findings instead.
	function onKeydown(event: KeyboardEvent): void {
		if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
			event.preventDefault();
			go(position + 1);
		}
	}

	$effect(() => {
		window.addEventListener('keydown', onKeydown);
		return () => window.removeEventListener('keydown', onKeydown);
	});
</script>

<div class="session-enter flex shrink-0 items-center gap-2" style="animation-delay: 60ms">
	<div class="flex h-9 items-center gap-0.5 rounded-lg border border-border bg-card px-1.5">
		<span class="px-1.5 text-[15px] text-foreground-muted">Finding</span>
		<span class="font-mono text-[14px]">
			{visible.length === 0 ? 0 : position + 1} of {visible.length}
		</span>
		<Button
			variant="ghost"
			size="icon"
			aria-label="Previous finding"
			disabled={visible.length === 0}
			onclick={() => go(position - 1)}
		>
			<ChevronUp size={14} />
		</Button>
		<Button
			variant="ghost"
			size="icon"
			aria-label="Next finding"
			title="Next finding (Ctrl+F)"
			disabled={visible.length === 0}
			onclick={() => go(position + 1)}
		>
			<ChevronDown size={14} />
		</Button>
	</div>

	{#each SEVERITIES as severity (severity)}
		<button
			type="button"
			onclick={() => toggle(severity)}
			aria-pressed={!hidden.has(severity)}
			title="Toggle {severity} findings"
			class="flex h-9 shrink-0 items-center gap-1.5 rounded-md px-2.5 font-sans text-[14px] transition-all {pillStyle[
				severity
			]} {hidden.has(severity) ? 'opacity-40' : ''}"
		>
			{sevLabel[severity]}
			<span>{counts[severity]}</span>
		</button>
	{/each}

	<div class="ml-auto flex shrink-0 items-center gap-2">
		<span
			class="flex h-9 items-center gap-1.5 rounded-md bg-[#141c28] px-2.5 text-[14px] text-[#5698ff]"
		>
			<Spinner size={13} aria-hidden="true" />
			4 of 6 agents
		</span>
	</div>
</div>
