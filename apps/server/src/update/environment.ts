import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { UpdateMode } from '@recoder/shared';
import { postgres } from '../storage/backend';
import { isCompiledBinary } from '../cli/self-command';
import { spawnProcess, type RunProcess } from './run';

/** How this install presents itself to the update check; injected in tests. */
export interface UpdateEnvironment {
	/** The monorepo checkout the server source lives in (git mode). */
	root: string;
	/** Shared storage or a container means a redeploy, not an in-place update. */
	managed: boolean;
	/** The running program is the compiled `recoder` binary. */
	compiledBinary: boolean;
}

/**
 * This machine's environment: PostgreSQL mode, Kubernetes or a plain Docker
 * container are managed deployments; `/$bunfs/` means the compiled binary.
 */
export function localEnvironment(): UpdateEnvironment {
	return {
		root: fileURLToPath(new URL('../../../..', import.meta.url)),
		managed: postgres !== undefined || process.env.KUBERNETES_SERVICE_HOST !== undefined || existsSync('/.dockerenv'),
		compiledBinary: isCompiledBinary()
	};
}

/**
 * How this install runs. Managed is answered first — an HA replica never
 * updates itself. A source tree that is not a git checkout cannot pull, so it
 * reports as managed too: something deployed it, and that something updates it.
 */
export async function detectUpdateMode(
	environment: UpdateEnvironment,
	run: RunProcess = spawnProcess
): Promise<{ mode: UpdateMode; managedNote?: string }> {
	if (environment.managed) {
		return {
			mode: 'managed',
			managedNote: 'This deployment updates by redeploying: apply a new image or Helm release.'
		};
	}

	if (environment.compiledBinary) return { mode: 'binary' };

	const inside = await run(['git', '-C', environment.root, 'rev-parse', '--is-inside-work-tree']);

	if (inside.exitCode === 0 && inside.stdout.trim() === 'true') return { mode: 'git' };

	return {
		mode: 'managed',
		managedNote: 'This install was not built from a git checkout or a release binary. Redeploy it to update.'
	};
}
