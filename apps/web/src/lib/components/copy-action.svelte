<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import Copy from '@lucide/svelte/icons/copy';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as Tooltip from '@sivir-ui/svelte/components/tooltip';
	import { onDestroy } from 'svelte';

	/** Sivir's CopyButton with a configurable tooltip delay (its own is fixed at 125ms). */
	let { text, delay = 750 }: { text: string; delay?: number } = $props();
	let copied = $state(false);
	let timer: ReturnType<typeof setTimeout> | undefined;

	async function copy() {
		try { await navigator.clipboard.writeText(text); }
		catch { return; }
		copied = true;
		clearTimeout(timer);
		timer = setTimeout(() => (copied = false), 2000);
	}
	onDestroy(() => clearTimeout(timer));
	const morph = 'col-start-1 row-start-1 transition-[transform,translate,scale,rotate,opacity] [transition-duration:var(--motion-duration-panel)] ease-[var(--ease-out)]';
</script>

<Tooltip.Root placement="top" {delay} closeDelay={80}>
	<Tooltip.Trigger showOnClick class="flex">
		<Button variant="ghost" size="icon" aria-label={copied ? 'Copied' : 'Copy'} onclick={copy}>
			<span class="relative grid size-4 place-items-center">
				<Copy class="{morph} {copied ? '-rotate-90 scale-50 opacity-0' : 'rotate-0 scale-100 opacity-100'}" aria-hidden="true" />
				<Check class="{morph} text-success {copied ? 'rotate-0 scale-100 opacity-100' : 'rotate-90 scale-50 opacity-0'}" aria-hidden="true" />
			</span>
		</Button>
	</Tooltip.Trigger>
	<Tooltip.Content>{copied ? 'Copied' : 'Copy'}</Tooltip.Content>
</Tooltip.Root>
