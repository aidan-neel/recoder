/** How a file changed. */
export type FileChange = 'added' | 'deleted' | 'modified';

/** A row of the file tree: a folder (a chain of single-child folders is one row, `apps/server/src`) or a file. */
export type TreeRow =
	| {
			kind: 'folder';
			/** The folder's full path, unique in the tree. */
			id: string;
			label: string;
			depth: number;
			open: boolean;
			/** How many files are under it. */
			files: number;
	  }
	| {
			kind: 'file';
			/** The file's path. */
			id: string;
			name: string;
			depth: number;
			additions: number;
			deletions: number;
			change: FileChange;
			viewed: boolean;
			/** Open findings in this file. */
			bugs: number;
	  };

/** The file tree beside the diff. */
export interface FileTreeView {
	/** Visible rows, top to bottom: folders first, then files, each by name; rows inside a closed folder are left out. */
	rows: TreeRow[];
	/** Text that narrows the tree to files whose path contains it; folders with no match are left out. */
	filter: string;
	setFilter: (filter: string) => void;
	toggleFolder: (id: string) => void;
	/** The file order of the diff: the tree's order with every folder open and no filter. */
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
}
