import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { readSharedSetting, sharedSettingsActive, writeSharedSetting } from '../config/shared-settings';
import { serverDataDir } from '../util/data-dir';

/**
 * The GitLab instance to talk to when a repo URL doesn't say (auth checks,
 * listing projects). gitlab.com unless set in Settings or `GITLAB_HOST`.
 */

function hostFile(): string {
	return join(serverDataDir(), 'gitlab-host.json');
}

/** "https://gitlab.dev.acme.com/" → "gitlab.dev.acme.com". Null when it isn't a host. */
export function normalizeGitlabHost(input: string): string | null {
	const host = input
		.trim()
		.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
		.replace(/\/+$/, '')
		.toLowerCase();

	return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/.test(host) ? host : null;
}

export function readStoredGitlabHost(): string | null {
	if (sharedSettingsActive()) {
		const parsed = z.object({ host: z.string().nullable() }).parse(readSharedSetting('gitlab-host') ?? { host: null });

		return parsed.host ? normalizeGitlabHost(parsed.host) : null;
	}

	try {
		const parsed = JSON.parse(readFileSync(hostFile(), 'utf8')) as { host?: unknown };

		return typeof parsed.host === 'string' ? normalizeGitlabHost(parsed.host) : null;
	} catch {
		return null;
	}
}

/** The configured self-managed host, or null for gitlab.com. */
export function getGitlabHost(): string | null {
	const fromEnv = process.env.GITLAB_HOST ? normalizeGitlabHost(process.env.GITLAB_HOST) : null;
	const host = fromEnv ?? readStoredGitlabHost();

	return host === 'gitlab.com' ? null : host;
}

/** Null (or gitlab.com) clears it. */
export function setGitlabHost(host: string | null): void {
	const value = host && host !== 'gitlab.com' ? host : null;

	if (sharedSettingsActive()) {
		writeSharedSetting('gitlab-host', { host: value });

		return;
	}

	writeFileSync(hostFile(), JSON.stringify({ host: value }), { mode: 0o600 });
}

/** Host part of a repo URL (`https://host/…` or `git@host:…`). */
export function hostOfRepoUrl(url: string): string | null {
	const clean = url.trim();
	const host = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?([^/]+)/i.exec(clean)?.[1] ?? /^[^@\s]+@([^:]+):/.exec(clean)?.[1];

	return host ? normalizeGitlabHost(host) : null;
}
