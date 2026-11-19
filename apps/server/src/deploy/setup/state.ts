import type { ServerChecks, ServerCheckId } from '@recoder/shared';
import { collection } from '../../storage/backend';

/** What the server keeps about the address its operator gave it (`deploy/setup/address.ts`). */
export interface StoredAddress {
	/** The full public address people reach the server at (`https://recoder.example.com`). */
	publicUrl: string;
	/** A proxy in front of Recoder ends TLS; Recoder did not ask Caddy for anything. */
	external?: boolean;
	/** The domain Caddy was configured for; its certificate is what `tls` reports. */
	domain?: string;
	/** When the certificate was requested, so a pending one can time out. */
	requestedAt?: number;
	/** When the certificate was last probed, so a pending one is not hammered with handshakes. */
	probedAt?: number;
	/** The certificate the last successful probe saw. */
	issued?: { issuer?: string; expiresAt: string; seenAt: number };
}

interface DeploymentState {
	id: string;
	setupInitialized?: boolean;
	setupComplete?: boolean;
	builtinConfirmed?: boolean;
	address?: StoredAddress;
	checks?: ServerChecks;
	checkLease?: { token: string; expiresAt: number; selected: readonly ServerCheckId[] };
}

const ID = 'deploy:setup-and-checks';
const records = collection<DeploymentState>('update_state');

export function readDeploymentState(): Promise<DeploymentState | undefined> {
	return records.get(ID);
}

export async function updateDeploymentState(change: (state: DeploymentState) => DeploymentState) {
	return (await records.update(ID, (state) => change(state ?? { id: ID })))!;
}
