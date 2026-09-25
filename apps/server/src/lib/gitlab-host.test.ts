import { afterEach, expect, test } from 'bun:test';
import { hostOfRepoUrl, normalizeGitlabHost } from './gitlab-host';
import { detectProvider } from './providers';
import { tokenEnv } from './tokens';

const saved = process.env.GITLAB_HOST;
afterEach(() => {
	if (saved === undefined) delete process.env.GITLAB_HOST;
	else process.env.GITLAB_HOST = saved;
});

test('normalizes pasted GitLab URLs to a host', () => {
	expect(normalizeGitlabHost('https://GitLab.dev.Trideum.com/')).toBe('gitlab.dev.trideum.com');
	expect(normalizeGitlabHost('code.acme.io:8443')).toBe('code.acme.io:8443');
	expect(normalizeGitlabHost('gitlab.acme.com/group/repo')).toBeNull();
	expect(normalizeGitlabHost('not a host')).toBeNull();
});

test('reads the host from https and ssh repo URLs', () => {
	expect(hostOfRepoUrl('https://gitlab.dev.trideum.com/team/app')).toBe('gitlab.dev.trideum.com');
	expect(hostOfRepoUrl('git@code.acme.io:team/app.git')).toBe('code.acme.io');
});

test('a configured host counts as GitLab even without "gitlab" in it', () => {
	process.env.GITLAB_HOST = 'code.acme.io';
	expect(detectProvider('https://code.acme.io/team/app')).toBe('gitlab');
	expect(detectProvider('https://github.com/team/app')).toBe('github');
});

test('glab gets the repo host, else the configured one', () => {
	process.env.GITLAB_HOST = 'code.acme.io';
	expect(tokenEnv('gitlab', 'https://gitlab.dev.trideum.com/team/app').GITLAB_HOST).toBe('gitlab.dev.trideum.com');
	expect(tokenEnv('gitlab').GITLAB_HOST).toBe('code.acme.io');
	process.env.GITLAB_HOST = 'gitlab.com';
	expect(tokenEnv('gitlab').GITLAB_HOST).toBeUndefined();
});

test('GitLab API diffs become a git-style unified diff', async () => {
	const { toUnifiedDiff } = await import('./gitlab-api');
	const diff = toUnifiedDiff([
		{ old_path: 'a.ts', new_path: 'a.ts', diff: '@@ -1 +1 @@\n-old\n+new\n', new_file: false, renamed_file: false, deleted_file: false },
		{ old_path: 'b.ts', new_path: 'b.ts', b_mode: '100644', diff: '@@ -0,0 +1 @@\n+hi\n', new_file: true, renamed_file: false, deleted_file: false }
	]);
	expect(diff).toBe(
		'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n' +
			'diff --git a/b.ts b/b.ts\nnew file mode 100644\n--- /dev/null\n+++ b/b.ts\n@@ -0,0 +1 @@\n+hi'
	);
});
