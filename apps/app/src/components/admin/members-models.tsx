'use client';

import { SegmentedControl } from '@recoder/ui';

import { ROLE_NAME } from '@/lib/settings/model-options';
import { POLICY_CHOICES, type PolicyRole } from '@/lib/settings/model-policy';
import { useModelPickerOf } from '@/lib/settings/use-model-picker';
import { useModelPolicy, usePolicySource } from '@/lib/settings/use-model-policy';

import { ModelPicker } from '@/components/settings/model-picker';
import { ServerSection } from '@/components/settings/server-section';
import { SettingsGroup, SettingsRow } from '@/components/settings/settings-group';

/** The picks an enforced policy sets, in the order Settings → Models lists them. */
const POLICY_ROLES: readonly PolicyRole[] = ['orchestrator', 'specialist'];

/** The control's options: who chooses. */
const WHO = POLICY_CHOICES.map((choice) => ({ value: choice.kind, label: choice.label }));

/** The row counts of the group, for the skeleton that stands in while settings load. */
const GROUP_ROWS = [1];

/** One pick the admin sets for every member: its name and the same picker as Settings → Models. */
function PolicyPickRow({ role }: { role: PolicyRole }) {
	const picker = useModelPickerOf(role, usePolicySource(role));

	return (
		<SettingsRow name={ROLE_NAME[role]} state={picker.state}>
			<ModelPicker role={role} picker={picker} />
		</SettingsRow>
	);
}

/** The group itself, once the settings it reads are loaded. */
function MembersModelsGroup() {
	const policy = useModelPolicy();

	return (
		<SettingsGroup title="Models">
			<SettingsRow name="Chosen by" state={policy.state}>
				<SegmentedControl
					aria-label="Members’ models"
					value={policy.kind}
					onValueChange={policy.choose}
					options={WHO}
				/>
			</SettingsRow>
			{policy.kind === 'enforced' ? POLICY_ROLES.map((role) => <PolicyPickRow key={role} role={role} />) : null}
		</SettingsGroup>
	);
}

/**
 * Admin → Models: whether each member picks their own Review and Subagent
 * models, or the admin sets them for everyone. It sits with the members it
 * governs; Settings → Models holds the admin's own picks.
 */
export function MembersModels() {
	return (
		<ServerSection groups={GROUP_ROWS}>
			<MembersModelsGroup />
		</ServerSection>
	);
}
