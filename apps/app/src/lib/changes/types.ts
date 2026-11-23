import type { FoundCounts } from '../bugs/tiers';

/** How a file changed. */
export type FileChange = 'added' | 'deleted' | 'modified';

/** A changed file as the file menu lists it. */
export interface FileEntry {
	path: string;
	name: string;
	additions: number;
	deletions: number;
	change: FileChange;
	viewed: boolean;
	/** Open findings in this file, FYI left out; null when it has none. */
	found: FoundCounts | null;
}

/** The files that sit in one folder; `folder` is empty for the top of the repository. */
/** A guide hunk's card: one hunk of a file, named by its lines and placed among the file's other hunks. */
export interface CardPart {
	/** The hunk's id, so the guide can find its card. */
	id: string;
	/** `lines 18–24`; null for a file renamed with no line changed. */
	lines: string | null;
	/** `hunk 1 of 2 in this file · the other is in 04`, `new file`, or null. */
	where: string | null;
	explanation: string | null;
	/** True when the hunk only moves code: the card starts shut on its move note. */
	moved: boolean;
	/** The review's note on where the code came from; shown, shut or open, when the card has no move note of its own. */
	note: string | null;
}

export interface FileGroup {
	folder: string;
	files: FileEntry[];
}

/** The changed files for the file menu, and the order the diff reads in. */
export interface FileTreeView {
	/** The files in tree order, gathered by folder. */
	groups: FileGroup[];
	/** The file order of the diff: folders first, each by path, then files by name. */
	order: string[];
}

/** Which files of a pull request the person marked as viewed, kept in this browser per pull request. A file whose diff changed since is no longer viewed. */
export interface ViewedFilesView {
	isViewed: (path: string) => boolean;
	count: number;
	total: number;
	toggle: (path: string) => void;
}

/** One part of the guide: files that belong together, in the order to read them. */
export interface GuidePart {
	id: string;
	/** What the part is about, in a few words. */
	title: string;
	/** Why these files belong together, or what to look at; one or two sentences. */
	reason: string;
	paths: string[];
	/** Open findings in the part's files, FYI notes left out. */
	found: FoundCounts;
}

/** A place in the diff the Changes tab was asked to bring into view: a file, one of its lines, or a finding in it. */
export interface ChangesTarget {
	path: string;
	/** A line to mark, or null for the top of the file. */
	line: number | null;
	/** Which side `line` counts on: `old` for a removed line, such as where moved code came from. */
	side: 'old' | 'new';
	/** A finding to open, or null. */
	findingId: string | null;
	/** True once the tab brought it into view, so it is not brought there again when the tab next mounts. */
	done: boolean;
}

/** A press of collapse all or expand all; every file card follows each new one once. */
export interface ChangesFold {
	open: boolean;
}

/** The Changes tab's moves that its tools and other tabs ask for. */
export interface ChangesNav {
	/** Brings a file, one of its lines (new side unless `side` says old), or a finding in it into view. */
	goTo: (path: string, line?: number | null, findingId?: string | null, side?: 'old' | 'new') => void;
	/** Shuts every file, or opens every file. */
	foldAll: (open: boolean) => void;
}
