import type { ChatTrailFile, Repo } from '@recoder/shared';

/** Where a file lives on its forge: the repository, the ref to read it at (the default branch when omitted) and the file. */
interface ForgeFileTarget {
	repo: Pick<Repo, 'url' | 'provider' | 'defaultBranch'>;
	ref: string | undefined;
	file: ChatTrailFile;
}

/** The anchor that marks lines on the forge's page; GitLab writes the range without the second `L`. */
function lineAnchor(provider: Repo['provider'], file: ChatTrailFile): string {
	if (file.startLine === undefined) return '';

	const end = file.endLine ?? file.startLine;

	if (end === file.startLine) return `#L${file.startLine}`;

	return provider === 'gitlab' ? `#L${file.startLine}-${end}` : `#L${file.startLine}-L${end}`;
}

/**
 * The address of a file on its forge's website, with its lines marked, or null when the repository is not on a
 * forge the app knows how to link to.
 */
export function forgeFileUrl({ repo, ref, file }: ForgeFileTarget): string | null {
	if (repo.provider === 'local' || !URL.canParse(repo.url)) return null;

	const base = repo.url.replace(/\/$/, '').replace(/\.git$/, '');
	const blob = repo.provider === 'gitlab' ? '-/blob' : 'blob';

	return `${base}/${blob}/${encodeURI(ref ?? repo.defaultBranch)}/${encodeURI(file.path)}${lineAnchor(repo.provider, file)}`;
}
