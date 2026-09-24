import type { Review } from '@recoder/shared';
import { goto } from '$app/navigation';
import { sessionState, type Session } from './session-state.svelte';

/** Visual state of a session tab, derived from its backend review. */
export type TabTone = 'draft' | 'running' | 'passed' | 'failed' | 'high';

export interface SessionTab {
	id: string;
	repo: string;
	pr: string | null;
	title: string;
	tone: TabTone;
	badge: string | null;
}

interface Progress {
	tasksDone: number;
	tasksTotal: number;
}

/** Top-bar tab: status icon, repo, `#PR`, and a badge (progress, findings, failure). */
export function sessionTab(
	session: Session,
	review: Review | undefined,
	repoName: string | undefined,
	progress: Progress | undefined
): SessionTab {
	const repo = (repoName ?? session.name).split('/').at(-1) ?? session.name;
	const pr = review ? `#${review.prNumber}` : session.ref;
	const title = review?.prTitle?.trim() || session.name;
	if (!review) {
		return { id: session.id, repo, pr, title, tone: session.status === 'reviewing' ? 'running' : 'draft', badge: null };
	}
	if (review.status === 'queued' || review.status === 'running') {
		const badge = progress?.tasksTotal ? `${progress.tasksDone}/${progress.tasksTotal}` : null;
		return { id: session.id, repo, pr, title, tone: 'running', badge };
	}
	if (review.status === 'failed') return { id: session.id, repo, pr, title, tone: 'failed', badge: 'failed' };
	if (review.status === 'draft') return { id: session.id, repo, pr, title, tone: 'draft', badge: null };
	const high = review.findings.filter((finding) => finding.severity === 'error').length;
	if (high > 0) return { id: session.id, repo, pr, title, tone: 'high', badge: `${high} high` };
	return { id: session.id, repo, pr, title, tone: 'passed', badge: String(review.findings.length) };
}

/** Close a session tab; when it's the one on screen, move to its neighbour or Home. */
export async function closeSessionTab(id: string): Promise<void> {
	const viewing = typeof location !== 'undefined' && location.pathname === `/session/${id}`;
	sessionState.close(id);
	if (!viewing) return;
	const next = sessionState.activeId;
	await goto(next ? `/session/${next}` : '/');
}
