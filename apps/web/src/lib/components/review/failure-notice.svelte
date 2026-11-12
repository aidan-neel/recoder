<script lang="ts">
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as Card from '@sivir-ui/svelte/components/card';
	import type { UsageLimit } from '@recoder/shared';
	import UsageLimitNotice from './usage-limit-notice.svelte';
	import { modelSettingsUi } from '$lib/settings/model-settings.svelte';

	interface Props {
		title: string;
		reason: string;
		/** Signing in fixes this. */
		signIn?: boolean;
		/** The model's plan ran out: shows when it resets and offers another model. */
		usageLimit?: UsageLimit | null;
		onRetry?: (() => void) | null;
		retrying?: boolean;
		class?: string;
	}
	let {
		title,
		reason,
		signIn = false,
		usageLimit = null,
		onRetry = null,
		retrying = false,
		class: className = ''
	}: Props = $props();
</script>

{#if usageLimit}
	<UsageLimitNotice limit={usageLimit} {onRetry} {retrying} class={className} />
{:else}
	<Card.Root class="review-notice {className}" {...{ role: 'alert' }}>
		<CircleAlert size={15} class="review-notice-icon" aria-hidden="true" />
		<div class="min-w-0 flex-1">
			<p class="review-notice-title">{title}</p>
			<p class="review-notice-body">{reason}</p>
		</div>
		{#if signIn}
			<Button
				variant="outline"
				class="shrink-0"
				onclick={() => modelSettingsUi.show('models', { kind: 'add-provider' })}>Add a provider</Button
			>
		{:else if onRetry}
			<Button variant="outline" class="shrink-0" loading={retrying} onclick={onRetry}>
				<RotateCcw size={13} aria-hidden="true" /> Retry
			</Button>
		{/if}
	</Card.Root>
{/if}
