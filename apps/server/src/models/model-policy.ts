import type { ModelPicks, MyModels } from '@recoder/shared';
import { ADMIN_ACCOUNT_ID } from '../accounts/account-records';
import {
	effectiveModelPolicy,
	getStoredSettings,
	hiddenModelIds,
	type ReviewSettingsInput
} from '../review/session/review-settings';
import { collection } from '../storage/backend';
import { db } from '../store';
import { runWithStarterPicks } from './llm/locked-models';
import { savedReviewModelId, withLockedModels } from './models';
import { listedModels, WRITE_WAIT_MS } from './offered-models';
import { providerSwitches } from './provider-switches';

/** A member's own picks as stored, under their account id. */
interface StoredMemberPicks extends ModelPicks {
	id: string;
}

const memberPicks = collection<StoredMemberPicks>('member_models');

const NO_PICKS: ModelPicks = {
	orchestratorModelId: null,
	orchestratorEffort: null,
	specialistModelId: null,
	specialistEffort: null
};

const PICKED_MODELS = ['orchestratorModelId', 'specialistModelId'] as const;

/**
 * The picks the admin's settings hold: what the admin's own runs use, and what a member follows until they pick.
 * The Review model is the effective one (the saved pick, else the older shared pick, else the first entry).
 */
function settingsPicks(): ModelPicks {
	const stored = getStoredSettings();

	return {
		orchestratorModelId: savedReviewModelId() ?? null,
		orchestratorEffort: stored.orchestratorEffort ?? null,
		specialistModelId: stored.specialistModelId ?? null,
		specialistEffort: stored.specialistEffort ?? null
	};
}

/**
 * The picks that replace the settings' for work `startedBy` began, or undefined when the settings apply. The admin
 * (and any work with no account) uses the settings. A member gets the enforced policy if there is one, else their own
 * picks, else the settings. An account that no longer exists is a member with no picks.
 */
async function modelPicksFor(startedBy: string | undefined): Promise<ModelPicks | undefined> {
	if (startedBy === undefined || startedBy === ADMIN_ACCOUNT_ID) return undefined;

	const policy = effectiveModelPolicy();

	if (policy.kind === 'enforced') return picksOf(policy);

	const own = await memberPicks.get(startedBy);

	return own && picksOf(own);
}

/** The picks that apply to an account, and whether the admin's policy set them. */
export async function appliedModels(accountId: string): Promise<MyModels> {
	const enforced = accountId !== ADMIN_ACCOUNT_ID && effectiveModelPolicy().kind === 'enforced';
	const picks = (await modelPicksFor(accountId)) ?? settingsPicks();

	return { ...picks, enforced };
}

/**
 * Saves the fields of `patch` as the member's own picks, the rest staying as they apply to them now. A first save
 * keeps the effective values, so a field the patch leaves out goes on resolving to what it resolved to before.
 */
export async function saveMemberPicks(accountId: string, patch: Partial<ModelPicks>): Promise<MyModels> {
	const current = (await modelPicksFor(accountId)) ?? settingsPicks();

	await memberPicks.update(accountId, (stored) => ({ id: accountId, ...(stored ?? current), ...patch }));

	return appliedModels(accountId);
}

/**
 * Runs `run` on the models work `startedBy` began resolves to (see {@link modelPicksFor}), locked as a review locks them.
 * Every model resolved under it, locked or live, uses those picks, so a follow-up never falls back to the admin's.
 */
export async function withStarterModels<T>(startedBy: string | undefined, run: () => T): Promise<Awaited<T>> {
	const picks = await modelPicksFor(startedBy);

	return await runWithStarterPicks(picks, () => withLockedModels(run));
}

/** {@link withStarterModels} for the account that started the review: its pipeline, re-reviews, fixes and discussion. */
export async function withReviewModels<T>(reviewId: string, run: () => T): Promise<Awaited<T>> {
	const review = await db.reviews.get(reviewId);

	return withStarterModels(review?.startedBy, run);
}

/**
 * Why `next` may not be saved over `current`, or null. A hidden model cannot be newly picked, but a pick already saved
 * keeps working after it is hidden: it passes while it is the model `current` already holds, and `GET /api/me/models`
 * still reports it.
 */
export function hiddenPickProblem(
	next: Partial<ModelPicks>,
	current: ModelPicks,
	hidden: ReadonlySet<string>
): string | null {
	const added = newPicks(next, current).find((id) => hidden.has(id));

	return added ? `${added} is hidden in Settings. Pick another model.` : null;
}

/**
 * Why `next` may not be saved over `current` as a member's picks or the enforced policy, or null: a new pick must be a
 * model the server lists, on a provider that is switched on. Picks that stay as they are pass, as in
 * {@link hiddenPickProblem}.
 */
export async function unavailablePickProblem(next: Partial<ModelPicks>, current: ModelPicks): Promise<string | null> {
	const added = newPicks(next, current);

	if (added.length === 0) return null;

	const switches = providerSwitches();
	const known = new Set((await listedModels(WRITE_WAIT_MS)).map((entry) => entry.id));

	for (const entry of getStoredSettings().models ?? []) known.add(entry.id);

	const unknown = added.find((id) => !known.has(id));

	if (unknown) return `${unknown} is not a model this server offers.`;

	const off = added.find((id) => switches.offProviderOf(id) !== null);

	return off ? `${off} runs on a provider that is switched off in Settings.` : null;
}

/**
 * Why a settings save must be refused, or null. The admin may pick any model the settings already allow, but not a
 * newly hidden one; an enforced policy follows the member rule, since members run on it. Hiding is judged against the
 * list the save leaves, so a save that hides a model and picks it is refused.
 */
export async function settingsPatchProblem(patch: ReviewSettingsInput): Promise<string | null> {
	const hidden = new Set(patch.hiddenModels ?? hiddenModelIds());
	const own = hiddenPickProblem(patch, settingsPicks(), hidden);

	if (own || patch.modelPolicy?.kind !== 'enforced') return own;

	const enforced = effectiveModelPolicy();
	const current = enforced.kind === 'enforced' ? enforced : NO_PICKS;

	return hiddenPickProblem(patch.modelPolicy, current, hidden) ?? unavailablePickProblem(patch.modelPolicy, current);
}

/** The hidden models a save keeps: the ids the server lists, so a model that is gone does not stay hidden. */
export async function knownHiddenModels(ids: readonly string[]): Promise<string[]> {
	const listed = new Set((await listedModels(WRITE_WAIT_MS)).map((entry) => entry.id));

	return ids.filter((id) => listed.has(id));
}

/** The models `next` picks that `current` does not already hold in the same place. */
function newPicks(next: Partial<ModelPicks>, current: ModelPicks): string[] {
	return PICKED_MODELS.flatMap((field) => {
		const id = next[field];

		return id && id !== current[field] ? [id] : [];
	});
}

function picksOf(source: ModelPicks): ModelPicks {
	return {
		orchestratorModelId: source.orchestratorModelId,
		orchestratorEffort: source.orchestratorEffort,
		specialistModelId: source.specialistModelId,
		specialistEffort: source.specialistEffort
	};
}
