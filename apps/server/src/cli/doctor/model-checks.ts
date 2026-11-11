import type { AgentStatus, ModelProvider } from '@recoder/shared';
import { claudeCode } from '../../agents/claude-code/claude-code.js';
import { codex } from '../../agents/codex/codex.js';
import { DEVIN_MODEL_PREFIX } from '../../agents/devin/devin-models.js';
import { devin } from '../../agents/devin/devin.js';
import { findOpenCode } from '../../agents/opencode/opencode-server.js';
import { OPENCODE_MODEL_PREFIX } from '../../agents/opencode/opencode.js';
import { configForOrchestrator, configForSubagent, isReviewConfigured, type ModelConfig } from '../../models/models.js';
import { MODEL_LOOKUP_LIMIT_MS, listLiveModels, listingProblem, type ModelLookup } from '../run/model-choices.js';
import { openRunSignal } from '../run/run-signal.js';
import { CHATGPT_SIGN_IN } from '../run/chatgpt-signin.js';
import { failedCheck, passedCheck } from './check-result.js';
import type { DoctorCheck } from './doctor.js';

const NOT_CONFIGURED_FIX =
	'Configure a model in Recoder settings, or set RECODER_REVIEW_BASE_URL, RECODER_REVIEW_API_KEY and RECODER_REVIEW_MODEL.';

/** The agents whose models are listed by running them: the id prefix their models carry, and the fix for an unlisted one. */
const LISTING_AGENTS: Partial<Record<ModelProvider, { prefix: string; fix: string }>> = {
	opencode: {
		prefix: OPENCODE_MODEL_PREFIX,
		fix: 'Sign in to the model\u2019s provider with `opencode auth login`, or pick another model in Recoder settings.'
	},
	devin: {
		prefix: DEVIN_MODEL_PREFIX,
		fix: 'Sign in with `devin auth login`, or pick another model in Recoder settings.'
	}
};

/**
 * Whether a review model resolves, and which models the review and its subagents would use. A model run by OpenCode or
 * Devin must also be one its agent lists: that is how a missing sign-in shows, since OpenCode lists only the providers
 * it is signed in to. Listing runs no model, and is bounded by the same limit a review gives it. Claude Code's models
 * have no such check: its list is fixed and the CLI also takes aliases and newer ids that list lacks.
 */
export async function checkReviewModel(): Promise<DoctorCheck> {
	if (!isReviewConfigured()) return failedCheck('review-model', 'No review model is configured.', NOT_CONFIGURED_FIX);

	const configs = [configForOrchestrator(), configForSubagent()];

	const lookup: ModelLookup = {
		stop: openRunSignal(new AbortController().signal, null),
		limitMs: MODEL_LOOKUP_LIMIT_MS
	};

	const unlisted = (await Promise.all(configs.map((config) => unlistedModel(config, lookup)))).find(Boolean);

	if (unlisted) return unlisted;

	return passedCheck('review-model', `Review model ${configs[0].model}; worker model ${configs[1].model}.`);
}

/** A failed check when the model's agent does not list it; null when it does, and for a model no agent lists. */
async function unlistedModel(config: ModelConfig, lookup: ModelLookup): Promise<DoctorCheck | null> {
	const agent = config.provider ? LISTING_AGENTS[config.provider] : undefined;

	if (!agent) return null;

	const id = `${agent.prefix}${config.model}`;
	const listed = await listLiveModels(id, lookup);

	if (!listed) return null;

	if (listed.listing.kind !== 'listed') {
		return failedCheck('review-model', `${listed.agentName} ${listingProblem(listed.listing, lookup)}.`, agent.fix);
	}

	if (listed.listing.models.some((entry) => entry.id === id)) return null;

	return failedCheck('review-model', `${listed.agentName} does not offer the model "${id}".`, agent.fix);
}

/**
 * The sign-in of the agent behind each configured model, from the CLI's own status command or saved credentials. Makes
 * no model call, and does not start OpenCode's server, so OpenCode is checked only for being installed; whether it
 * offers the saved model is `checkReviewModel`'s check.
 */
export async function checkAgentSignIns(): Promise<DoctorCheck[]> {
	if (!isReviewConfigured()) return [];

	const providers = new Set([configForOrchestrator().provider, configForSubagent().provider]);
	const checks = [...providers].map((provider) => agentCheck(provider));

	return (await Promise.all(checks)).filter((check): check is DoctorCheck => check !== null);
}

async function agentCheck(provider: ModelProvider | undefined): Promise<DoctorCheck | null> {
	if (provider === 'claude-code') return cliCheck(await claudeCode.detect());
	if (provider === 'devin') return cliCheck(await devin.detect());
	if (provider === 'opencode') return openCodeCheck();
	if (provider === 'codex') return chatGptCheck();

	return null;
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

function openCodeCheck(): DoctorCheck {
	if (!findOpenCode()) {
		return failedCheck('agent:opencode', 'OpenCode is not installed.', 'Install OpenCode from https://opencode.ai.');
	}

	return passedCheck('agent:opencode', 'OpenCode is installed.');
}

async function chatGptCheck(): Promise<DoctorCheck> {
	if (await codex.signedIn()) return passedCheck('agent:chatgpt', 'ChatGPT is signed in.');

	return failedCheck('agent:chatgpt', 'ChatGPT is not signed in.', CHATGPT_SIGN_IN);
}
