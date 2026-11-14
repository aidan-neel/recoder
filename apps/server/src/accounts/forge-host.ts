import type { StartDeviceSignIn } from '@recoder/shared';
import { normalizeGitlabHost } from '../forge/gitlab-host';
import type { ForgeTarget } from './forge-oauth';

const GITLAB_COM = 'gitlab.com';

/** A sign-in aimed at a host Recoder will not call. */
export class ForgeHostError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ForgeHostError';
	}
}

/**
 * The forge a sign-in goes to. The host comes from a request body, so it is held to a real DNS name: Recoder calls it
 * over https from the server, and a name that resolves to this machine (`localhost`) or an IP literal could turn the
 * sign-in into a probe of the network behind the server. A self-managed GitLab on a bare IP address needs a DNS name.
 */
export function resolveForgeTarget(request: StartDeviceSignIn): ForgeTarget {
	if (request.provider === 'github') return { provider: 'github', host: null };

	const raw = request.host?.trim() ?? '';

	if (raw === '') return { provider: 'gitlab', host: null };

	const host = normalizeGitlabHost(raw);

	if (!host) throw new ForgeHostError('That GitLab address is not a valid host.');
	if (host === GITLAB_COM) return { provider: 'gitlab', host: null };
	if (isLocalOrLiteral(host))
		throw new ForgeHostError('Use the GitLab server’s DNS name, not localhost or an IP address.');

	return { provider: 'gitlab', host };
}

/** Whether a GitLab target is on a host the server already knows: gitlab.com, or one of `knownHosts`. */
export function isKnownHost(target: ForgeTarget, knownHosts: (string | null)[]): boolean {
	if (target.provider === 'github') return true;

	return knownHosts.some((host) => (host ?? GITLAB_COM) === (target.host ?? GITLAB_COM));
}

/** `localhost`, its subdomains, and any host whose last label is a number (dotted IPv4, or the decimal and hex forms of one). */
function isLocalOrLiteral(host: string): boolean {
	const name = host.replace(/:\d+$/, '');
	const lastLabel = name.split('.').pop() ?? '';

	return name === 'localhost' || name.endsWith('.localhost') || /^(0x[0-9a-f]+|\d+)$/.test(lastLabel);
}
