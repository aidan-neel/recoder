import type { RepoGuidelines } from '@recoder/shared';

/** What the editor's note line says, most pressing first: a failure, the limit, then what saving does. */
export type EditorNote =
	| { kind: 'error'; key: string; tone: 'danger'; text: string }
	| { kind: 'over'; key: string; tone: 'danger'; text: string }
	| { kind: 'blocked'; key: string; tone: 'muted' }
	| { kind: 'pending'; key: string; tone: 'muted'; text: string }
	| { kind: 'propose'; key: string; tone: 'muted'; text: string };

/** What a repository save does, or why it can't run yet. */
function repoNote(repo: RepoGuidelines): EditorNote {
	if (!repo.canPropose) return { kind: 'blocked', key: 'blocked', tone: 'muted' };

	if (repo.pending) {
		return {
			kind: 'pending',
			key: 'pending',
			tone: 'muted',
			text: `Updates #${repo.pending.number}. Reviews follow ${repo.path} once it merges.`
		};
	}

	return {
		kind: 'propose',
		key: 'propose',
		tone: 'muted',
		text: `Reviews follow ${repo.path} once the pull request merges.`
	};
}

/**
 * The one note the editor shows, most pressing first: a failure, the limit,
 * then what saving does. `length` is the trimmed count the note judges — the
 * streaming draft's while it streams, else the text's.
 */
export function editorNote({
	error,
	length,
	max,
	repo
}: {
	error: string | null;
	length: number;
	max: number;
	repo: RepoGuidelines | null;
}): EditorNote | null {
	if (error) return { kind: 'error', key: `error:${error}`, tone: 'danger', text: error };

	if (length > max) {
		return {
			kind: 'over',
			key: 'over',
			tone: 'danger',
			text: `Guidelines are limited to ${max.toLocaleString('en-US')} characters.`
		};
	}

	return repo ? repoNote(repo) : null;
}
