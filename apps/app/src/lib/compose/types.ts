import type { ImageUpload, Provider, ReviewSpeed } from '@recoder/shared';
import type { LinkFacts } from '@recoder/ui/form';

import type { PullRow, PullTarget, RepoOption } from '../pulls/types';
import type { RecentChat } from '../shell/types';
import type { ComposeMode } from './compose-mode';

/** A pull request New can review: one in a tracked repository, or one whose repository is tracked first. */
export type PickTarget = Extract<PullTarget, { kind: 'pull' | 'untracked' }>;

/** The pull request chosen to review, and its title when it is known. */
export interface ComposePick {
	target: PickTarget;
	title: string | null;
}

/** A tracked repository in the New review picker, with the forge whose mark it shows. */
export interface ComposeRepo extends RepoOption {
	provider: Provider;
}

/** What New lists over the composer: the open pull requests to choose from, and the chats to go back to. */
export interface ComposeList {
	/** The find field's text; the lists hold only what has each of its words. */
	query: string;
	/** Sets the find text. In Review mode a pasted link or `#214` is chosen instead, and the field empties. */
	setQuery: (query: string) => void;
	/** Enter in the find field: chooses the pull request the text names, when it names one. */
	settleQuery: () => void;
	/** The one repository listed, or null for all. It does not move the repository of the composer's bar. */
	repoId: string | null;
	setRepoId: (repoId: string | null) => void;
	/** Open pull requests with no review at their current head, newest activity first. */
	unreviewed: PullRow[];
	/** Open pull requests with a review at their current head, running or done, newest activity first. */
	reviewed: PullRow[];
	/** The newest chats, newest first. */
	chats: RecentChat[];
	/** True until the chats answer for the first time. */
	chatsLoading: boolean;
}

/** The New screen: choose a pull request and write what its review should look at, or start a chat about a repository. */
export interface ComposeView {
	/** What Enter starts. */
	mode: ComposeMode;
	setMode: (mode: ComposeMode) => void;
	/**
	 * What the person wrote: in Review mode the brief (what the review should
	 * look at), in Chat mode the chat's first message. A pull request typed or
	 * pasted into the brief (`#158`, a link) moves into `pick` and leaves it.
	 */
	text: string;
	setText: (text: string) => void;
	/** How fast the review Enter starts runs: the standard review, or Spark. It holds for the visit. */
	speed: ReviewSpeed;
	setSpeed: (speed: ReviewSpeed) => void;
	/** Empties the field and lets go of the pick: once the page it started has opened. */
	clear: () => void;
	/** The pull request the review starts on; null until one is chosen. Chat mode does not use it. */
	pick: ComposePick | null;
	/** Chooses the listed pull request, in its own repository. */
	choose: (row: PullRow) => void;
	/** The open pull requests of `repoId`, newest activity first: what the picker searches. */
	pulls: PullRow[];
	/** Why a pull request typed into the field could not be chosen; null once the person edits or chooses. */
	refusal: string | null;
	/** The field holds a `#158` or a link that has not moved into `pick` yet, because the person is still typing it. */
	hasTypedPull: boolean;
	/** Moves the typed `#158` or link into `pick`, as if the person had ended it with a space. */
	settle: () => void;
	/** What the field's embeds show about the links in it, from what the list knows. */
	linkFacts: LinkFacts;
	repos: ComposeRepo[];
	/** The repository the picker searches and a chat is about; the last one used, else the first tracked. */
	repoId: string | null;
	setRepoId: (repoId: string) => void;
	/** Reads the repositories and pull requests again: after one was added from the composer. */
	reload: () => void;
	/** The lists over the composer, with the find field and the repository filter that narrow them. */
	list: ComposeList;
	/** True while the repositories load for the first time. They answer fast, so a chat can start before the pulls. */
	reposLoading: boolean;
	/** True while the pull requests load for the first time; a forge can take seconds. */
	pullsLoading: boolean;
	/** How many characters a chat's first message runs over the server's limit; 0 or less when it fits. */
	overBy: number;
	/** Enter would start the review or the chat now. */
	ready: boolean;
	/**
	 * In Review mode, starts the review of `pick` (tracking its repository
	 * first when it is not tracked) with the text as its brief, which may be
	 * empty, and resolves with the pull request page to open. In Chat mode,
	 * opens a chat about `repoId` with the text as its first message and
	 * resolves with the chat's page. `images` go with the brief or the first
	 * message. It rejects with a plain sentence when nothing can start or the
	 * start fails. The text stays, so the field still shows it while the page
	 * opens.
	 */
	submit: (images: ImageUpload[]) => Promise<string>;
}
