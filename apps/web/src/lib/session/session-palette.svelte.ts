import { serverApi } from '$lib/api/server-api';
import { paletteContext } from '$lib/shell/palette.svelte';
import { ORCHESTRATOR_ID } from '@recoder/shared';
import { recentSessions } from './recent-sessions.svelte';
import type { SessionReview } from './session-review.svelte';

/**
 * Points the ⌘K palette at the open session: its scope, its files and the Orchestrator.
 * Call it while a component initializes; the palette lets go of the session when the component unmounts.
 */
export function scopePalette(data: SessionReview, setDiffView: (open: boolean) => void): void {
	$effect(() => {
		const review = data.review;

		if (!review) return;

		const repo = recentSessions.repos.find((item) => item.id === review.repoId)?.name ?? review.repoId.slice(0, 8);

		paletteContext.session = { id: review.id, repo: repo.split('/').pop() ?? repo, pr: review.prNumber };

		paletteContext.ask = async (text) => {
			setDiffView(false);
			await serverApi.sendReviewMessage(review.id, ORCHESTRATOR_ID, text);
		};

		paletteContext.showView = (view) => setDiffView(view === 'diff');

		return () => {
			paletteContext.session = null;
			paletteContext.ask = null;
			paletteContext.showView = null;
		};
	});

	$effect(() => {
		paletteContext.files = data.files ?? [];

		return () => {
			paletteContext.files = [];
		};
	});
}
