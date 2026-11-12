import type { AgentStatus, ModelProvider } from '@recoder/shared';
import { agentById } from '../../agents/registry.js';
import { isReviewConfigured, stageConfigs, type ModelConfig } from '../../models/models.js';
import { MODEL_LOOKUP_LIMIT_MS, listLiveModels, listingProblem, type ModelLookup } from '../run/model-choices.js';
import { openRunSignal } from '../run/run-signal.js';
import { failedCheck, passedCheck } from './check-result.js';
import type { DoctorCheck } from './doctor.js';

const NOT_CONFIGURED_FIX =
	'Configure a model in Recoder settings, or set RECODER_REVIEW_BASE_URL, RECODER_REVIEW_API_KEY and RECODER_REVIEW_MODEL.';

/**
 * Whether a review model resolves, and which models the review, subagents and verifiers would use. A model run by
 * an agent CLI that lists its models by running must also be one the agent lists: that is how a missing sign-in
 * shows, since OpenCode, for one, lists only the providers it is signed in to. Listing runs no model, and is bounded
 * by the same limit a review gives it. An agent with a fixed list (Claude Code) has no such check: its CLI also takes
 * aliases and newer ids that list lacks.
 */
export async function checkReviewModel(): Promise<DoctorCheck> {
	if (!isReviewConfigured()) return failedCheck('review-model', 'No review model is configured.', NOT_CONFIGURED_FIX);

	const configs = stageConfigs();
	const [review, worker, verifier] = configs;

	const lookup: ModelLookup = {
		stop: openRunSignal(new AbortController().signal, null),
		limitMs: MODEL_LOOKUP_LIMIT_MS
	};

	const unlisted = (await Promise.all(configs.map((config) => unlistedModel(config, lookup)))).find(Boolean);

	if (unlisted) return unlisted;

	const verifierNote = verifier.model === review.model ? '' : `; verifier model ${verifier.model}`;

	return passedCheck('review-model', `Review model ${review.model}; worker model ${worker.model}${verifierNote}.`);
}

/** A failed check when the model's agent does not list it; null when it does, and for a model no agent lists. */
async function unlistedModel(config: ModelConfig, lookup: ModelLookup): Promise<DoctorCheck | null> {
	const agent = agentById(config.provider);

	if (!agent || agent.fixedModels()) return null;

	const id = `${agent.id}:${config.model}`;
	const listed = await listLiveModels(id, lookup);

	if (!listed) return null;

	if (listed.listing.kind !== 'listed') {
		return failedCheck(
			'review-model',
			`${listed.agentName} ${listingProblem(listed.listing, lookup)}.`,
			agent.signInFix
		);
	}

	if (listed.listing.models.some((entry) => entry.id === id)) return null;

	return failedCheck('review-model', `${listed.agentName} does not offer the model "${id}".`, agent.signInFix);
}

/**
 * The sign-in of the agent behind each configured model, from the CLI's own status command. Makes
 * no model call and starts nothing that outlives the check (`quickStatus`), so OpenCode is checked only for being
 * installed; whether it offers the saved model is `checkReviewModel`'s check.
 */
export async function checkAgentSignIns(): Promise<DoctorCheck[]> {
	if (!isReviewConfigured()) return [];

	const providers = new Set(stageConfigs().map((config) => config.provider));

	const checks = [...providers].map((provider) => agentCheck(provider));

	return (await Promise.all(checks)).filter((check): check is DoctorCheck => check !== null);
}

async function agentCheck(provider: ModelProvider | undefined): Promise<DoctorCheck | null> {
	const agent = agentById(provider);

	return agent ? cliCheck(await agent.quickStatus()) : null;
}

function cliCheck(status: AgentStatus): DoctorCheck {
	const id = `agent:${status.id}`;

	if (!status.installed) return failedCheck(id, `${status.name} is not installed.`, `Install it: ${status.install}`);
	if (status.error) return failedCheck(id, status.error, `Fix ${status.name}, then run \`recoder doctor\` again.`);
	if (status.signedIn === false) return failedCheck(id, `${status.name} is not signed in.`, `Sign in: ${status.login}`);
	if (status.signedIn === null)
		return passedCheck(id, `${status.name} is installed; its sign-in could not be checked.`);

	return passedCheck(id, `${[status.name, status.version].filter(Boolean).join(' ')} is signed in.`);
}
