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
	/** Open findings in this file. */
	bugs: number;
}

/** The files that sit in one folder; `folder` is empty for the top of the repository. */
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
	/** Open findings in the part's files. */
	bugs: number;
	/** How many of those are suggestions. */
	suggestions: number;
}

/** A place in the diff the Changes tab was asked to bring into view: a file, one of its lines, or a finding in it. */
export interface ChangesTarget {
	path: string;
	/** A new-side line to mark, or null for the top of the file. */
	line: number | null;
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
	/** Brings a file, one of its lines, or a finding in it into view. */
	goTo: (path: string, line?: number | null, findingId?: string | null) => void;
	/** Shuts every file, or opens every file. */
	foldAll: (open: boolean) => void;
}
