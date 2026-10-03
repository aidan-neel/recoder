<script lang="ts">
	import * as Card from '@sivir-ui/svelte/components/card';
	import LiveReviewProgress from '$lib/components/review/live-review-progress.svelte';
	import type { ReviewingFinding } from '$lib/components/review/reviewing-view.svelte';
	import type { SessionView } from '$lib/components/session/session-header.svelte';
	import { revealDiffLine } from '$lib/diff/reveal-line';
	import type { ReviewStream } from '$lib/review/review-stream.svelte';
	import type { FileFocus } from '$lib/session/file-focus.svelte';
	import type { SessionChat } from '$lib/session/session-chat.svelte';
	import type { SessionReview } from '$lib/session/session-review.svelte';
	import type { Review } from '@recoder/shared';

	/**
	 * "Ask reviewer": the same conversation as the Review view, reviewers and progress included, in a drawer beside
	 * the diff. It stays mounted; drag its left edge to resize, past the minimum to collapse, and back out to reopen.
	 */
	interface Props {
		data: SessionReview;
		review: Review;
		stream: ReviewStream;
		chat: SessionChat;
		focus: FileFocus;
		repo: string;
		onView: (view: SessionView) => Promise<void>;
		onStartReview: () => Promise<void>;
		onContinue: () => Promise<void>;
		onRestart: () => void;
	}

	let { data, review, stream, chat, focus, repo, onView, onStartReview, onContinue, onRestart }: Props = $props();

	function openFinding(finding: ReviewingFinding): void {
		if (finding.file) {
			focus.pick(finding.file);
			focus.showLine(finding.file, finding.line ?? null);
			if (finding.line) revealDiffLine(finding.line);
		}

		onView('diff');
	}
</script>

<div class="chat-drawer" data-open={chat.shown || undefined} style="--chat-width: {chat.width.value}rem">
	<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
	<div
		class="chat-resizer"
		role="separator"
		aria-orientation="vertical"
		aria-label={chat.shown
			? 'Resize chat. Drag right to collapse.'
			: 'Chat collapsed. Drag left or press Enter to open.'}
		aria-controls="interactive-review"
		aria-valuemin={0}
		aria-valuemax={chat.width.max * 16}
		aria-valuenow={chat.shown ? Math.round(chat.width.value * 16) : 0}
		tabindex="0"
		onpointerdown={chat.startResize}
		onkeydown={chat.resizeKey}
		ondblclick={() => chat.toggle()}
	></div>
	<div class="chat-drawer-clip">
		<section id="interactive-review" aria-label="Interactive review" class="chat-drawer-panel" inert={!chat.shown}>
			<Card.Root
				class="h-full !gap-0 overflow-hidden rounded-none border-0 border-s border-border-subtle bg-background !p-0 shadow-none"
			>
				<LiveReviewProgress
					embedded
					{review}
					{stream}
					{repo}
					files={data.stats?.files ?? null}
					additions={data.stats?.additions ?? null}
					deletions={data.stats?.deletions ?? null}
					bind:draft={chat.draft}
					bind:codeContext={chat.codeContext}
					focusKey={chat.focusKey}
					onOpenDiff={() => onView('findings')}
					onShowView={(view) => onView(view)}
					onOpenFinding={openFinding}
					{onRestart}
					onStartReview={review.status === 'draft' ? onStartReview : null}
					onContinue={review.status === 'failed' ? onContinue : null}
					restarting={data.queueing}
					actionError={data.error}
				/>
			</Card.Root>
		</section>
	</div>
</div>
