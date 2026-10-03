<script lang="ts">
	import FindingsFocus from '$lib/components/findings/findings-focus.svelte';
	import type { SessionView } from '$lib/components/session/session-header.svelte';
	import { diffPrefs } from '$lib/diff/diff-prefs.svelte';
	import { revealDiffLine } from '$lib/diff/reveal-line';
	import { findingsStore, type Finding } from '$lib/findings/findings.svelte';
	import { approvePlan, declinePlan, planApproval } from '$lib/review/plan-approval.svelte';
	import { reviewStage } from '$lib/review/review-progress-state';
	import type { FileFocus } from '$lib/session/file-focus.svelte';
	import type { SessionReview } from '$lib/session/session-review.svelte';
	import type { FileDiff } from '@recoder/shared';

	/** The Findings view: the review's findings beside the code they point at. */
	interface Props {
		data: SessionReview;
		focus: FileFocus;
		files: FileDiff[];
		branch?: string | null;
		sidePanelOpen: boolean;
		onView: (view: SessionView) => Promise<void>;
		onAsk: () => void;
		onStartReview: () => Promise<void>;
		onRestart: () => void;
	}

	let { data, focus, files, branch, sidePanelOpen, onView, onAsk, onStartReview, onRestart }: Props = $props();

	const review = $derived(data.review);

	const status = $derived<'draft' | 'running' | 'failed' | 'done'>(
		!review
			? 'done'
			: data.reviewing
				? 'running'
				: review.status === 'draft'
					? 'draft'
					: review.status === 'failed'
						? 'failed'
						: 'done'
	);

	/** "Running checks · bun test": the stage and its running step, for the empty state. */
	const stageLabel = $derived.by(() => {
		if (!data.stream || !review) return null;

		const stage = reviewStage(data.stream.progress, review.status);

		return [stage.label, stage.detail].filter(Boolean).join(' · ');
	});

	function openAt(file: string, line: number | null): void {
		focus.pick(file);
		focus.showLine(file, line);

		void onView('diff').then(() => {
			if (line !== null) revealDiffLine(line);
		});
	}

	function openFullFile(finding: Finding): void {
		focus.pick(finding.file);
		diffPrefs.setFullFile(true);
		findingsStore.discuss(finding.id);
		onView('diff');

		requestAnimationFrame(() => document.getElementById(`finding-${finding.id}`)?.scrollIntoView({ block: 'center' }));
	}
</script>

<div class="flex min-h-0 min-w-0 flex-1 {sidePanelOpen ? 'max-xl:hidden' : ''}">
	<FindingsFocus
		{files}
		toolCalls={data.stream?.progress.toolCalls ?? []}
		{branch}
		{status}
		{stageLabel}
		paused={data.stream?.progress.paused ?? false}
		approval={data.stream?.progress.approval ?? null}
		onApprove={review ? () => approvePlan(review.id) : null}
		onDecline={review ? () => declinePlan(review.id) : null}
		approving={!!review && planApproval.approving === review.id}
		onStartReview={review?.status === 'draft' ? onStartReview : null}
		onOpenDiff={() => onView('diff')}
		onAsk={data.isBackend ? onAsk : null}
		onConversation={() => onView('conversation')}
		onRestart={data.isBackend ? onRestart : null}
		onOpenAt={openAt}
		onFullFile={openFullFile}
	/>
</div>
