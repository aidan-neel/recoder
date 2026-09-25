import type { Provider } from '@recoder/shared';
import { getGitlabHost, hostOfRepoUrl } from './gitlab-host';

export interface RepoLocator {
	provider: Provider;
	/** `owner/repo` (GitHub) or full namespace path incl. subgroups (GitLab). */
	slug: string;
}

/** github.com (or no recognizable host) → github; *gitlab* hosts and the configured GitLab host → gitlab. */
export function detectProvider(repoUrl: string): Provider {
	if (/gitlab\./i.test(repoUrl.trim())) return 'gitlab';
	const host = getGitlabHost();
	return host && hostOfRepoUrl(repoUrl) === host ? 'gitlab' : 'github';
}

/** Strip scheme/host/`git@` prefix and `.git` suffix → namespace path. */
export function parseSlug(repoUrl: string): string {
	const clean = repoUrl.trim().replace(/\.git$/, '');
	const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(clean);
	const hasUser = clean.includes('@');
	let s = clean.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
	if (hasUser) s = s.split('@').pop() ?? s;
	if (hasScheme || hasUser) s = s.replace(/^[^/:]+[/:]/, '');
	s = s.replace(/^\/+|\/+$/g, '');
	if (!s || s.includes(' ') || !s.includes('/')) {
		throw new Error(`cannot parse repo slug from ${repoUrl}`);
	}
	return s;
}

export function locateRepo(repoUrl: string): RepoLocator {
	const provider = detectProvider(repoUrl);
	const slug = parseSlug(repoUrl);
	if (provider === 'github' && slug.split('/').length !== 2) {
		throw new Error(`expected owner/repo for GitHub, got ${slug}`);
	}
	return { provider, slug };
}

/** Fetch refspec + local branch per provider (`n` = PR number / MR iid). */
export function refspecFor(
	provider: Provider,
	n: number
): { fetchRef: string; branch: string } {
	if (provider === 'gitlab') {
		return { fetchRef: `merge-requests/${n}/head:mr-${n}`, branch: `mr-${n}` };
	}
	return { fetchRef: `pull/${n}/head:pr-${n}`, branch: `pr-${n}` };
}
