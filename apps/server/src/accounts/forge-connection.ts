import { setGitlabHost } from '../forge/gitlab-host';
import { setToken } from '../forge/tokens';
import { clearAllCaches } from '../util/ttl-cache';
import type { ForgeTarget } from './forge-oauth';

/**
 * Makes a forge token the connection Recoder reads pull requests with: the same saved token a pasted one becomes,
 * so every forge call works the moment the sign-in finishes. The status cache clears so the app sees it at once.
 */
export function connectForge(target: ForgeTarget, accessToken: string): void {
	setToken(target.provider, accessToken);
	if (target.provider === 'gitlab') setGitlabHost(target.host);
	clearAllCaches();
}
