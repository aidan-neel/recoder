<script lang="ts">
	import * as Modal from '@sivir-ui/svelte/components/modal';
	import { CopyButton } from '@sivir-ui/svelte/components/copy-button';
	import { Textarea } from '@sivir-ui/svelte/components/textarea';
	import StatusGlyph from '../ui/status-glyph.svelte';
	import { handoffPrompt } from '$lib/review/handoff';
	import { where } from '$lib/review/labels';
	import type { ReviewState } from '$lib/review/review-state.svelte';

	interface Props {
		view: ReviewState;
	}

	let { view }: Props = $props();

	const prompt = $derived(
		handoffPrompt(
			{
				number: view.review?.prNumber ?? 0,
				title: view.review?.prTitle ?? view.pull?.title ?? '',
				branch: view.pull?.headRef ?? null
			},
			view.sent.map((decision) => ({ decision, note: view.decisions.noteOf(decision.id) }))
		)
	);
</script>

<Modal.Root bind:open={view.handoffOpen}>
	<Modal.Content size="lg" class="handoff" showClose={false} aria-label="Hand off to the agent">
		<Modal.Header>
			<Modal.Title>Hand off to the agent</Modal.Title>
		</Modal.Header>
		<Modal.Body class="handoff-body thin-scroll">
			<ol class="handoff-items">
				{#each view.sent as decision (decision.id)}
					<li class="handoff-item">
						<StatusGlyph kind={decision.tone} />
						<div class="handoff-item-main">
							<span class="handoff-item-title">{decision.title}</span>
							<span class="handoff-item-where mono">{where(decision.file, decision.line, decision.endLine)}</span>
							<Textarea
								variant="secondary"
								autoresize
								rows={1}
								class="handoff-note"
								placeholder="Add a note for the agent"
								aria-label="Note for {decision.title}"
								value={view.decisions.noteOf(decision.id)}
								oninput={(event) =>
									view.decisions.setNote(decision.id, (event.currentTarget as HTMLTextAreaElement).value)}
							/>
						</div>
					</li>
				{/each}
			</ol>
			<div class="handoff-prompt">
				<div class="handoff-prompt-head">
					<span>Prompt</span>
					<span class="handoff-prompt-hint">Paste it into the agent that opened the PR.</span>
				</div>
				<pre class="handoff-prompt-text mono thin-scroll">{prompt}</pre>
			</div>
		</Modal.Body>
		<Modal.Footer>
			<Modal.Close variant="ghost">Close</Modal.Close>
			<CopyButton text={prompt} variant="primary" size="md" label="Copy prompt" copiedLabel="Copied"
				>Copy prompt</CopyButton
			>
		</Modal.Footer>
	</Modal.Content>
</Modal.Root>
