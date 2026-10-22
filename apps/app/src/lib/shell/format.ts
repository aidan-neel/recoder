/** A pull request author, with bots shown as agents under their plain name. */
export function author(login: string): { name: string; agent: boolean } {
	const agent = /\[bot\]$/.test(login);

	return { name: agent ? login.replace(/\[bot\]$/, '') : login, agent };
}

/** "1 decision", "3 decisions". */
export function plural(count: number, word: string, many = `${word}s`): string {
	return `${count} ${count === 1 ? word : many}`;
}

/** The repository's own name, without its owner: `api` for `acme/api`. */
export function repoName(repo: string): string {
	return repo.split('/').pop() ?? repo;
}

/** How a pull request goes by in rows, tabs and the palette: `api #214`. */
export function pullRef(repo: string, number: number): string {
	return `${repoName(repo)} #${number}`;
}

/** A pull request's title, or `Pull request #214` when it has none. */
export function pullTitle(title: string | null | undefined, number: number): string {
	return title || `Pull request #${number}`;
}
