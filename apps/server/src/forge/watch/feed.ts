import type { Repo } from '@recoder/shared';
import { detectProvider } from '../providers.js';
import type { NoteStream, WatchedNote, WatchedPull } from './cursor.js';
import { githubFeed } from './github-feed.js';
import { gitlabFeed } from './gitlab-feed.js';

/** What the watcher reads from, and writes to, one repository's forge. */
export interface PullFeed {
	/** Open pull requests updated at or after `since`. */
	updatedPulls(since: string): Promise<WatchedPull[]>;
	/** A pull request's comments, at least those changed since `since`. */
	notes(number: number, since: string): Promise<WatchedNote[]>;
	/** React 👀 to the comment that summoned Recoder. */
	react(number: number, noteId: string, stream: NoteStream): Promise<void>;
}

/** GitHub and GitLab repositories have pull requests to watch; local ones don't. */
export function watchable(repo: Repo): boolean {
	return (repo.provider ?? detectProvider(repo.url)) !== 'local';
}

/** The feed for a tracked repository, or null for a local one. */
export function pullFeed(repo: Repo): PullFeed | null {
	if (!watchable(repo)) return null;

	return (repo.provider ?? detectProvider(repo.url)) === 'gitlab' ? gitlabFeed(repo) : githubFeed(repo);
}
