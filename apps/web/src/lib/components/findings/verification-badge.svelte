<script lang="ts">
	import type { FindingVerification } from '@recoder/shared';
	import Check from '@lucide/svelte/icons/check';
	import { Badge } from '@sivir-ui/svelte/components/badge';
	import * as Tooltip from '@sivir-ui/svelte/components/tooltip';
	import { VERIFY_METHOD_LABELS, VERIFY_METHOD_NOTES } from '$lib/findings/finding-labels';

	/**
	 * How a finding was proven (a run, a trace, a detector, a repo rule or a convention), or that it wasn't;
	 * the tooltip names the command or the reason.
	 */
	let { verification }: { verification: FindingVerification } = $props();
	const verified = $derived(verification.status === 'verified');
	const method = $derived(verification.method ?? 'run');
	const tip = $derived(
		verified && verification.command
			? `Proven by running ${verification.command}`
			: verified && method !== 'run'
				? `${VERIFY_METHOD_NOTES[method]}: ${verification.reason}`
				: verification.reason
	);
</script>

<Tooltip.Root placement="top" delay={400} closeDelay={80}>
	<Tooltip.Trigger class="verify-trigger">
		<Badge variant="secondary" data-verify={verification.status} class="severity-pill" role={undefined}>
			{#if verified}<Check size={11} strokeWidth={2.5} aria-hidden="true" />{VERIFY_METHOD_LABELS[
					method
				]}{:else}Unverified{/if}
		</Badge>
	</Tooltip.Trigger>
	<Tooltip.Content>{tip}</Tooltip.Content>
</Tooltip.Root>
