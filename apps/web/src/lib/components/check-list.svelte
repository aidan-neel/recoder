<script lang="ts">
	import type { PrCheck } from '@recoder/shared';
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
	import Check from '@lucide/svelte/icons/check';
	import CircleDashed from '@lucide/svelte/icons/circle-dashed';
	import Minus from '@lucide/svelte/icons/minus';
	import X from '@lucide/svelte/icons/x';
	import Wrench from '@lucide/svelte/icons/wrench';
	import { Button } from '@sivir-ui/svelte/components/button';
	import { Spinner } from '@sivir-ui/svelte/components/spinner';

	/** CI checks, failures first. `onFix` offers a fix for failed checks that have a log. */
	let { checks, onFix, fixLabel = () => 'Suggest fix' }: { checks: PrCheck[]; onFix?: (check: PrCheck) => void; fixLabel?: (check: PrCheck) => string } = $props();
	const ORDER = { failed: 0, running: 1, pending: 2, passed: 3, skipped: 4 } as const;
	const sorted = $derived([...checks].sort((a, b) => ORDER[a.state] - ORDER[b.state] || a.name.localeCompare(b.name)));
</script>

<ul class="check-list">
	{#each sorted as check (check.name)}
		<li class="check-row" data-state={check.state}>
			<span class="check-icon" aria-hidden="true">
				{#if check.state === 'passed'}<Check size={13} />
				{:else if check.state === 'failed'}<X size={13} />
				{:else if check.state === 'running'}<Spinner size={12} />
				{:else if check.state === 'skipped'}<Minus size={13} />
				{:else}<CircleDashed size={13} />{/if}
			</span>
			<span class="check-name" title={check.name}>{check.name}</span>
			{#if onFix && check.state === 'failed' && check.id}
				<!-- Dense popover row: the compact size is intentional. -->
				<Button variant="ghost" size="sm" class="check-fix" onclick={() => onFix(check)}><Wrench size={12} aria-hidden="true" />{fixLabel(check)}</Button>
			{:else}
				<span class="check-state">{check.state}</span>
			{/if}
			{#if check.url}<a class="check-link" href={check.url} target="_blank" rel="noopener noreferrer" aria-label="Open {check.name}"><ArrowUpRight size={12} aria-hidden="true" /></a>{/if}
		</li>
	{/each}
</ul>
