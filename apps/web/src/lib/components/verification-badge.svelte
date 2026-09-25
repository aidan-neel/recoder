<script lang="ts">
	import type { FindingVerification } from '@recoder/shared';
	import Check from '@lucide/svelte/icons/check';
	import { Badge } from '@sivir-ui/svelte/components/badge';
	import * as Tooltip from '@sivir-ui/svelte/components/tooltip';

	/** Whether the reviewer proved this finding by running code; the tooltip names the command or the reason. */
	let { verification }: { verification: FindingVerification } = $props();
	const verified = $derived(verification.status === 'verified');
	const tip = $derived(verified && verification.command ? `Proven by running ${verification.command}` : verification.reason);
</script>

<Tooltip.Root placement="top" delay={400} closeDelay={80}>
	<Tooltip.Trigger class="verify-trigger">
		<Badge variant="secondary" data-verify={verification.status} class="severity-pill" role={undefined}>
			{#if verified}<Check size={11} strokeWidth={2.5} aria-hidden="true" />Verified{:else}Unverified{/if}
		</Badge>
	</Tooltip.Trigger>
	<Tooltip.Content>{tip}</Tooltip.Content>
</Tooltip.Root>
