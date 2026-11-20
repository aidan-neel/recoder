import type { FileDiff, PullDescriptionState, PullRequest, Repo } from '@recoder/shared';
import { pullDiff, pullForge } from '../../forge/pulls/cached';
import { pullStateKey } from '../../forge/pulls/pull-states';
import { PullHeadMoved } from '../../forge/pulls/status';
import { chatCompletion, OutOfTimeError } from '../../models/llm';
import { withDescriptionUsage } from '../../models/metrics';
import { ModelConfigError } from '../../models/models';
import { sampling } from '../../models/runtime-profiles';
import { descriptionModel } from './model';
import { normalizeDescription } from './normalize';
import { descriptionPrompt } from './prompt';
import { claimDescription, finishDescription, savedDescription } from './records';

/** Leave the claim time to record its result after the model deadline, which includes slot wait. */
const MODEL_DEADLINE_MS = 170_000;

type Model = NonNullable<ReturnType<typeof descriptionModel>>;

/** Read the current head's description or schedule one generation from the pull page's diff. */
export async function pullDescription(
	repo: Repo,
	n: number,
	regenerate: boolean,
	person: string
): Promise<PullDescriptionState> {
	const id = pullStateKey(repo.id, n);
	const forge = pullForge(repo);
	let headSha = await forge.head(n);

	for (let attempt = 0; attempt < 3; attempt++) {
		const saved = await savedDescription(id, headSha, regenerate);

		if (saved) return saved;

		const model = configuredModel();

		if (!model) return { status: 'unavailable', reason: 'No chat completion model is configured for descriptions.' };

		const diff = await pullDiff(repo, n, headSha, { includeHunkless: true });
		const { pull } = await forge.view(n);

		if (diff.headSha !== pull.headSha) {
			headSha = pull.headSha;
			continue;
		}

		if (!diff.files.length) return { status: 'unavailable', reason: 'This pull request has no changed files.' };

		const settleBy = Date.now() + MODEL_DEADLINE_MS;
		const claim = await claimDescription(id, pull.headSha, regenerate);
		const { runId } = claim;

		if (runId) {
			setImmediate(() => {
				generate(id, runId, person, pull, diff.files, model, settleBy).catch(() =>
					console.error('[pull description] Could not persist the generation result.')
				);
			});
		}

		return claim.state;
	}

	throw new PullHeadMoved();
}

function configuredModel(): Model | null {
	try {
		return descriptionModel();
	} catch (error) {
		if (error instanceof ModelConfigError) return null;

		throw error;
	}
}

async function generate(
	id: string,
	runId: string,
	person: string,
	pull: PullRequest,
	files: FileDiff[],
	pick: Model,
	settleBy: number
) {
	const { headSha } = pull;
	let state: Parameters<typeof finishDescription>[2];

	try {
		if (Date.now() >= settleBy) throw new OutOfTimeError();

		const output = await withDescriptionUsage(id, person, () =>
			chatCompletion({
				...pick.config,
				messages: descriptionPrompt(pull, files),
				...sampling(pick.config, 4_000),
				maxRetries: 0,
				settleBy
			})
		);

		const copy = normalizeDescription(
			output,
			files.map((file) => file.path)
		);

		state = copy
			? {
					status: 'ready',
					description: { headSha, model: pick.model, ...copy, createdAt: new Date().toISOString() }
				}
			: { status: 'failed', headSha, error: 'The model did not return a valid description.' };
	} catch (error) {
		state = {
			status: 'failed',
			headSha,
			error:
				error instanceof OutOfTimeError
					? 'Description generation timed out.'
					: 'The description model could not complete the request.'
		};
	}

	await finishDescription(id, runId, state);
}
