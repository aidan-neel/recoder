import { effortLabel, within, type SetupChecklist, type SetupStep } from '@recoder/shared';
import type { Context } from 'hono';
import { findAdmin } from '../../accounts/account-store';
import { isLocalRequest, isSetupLocked } from '../../accounts/setup-gate';
import { opencode } from '../../agents/opencode/opencode';
import { HOSTED_PROVIDERS } from '../../models/model-providers';
import { configForOrchestrator, isReviewConfigured } from '../../models/models';
import { offeredModels } from '../../models/offered-models';
import { providerSwitches } from '../../models/provider-switches';
import { getStoredSettings } from '../../review/session/review-settings';
import { settingsOperation, storageNow } from '../../storage/backend';
import { diagnosticAddress, type AddressReader } from '../diagnostics/address';
import { checksSnapshot } from '../diagnostics/checks';
import { forgeName } from '../diagnostics/forge';
import { reviewModelLabel, reviewProviderLabel } from '../diagnostics/model';
import { storageIdentity } from '../diagnostics/storage';
import { readDeploymentState, updateDeploymentState } from './state';

const MODEL_WAIT_MS = 2000;

export async function initializeSetupChecklist(): Promise<void> {
	if ((await readDeploymentState())?.setupInitialized) return;

	const existingInstall = await settingsOperation(async () => Boolean(await findAdmin()) && isReviewConfigured());

	await updateDeploymentState((state) =>
		state.setupInitialized
			? state
			: { ...state, setupInitialized: true, setupComplete: state.setupComplete || existingInstall }
	);
}

export async function readSetupChecklist(c: Context, readAddress?: AddressReader): Promise<SetupChecklist> {
	const [steps, state, now] = await Promise.all([setupSteps(c, readAddress), readDeploymentState(), storageNow()]);

	return checklist(steps, state, now);
}

export async function confirmBuiltin(c: Context, readAddress?: AddressReader): Promise<SetupChecklist> {
	const [steps, state, now] = await Promise.all([
		setupSteps(c, readAddress),
		updateDeploymentState((state) => ({ ...state, builtinConfirmed: true })),
		storageNow()
	]);

	return checklist(steps, state, now);
}

export async function finishSetup(
	c: Context,
	readAddress?: AddressReader
): Promise<SetupChecklist | { error: string }> {
	const [steps, now] = await Promise.all([setupSteps(c, readAddress), storageNow()]);
	let error: string | undefined;

	const saved = await updateDeploymentState((state) => {
		if (state.setupComplete) return state;

		const checks = checksSnapshot(state, now);

		if (checks.running) error = 'Wait for the server checks to finish.';
		else if (checks.checks.some((check) => check.state === 'fail')) error = 'Resolve the failed server checks first.';
		else if (checklist(steps, state, now).steps.some((step) => !step.done))
			error = 'Finish the remaining setup steps first.';

		return error ? state : { ...state, setupComplete: true };
	});

	return error ? { error } : checklist(steps, saved, now);
}

function checklist(
	steps: SetupStep[],
	state: Awaited<ReturnType<typeof readDeploymentState>>,
	now: number
): SetupChecklist {
	const storage = storageIdentity();
	const checks = checksSnapshot(state, now);

	const checkDone =
		!checks.running && checks.checks.every((check) => check.state !== 'fail' && check.state !== 'pending');

	const warnings = checks.checks.filter((check) => check.state === 'warn').length;
	const storageFact = storage.kind === 'postgres' ? (storage.location ?? 'PostgreSQL') : 'Built-in database';

	return {
		steps: [
			...steps,
			step('storage', storage.kind === 'postgres' || !!state?.builtinConfirmed, storageFact),
			step(
				'check',
				checkDone,
				warnings ? `${warnings} ${warnings === 1 ? 'warning' : 'warnings'}` : 'All checks passed'
			)
		],
		complete: state?.setupComplete === true
	};
}

async function setupSteps(c: Context, readAddress?: AddressReader): Promise<SetupStep[]> {
	const [admin, locked, { publicUrl, tls }, picks] = await Promise.all([
		findAdmin(),
		isSetupLocked(c),
		diagnosticAddress(readAddress),
		setupModels()
	]);

	const forge = admin?.forges[0];
	const claim = isLocalRequest(c) ? 'On this machine' : admin ? 'Server claimed' : 'Unlocked with the setup code';
	const addressReady = !!publicUrl && (tls.state === 'issued' || tls.state === 'external');

	const addressFact = publicUrl
		? `${new URL(publicUrl).host} · ${tls.state === 'issued' ? 'certificate issued' : 'behind your proxy'}`
		: undefined;

	return [
		step('claim', !!admin || !locked, claim),
		step('address', addressReady, addressFact),
		step('admin', !!admin, forge && `${forge.login} on ${forgeName(forge.provider)}`),
		...picks
	];
}

async function setupModels(): Promise<SetupStep[]> {
	const configured = isReviewConfigured();
	const { connections, orchestratorEffort } = getStoredSettings();
	const hosted = HOSTED_PROVIDERS.find((provider) => connections?.[provider.id]);
	let model: ReturnType<typeof configForOrchestrator> | undefined;

	if (configured) {
		try {
			model = configForOrchestrator();
		} catch {}
	}

	const effort = model?.reasoningEffort ?? orchestratorEffort;
	const modelFact = configured ? `${reviewModelLabel(model)}${effort ? ` · ${effortLabel(effort)}` : ''}` : undefined;
	const provider = (configured && reviewProviderLabel(model)) || hosted?.name || (await offeredProvider());

	return [step('provider', !!provider, provider || undefined), step('model', configured, modelFact)];
}

async function offeredProvider(): Promise<string | undefined> {
	const switches = providerSwitches();

	const [models, connected] = await Promise.all([
		offeredModels({ kind: 'pickable' }, MODEL_WAIT_MS),
		switches.isOn({ kind: 'cli', id: opencode.id })
			? within(
					opencode
						.detect()
						.then((status) => (status.installed && !status.error ? opencode.providers() : []))
						.then(
							(providers) => providers.find((provider) => provider.connected)?.name,
							() => undefined
						),
					MODEL_WAIT_MS,
					undefined
				)
			: undefined
	]);

	const first = models[0];

	return (
		connected ??
		(first && (HOSTED_PROVIDERS.find((p) => p.id === first.source)?.name ?? first.agent ?? 'Model provider'))
	);
}

function step(id: SetupStep['id'], done: boolean, fact?: string): SetupStep {
	return { id, done, ...(done && fact ? { fact } : {}) };
}
