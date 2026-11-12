import type { Repo } from '@recoder/shared';

/** How a clone on this machine starts its address. */
const LOCAL_PREFIX = 'file://';

/**
 * Where a tracked repository lives, for the line under its name: the forge's
 * host, or the folder of a clone on this machine. An address that does not
 * parse shows as it is.
 */
export function repoPlace(repo: Pick<Repo, 'url'>): string {
	if (repo.url.startsWith(LOCAL_PREFIX)) return repo.url.slice(LOCAL_PREFIX.length);

	return URL.canParse(repo.url) ? new URL(repo.url).host : repo.url;
}
