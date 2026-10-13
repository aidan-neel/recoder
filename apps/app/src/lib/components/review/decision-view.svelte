<script lang="ts">
	import FlaskConical from '@lucide/svelte/icons/flask-conical';
	import Route from '@lucide/svelte/icons/route';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import CircleDashed from '@lucide/svelte/icons/circle-dashed';
	import { parseUnifiedDiff, type FileDiff } from '@recoder/shared';
	import { Textarea } from '@sivir-ui/svelte/components/textarea';
	import CodeView from './code-view.svelte';
	import EvidenceBlock from './evidence-block.svelte';
	import RichText from '../ui/rich-text.svelte';
	import { excerpt } from '$lib/review/excerpt';
	import { categoryLabel, PROOF_LABEL, TONE_LABEL, where } from '$lib/review/labels';
	import type { ReviewState } from '$lib/review/review-state.svelte';
	import type { Decision } from '$lib/review/surface';

	interface Props {
		decision: Decision;
		view: ReviewState;
	}

	let { decision, view }: Props = $props();

	const PROOF_ICON = { reproduced: FlaskConical, traced: Route, checked: ShieldCheck, unproven: CircleDashed };

	const diff = $derived(view.files.find((file) => file.path === decision.file) ?? null);
	const code = $derived(diff ? excerpt(diff, decision.line, decision.endLine, decision.side) : null);
	const patch = $derived<FileDiff | null>(decision.patch ? (parseUnifiedDiff(decision.patch)[0] ?? null) : null);
	const decisionState = $derived(view.decisions.stateOf(decision.id));
	const ProofIcon = $derived(PROOF_ICON[decision.proof]);
</script>

<article class="detail" aria-labelledby="detail-title">
	<header class="detail-head">
		<div class="detail-kicker">
			<span class="pill" data-tone={decision.tone}>{TONE_LABEL[decision.tone]}</span>
			{#if decision.category}<span class="detail-kicker-text">{categoryLabel(decision.category)}</span>{/if}
			<span class="detail-proof" data-proof={decision.proof}
				><ProofIcon size={13} aria-hidden="true" />{PROOF_LABEL[decision.proof]}</span
			>
		</div>
		<h2 class="detail-title" id="detail-title">{decision.title}</h2>
		<button class="detail-where mono" type="button" onclick={() => view.select({ kind: 'file', path: decision.file })}>
			{where(decision.file, decision.line, decision.endLine)}{#if decision.symbol}<span class="detail-symbol"
					>{decision.symbol}</span
				>{/if}
		</button>
	</header>

	<p class="detail-body ai-voice"><RichText text={decision.body} /></p>

	{#if decisionState === 'sent'}
		<div class="detail-note">
			<Textarea
				variant="secondary"
				autoresize
				label="Note for the agent"
				placeholder="Optional. Anything the agent should know when it fixes this."
				value={view.decisions.noteOf(decision.id)}
				oninput={(event) => view.decisions.setNote(decision.id, (event.currentTarget as HTMLTextAreaElement).value)}
			/>
		</div>
	{/if}

	{#if decision.claim}
		<section class="detail-section" aria-label="How it breaks">
			<h3 class="detail-section-title">How it breaks</h3>
			<ol class="claim">
				<li class="claim-step" data-end="start">
					<span class="claim-label">When</span><span class="claim-text"><RichText text={decision.claim.trigger} /></span
					>
				</li>
				{#each decision.claim.executionPath as step, index (index)}
					<li class="claim-step">
						<span class="claim-label mono">{where(step.file, step.line, null, true)}</span>
						<span class="claim-text">{step.note ?? ''}</span>
					</li>
				{/each}
				<li class="claim-step" data-end="end">
					<span class="claim-label">Then</span><span class="claim-text"
						><RichText text={decision.claim.consequence} /></span
					>
				</li>
			</ol>
			<p class="claim-contract"><span>Breaks</span> <RichText text={decision.claim.violatedContract} /></p>
		</section>
	{/if}

	{#if decision.evidence}
		<section class="detail-section" aria-label="Evidence">
			<h3 class="detail-section-title">Evidence</h3>
			<EvidenceBlock evidence={decision.evidence} />
		</section>
	{:else if decision.proofNote}
		<section class="detail-section" aria-label="Evidence">
			<h3 class="detail-section-title">
				{decision.proof === 'unproven' ? 'Why it isn’t proven' : 'How it was checked'}
			</h3>
			<p class="detail-plain"><RichText text={decision.proofNote} /></p>
		</section>
	{/if}

	{#if code && diff}
		<section class="detail-section" aria-label="Code">
			<h3 class="detail-section-title">Code</h3>
			<CodeView path={decision.file} lines={code.lines} above={code.above} below={code.below}>
				{#snippet aside()}
					<button class="code-open" type="button" onclick={() => view.select({ kind: 'file', path: decision.file })}
						>Open file</button
					>
				{/snippet}
			</CodeView>
		</section>
	{/if}

	{#if patch}
		<section class="detail-section" aria-label="Suggested fix">
			<h3 class="detail-section-title">Suggested fix</h3>
			<CodeView
				path={patch.path}
				lines={patch.hunks.flatMap((hunk) => hunk.lines.map((line) => ({ line, flagged: false })))}
			>
				{#snippet aside()}
					{#if decision.finding?.patch?.checks.length}
						<span class="code-checks"
							><ShieldCheck size={12} aria-hidden="true" />{decision.finding.patch.checks.join(' · ')}</span
						>
					{/if}
				{/snippet}
			</CodeView>
		</section>
	{:else if decision.suggestion}
		<section class="detail-section" aria-label="Suggested fix">
			<h3 class="detail-section-title">Suggested fix</h3>
			<p class="detail-plain"><RichText text={decision.suggestion} /></p>
		</section>
	{/if}
</article>
