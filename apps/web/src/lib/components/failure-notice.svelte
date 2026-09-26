<script lang="ts">
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as Card from '@sivir-ui/svelte/components/card';
	import { chatGptStatus } from '$lib/chatgpt-status.svelte';
	import { modelSettingsUi } from '$lib/model-settings.svelte';

	interface Props {
		title: string;
		reason: string;
		/** Signing in to ChatGPT fixes this. */
		signIn?: boolean;
		onRetry?: (() => void) | null;
		retrying?: boolean;
		class?: string;
	}
	let { title, reason, signIn = false, onRetry = null, retrying = false, class: className = '' }: Props = $props();

	$effect(() => {
		if (signIn && chatGptStatus.signedIn === null) void chatGptStatus.check();
	});
	// Once signed in, the way forward is to try again.
	const needsSignIn = $derived(signIn && chatGptStatus.signedIn !== true);
</script>

<!-- A sign-in prompt with nothing to retry has done its job once ChatGPT is signed in. -->
{#if needsSignIn || !signIn || onRetry}
<Card.Root class="review-notice {className}" {...{ role: 'alert' }}>
	<CircleAlert size={15} class="review-notice-icon" aria-hidden="true" />
	<div class="min-w-0 flex-1">
		<p class="review-notice-title">{title}</p>
		<p class="review-notice-body">{needsSignIn || !signIn ? reason : 'Signed in to ChatGPT. Retry to continue.'}</p>
	</div>
	{#if needsSignIn}
		<Button variant="outline" class="shrink-0" onclick={() => modelSettingsUi.show('models', { kind: 'chatgpt-sign-in' })}>Sign in to ChatGPT</Button>
	{:else if onRetry}
		<Button variant="outline" class="shrink-0" loading={retrying} onclick={onRetry}>
			<RotateCcw size={13} aria-hidden="true" /> Retry
		</Button>
	{/if}
</Card.Root>
{/if}
