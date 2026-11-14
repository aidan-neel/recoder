'use client';

import type { ModelPolicy } from '@recoder/shared';

import { POLICY_CHOICES, enforcedFromSettings, withEnforcedPick, type PolicyRole } from './model-policy';
import { picksSaved, type PickDraft, type PickSource } from './pick-source';
import { useSettings } from './settings-store';
import { useInstantSave, type SaveState } from './use-save-state';

const FAILED = 'Models weren’t saved';

/** Who chooses the models members run on, and where that save stands. */
export interface ModelPolicyView {
	kind: ModelPolicy['kind'];
	/** Takes the control's value: a policy kind. "Set by you" starts from the admin's own picks. */
	choose: (value: string) => void;
	state: SaveState;
}

/** The members' models policy in Settings → Admin. It saves at once, through the settings. */
export function useModelPolicy(): ModelPolicyView {
	const policy = useSettings((state) => state.models?.modelPolicy);
	const instant = useInstantSave((next: ModelPolicy) => ({ modelPolicy: next }), FAILED);
	const kind = instant.draft?.value.kind ?? policy?.kind ?? 'choose';

	function choose(value: string): void {
		const settings = useSettings.getState().models;
		const next = POLICY_CHOICES.find((choice) => choice.kind === value);

		if (!settings || !next || next.kind === kind) return;

		instant.change(next.kind === 'enforced' ? enforcedFromSettings(settings) : { kind: 'choose' });
	}

	return { kind, choose, state: instant.state };
}

/**
 * Where the enforced policy's picks are read and saved, for the picker the
 * admin uses to set members' models. It reads the policy, and a pick saves
 * into it; nothing is locked.
 */
export function usePolicySource(role: PolicyRole): PickSource {
	const policy = useSettings((state) => state.models?.modelPolicy);

	return {
		saved: policy?.kind === 'enforced' ? picksSaved(policy, role) : null,
		locked: false,
		save: (draft: PickDraft) => {
			const current = useSettings.getState().models?.modelPolicy ?? { kind: 'choose' };

			return useSettings.getState().saveModels({ modelPolicy: withEnforcedPick(current, role, draft) });
		}
	};
}
