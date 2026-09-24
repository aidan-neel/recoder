<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import FlaskConical from '@lucide/svelte/icons/flask-conical';
	import X from '@lucide/svelte/icons/x';
	import { Button } from '@sivir-ui/svelte/components/button';
	import { Spinner } from '@sivir-ui/svelte/components/spinner';
	import CheckList from './check-list.svelte';
	import { findingsStore, type Finding } from '$lib/findings.svelte';
	import { discardVerify, verifyFix } from '$lib/fixes';

	/** Verify a ready fix on CI: push it to a temporary branch and follow its checks. */
	let { finding }: { finding: Finding } = $props();
	const suggestion = $derived(findingsStore.suggestions[finding.id]);
	const verify = $derived(suggestion?.verify);
	const checks = $derived(verify?.checks ?? []);
	const failed = $derived(checks.filter((c) => c.state === 'failed').length);
	const active = $derived(checks.filter((c) => c.state === 'running' || c.state === 'pending').length);
	const passed = $derived(checks.filter((c) => c.state === 'passed').length);
</script>

{#if suggestion?.status === 'ready' && suggestion.patch && suggestion.apply !== 'applied' && finding.status === 'open'}
	<section class="fix-checks" data-status={verify?.status ?? 'idle'} aria-label="Checks for this fix">
		<div class="fix-checks-head">
			<span class="fix-checks-icon" aria-hidden="true">
				{#if !verify}<FlaskConical size={13} />
				{:else if verify.status === 'pushing' || verify.status === 'waiting' || verify.status === 'running'}<Spinner size={12} />
				{:else if verify.status === 'passed'}<Check size={13} />
				{:else if verify.status === 'failed' || verify.status === 'error'}<X size={13} />
				{:else}<FlaskConical size={13} />{/if}
			</span>
			<span class="fix-checks-title" role="status">
				{#if !verify}Run the PR's checks on this fix
				{:else if verify.status === 'pushing'}Pushing the fix to a check branch…
				{:else if verify.status === 'waiting'}Waiting for CI on <code>{verify.branch}</code>…
				{:else if verify.status === 'running'}{active} of {checks.length} checks running{failed ? ` · ${failed} failed` : ''}
				{:else if verify.status === 'passed'}{passed} {passed === 1 ? 'check' : 'checks'} passed
				{:else if verify.status === 'failed'}{failed} of {checks.length} checks failed
				{:else if verify.status === 'none'}No checks ran on <code>{verify.branch}</code>. Your CI may only run on pull requests.
				{:else}{verify.error ?? "Couldn't run checks."}{/if}
			</span>
			<span class="fix-checks-actions">
				{#if !verify || verify.status === 'error' || verify.status === 'failed' || verify.status === 'none' || verify.status === 'passed'}
					<Button variant="ghost" class="fix-checks-run" onclick={() => void verifyFix(finding)}>{verify ? 'Run again' : 'Run checks'}</Button>
				{/if}
				{#if verify?.branch}
					<Button variant="ghost" class="fix-checks-run" title="Delete {verify.branch} from the remote" onclick={() => void discardVerify(finding)}>Remove branch</Button>
				{/if}
			</span>
		</div>
		{#if !verify}
			<p class="fix-checks-hint">Pushes this fix to a temporary <code>recoder/fix-…</code> branch so CI can test it. The pull request branch isn't touched.</p>
		{/if}
		{#if checks.length}<CheckList {checks} />{/if}
	</section>
{/if}
