import type { ModelPolicy, ModelSettings } from '@recoder/shared';

import { savedPick } from './model-options';
import { picksPatch, type PickDraft } from './pick-source';

/** The two picks an enforced policy sets: the models members' reviews and chats run on. */
export type PolicyRole = 'orchestrator' | 'specialist';

/** The policy kinds in the order the control lists them, with what each is called. */
export const POLICY_CHOICES = [
	{ kind: 'choose', label: 'Their choice' },
	{ kind: 'enforced', label: 'Set by you' }
] as const satisfies readonly { kind: ModelPolicy['kind']; label: string }[];

/** The policy that sets members' models to the admin's own Review and Subagent picks, so switching it on changes nothing until the admin picks. */
export function enforcedFromSettings(settings: ModelSettings): ModelPolicy {
	const review = savedPick(settings, 'orchestrator');
	const subagent = savedPick(settings, 'specialist');

	return {
		kind: 'enforced',
		orchestratorModelId: review.id,
		orchestratorEffort: review.effort ?? null,
		specialistModelId: subagent.id,
		specialistEffort: subagent.effort ?? null
	};
}

/** The enforced policy with one pick changed; any other policy is returned as it is. */
export function withEnforcedPick(policy: ModelPolicy, role: PolicyRole, draft: PickDraft): ModelPolicy {
	if (policy.kind !== 'enforced') return policy;

	return { ...policy, ...picksPatch(role, draft) };
}
