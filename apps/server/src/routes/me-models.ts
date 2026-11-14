import { Hono } from 'hono';
import { ADMIN_ACCOUNT_ID } from '../accounts/account-records';
import { requestAccountId } from '../accounts/enforcement';
import {
	appliedModels,
	hiddenPickProblem,
	saveMemberPicks,
	settingsPatchProblem,
	unavailablePickProblem
} from '../models/model-policy';
import { modelPicksPatchSchema } from '../review/session/model-pick-schemas';
import { hiddenModelIds, saveReviewSettings } from '../review/session/review-settings';
import { parseBody } from './parse-body';

/** The models the signed-in person's reviews and chats run on. Members may call these; `isAdminOnly` does not list them. */
const app = new Hono();

app.get('/', async (c) => c.json(await appliedModels(await requestAccountId(c))));

/**
 * Saves the signed-in person's picks. The admin's change the server's settings through the same save as
 * `PATCH /api/settings/models`. A member's are refused with 403 `models-enforced` while the admin enforces models,
 * and with 400 for a model that is not offered or newly hidden.
 */
app.patch('/', async (c) => {
	const body = await parseBody(c, modelPicksPatchSchema);

	if (body instanceof Response) return body;

	const accountId = await requestAccountId(c);

	if (accountId === ADMIN_ACCOUNT_ID) {
		const problem = await settingsPatchProblem(body);

		if (problem) return c.json({ error: problem }, 400);

		saveReviewSettings(body);

		return c.json(await appliedModels(accountId));
	}

	const current = await appliedModels(accountId);

	if (current.enforced) return c.json({ error: 'models-enforced' }, 403);

	const problem =
		hiddenPickProblem(body, current, new Set(hiddenModelIds())) ?? (await unavailablePickProblem(body, current));

	if (problem) return c.json({ error: problem }, 400);

	return c.json(await saveMemberPicks(accountId, body));
});

export default app;
