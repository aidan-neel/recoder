import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { sandboxLayout } from '../../src/sandbox/exec-sandbox';
import { ExecWorkspace } from '../../src/sandbox/exec-workspace';
import { git } from './git';

/**
 * A package manager that installs one package offline. It runs the package's
 * postinstall only when scripts are not turned off, the way the real tools do,
 * and puts one tarball into the package store like a real install.
 */
const FAKE_INSTALLER = `#!/bin/sh
mkdir -p node_modules/pkg node_modules/.bin
echo v1 > node_modules/pkg/index.js
printf 'echo ran > node_modules/POSTINSTALL_RAN\\n' > node_modules/pkg/postinstall.sh
store="\${BUN_INSTALL_CACHE_DIR:-$npm_config_store_dir}"
mkdir -p "$store/pkg@1.0.0"
echo tarball > "$store/pkg@1.0.0/index.js"
if [ -f evil.marker ]; then mkdir -p "$store/evil@1.0.0"; echo evil > "$store/evil@1.0.0/index.js"; fi
case "$*" in *--ignore-scripts*) ;; *) sh node_modules/pkg/postinstall.sh ;; esac
echo installed
`;

export interface SharedInstallFixture {
	base: string;
	workDir: string;
	sharedDir: string;
	/** Two reviews of one repo at one commit read the same lockfile; each gets its own checkout. */
	review: (name: string, edit?: (checkout: string) => Promise<void> | void) => Promise<Review>;
}

interface Review {
	workspace: ExecWorkspace;
	checkout: string;
	headSha: string;
}

/**
 * Checkouts of one local repo under a fake work dir, with fake package managers
 * on PATH. The dirs sit outside /tmp, which the sandbox always replaces with an
 * empty tmpfs, so hiding is observable. Pass the lockfile and any extra files
 * the first commit holds.
 */
export async function sharedInstallFixture(
	files: Record<string, string> = { 'bun.lock': '{}\n', 'package.json': '{"name":"app"}\n' },
	manager = 'bun'
): Promise<SharedInstallFixture> {
	const base = await mkdtemp(join(import.meta.dir, '.shared-install-'));
	const origin = join(base, 'origin');
	const bin = join(base, 'bin');
	const workDir = join(base, 'work');

	await mkdir(origin, { recursive: true });
	await mkdir(bin, { recursive: true });
	await writeFile(join(bin, manager), FAKE_INSTALLER);
	await chmod(join(bin, manager), 0o755);

	git(origin, ['init', '-q', '-b', 'main']);

	for (const [name, content] of Object.entries(files)) {
		await mkdir(dirname(join(origin, name)), { recursive: true });
		await writeFile(join(origin, name), content);
	}

	git(origin, ['add', '-A']);
	git(origin, ['commit', '-q', '-m', 'base']);

	const review = async (name: string, edit?: (checkout: string) => Promise<void> | void): Promise<Review> => {
		const checkout = join(workDir, 'repos', `acme__app__pr-1__${name}`);

		await mkdir(dirname(checkout), { recursive: true });
		git(base, ['clone', '-q', origin, checkout]);

		if (edit) {
			await edit(checkout);
			git(checkout, ['add', '-A']);
			git(checkout, ['commit', '-q', '-m', 'change']);
		}

		const headSha = git(checkout, ['rev-parse', 'HEAD']);
		const baseSha = git(checkout, ['rev-parse', 'HEAD~' + (edit ? 1 : 0)]);

		const layout = sandboxLayout(checkout, {
			home: join(base, 'home'),
			dataDir: join(base, 'data'),
			workDir,
			path: `${bin}:${process.env.PATH ?? ''}`
		});

		return {
			workspace: new ExecWorkspace(checkout, headSha, layout, { scope: 'acme__app', baseSha }),
			checkout,
			headSha
		};
	};

	return { base, workDir, sharedDir: join(workDir, 'shared'), review };
}
