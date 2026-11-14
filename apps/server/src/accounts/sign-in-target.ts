import type { StartDeviceSignIn } from '@recoder/shared';
import { findAdmin } from './account-store';
import { ForgeHostError, isKnownHost, resolveForgeTarget } from './forge-host';
import type { ForgeTarget } from './forge-oauth';
import { knownForgeHosts } from './members';

/**
 * The forge a sign-in goes to. Once the server has an account, only a host it already knows may be signed in to,
 * unless the admin is linking another forge (`linking`).
 */
export async function resolveSignInTarget(request: StartDeviceSignIn, linking: boolean): Promise<ForgeTarget> {
	const target = resolveForgeTarget(request);

	if ((await findAdmin()) && !linking && !isKnownHost(target, await knownForgeHosts())) {
		throw new ForgeHostError('Sign in with a forge host this server already knows.');
	}

	return target;
}
