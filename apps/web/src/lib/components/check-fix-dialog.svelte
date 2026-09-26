<script lang="ts">
	import type { PrCheck } from '@recoder/shared';
	import Check from '@lucide/svelte/icons/check';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as Modal from '@sivir-ui/svelte/components/modal';
	import { Spinner } from '@sivir-ui/svelte/components/spinner';
	import { checkFixes } from '$lib/check-fixes.svelte';
	import FailureNotice from './failure-notice.svelte';
	import SuggestedFix from './suggested-fix.svelte';

	/** Review a failing check's fix, then push it. */
	let { reviewId, check, open = $bindable(false), onApplied }: { reviewId: string; check: PrCheck | null; open?: boolean; onApplied?: () => void } = $props();
	const fix = $derived(check ? checkFixes.get(reviewId, check) : undefined);

	async function apply(): Promise<void> {
		if (!check) return;
		if (await checkFixes.apply(reviewId, check)) onApplied?.();
	}
</script>

<Modal.Root bind:open>
	<Modal.Content size="lg" aria-label="Fix a failing check">
		<Modal.Header>
			<Modal.Title>Fix {check?.name ?? 'check'}</Modal.Title>
		</Modal.Header>
		<Modal.Body>
			{#if fix?.status === 'loading'}
				<p class="fix-status" role="status"><Spinner size={12} aria-hidden="true" /><span class="shimmer-text">Reading the log and writing a fix…</span></p>
			{:else if fix?.status === 'error' && check}
				{@const target = check}
				<FailureNotice title="Couldn't write a fix" reason={fix.error ?? ''} signIn={fix.action === 'sign-in'} onRetry={() => void checkFixes.suggest(reviewId, target)} />
			{:else if fix?.status === 'ready' && fix.patch}
				<SuggestedFix suggestion={fix} />
				{#if fix.applyError}<p class="conversation-fix-error" role="status">{fix.applyError}</p>{/if}
			{/if}
		</Modal.Body>
		<Modal.Footer>
			<Modal.Close>Close</Modal.Close>
			{#if fix?.status === 'ready'}
				{#if fix.apply === 'applied'}
					<Button variant="outline" disabled><Check size={14} aria-hidden="true" />Pushed</Button>
				{:else}
					<Button variant="primary" loading={fix.apply === 'applying'} onclick={() => void apply()}>Apply fix</Button>
				{/if}
			{/if}
		</Modal.Footer>
	</Modal.Content>
</Modal.Root>
