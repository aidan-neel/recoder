import { lowestEffortChatPick } from '../../models/models';

/** Prefer the worker model, falling back to Review if the worker requires an agent CLI. */
export function descriptionModel() {
	return lowestEffortChatPick('subagent') ?? lowestEffortChatPick('orchestrator');
}
