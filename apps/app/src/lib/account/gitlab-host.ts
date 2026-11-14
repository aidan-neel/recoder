/** What a typed GitLab host comes to: the host to send, or why it cannot be one. */
export type GitlabHostInput = { host: string | undefined } | { error: string };

const HOST_PATTERN = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/;

/** The host of the public GitLab, which the server takes as no host at all. */
const PUBLIC_HOST = 'gitlab.com';

/**
 * Reads the self-managed host a person typed. A pasted address works: its
 * scheme and path drop away. Empty text and gitlab.com mean the public GitLab.
 */
export function readGitlabHost(text: string): GitlabHostInput {
	const typed = text.trim().replace(/^https?:\/\//i, '');
	const host = (typed.split(/[/?#]/)[0] ?? '').toLowerCase();

	if (!host || host === PUBLIC_HOST) return { host: undefined };
	if (!HOST_PATTERN.test(host)) return { error: 'Enter a host like gitlab.example.com.' };

	return { host };
}
