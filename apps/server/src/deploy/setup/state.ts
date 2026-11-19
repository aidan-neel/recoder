import type { ServerChecks, ServerCheckId } from '@recoder/shared';
import { collection } from '../../storage/backend';

interface DeploymentState {
	id: string;
	setupInitialized?: boolean;
	setupComplete?: boolean;
	builtinConfirmed?: boolean;
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
