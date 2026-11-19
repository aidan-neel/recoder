'use client';

import type { AuthState, SetupChecklist, SetupStepId } from '@recoder/shared';
import { Card, SwapText } from '@recoder/ui';

import type { AuthApi } from '@/lib/api/accounts';
import { SAMPLE_HREF } from '@/lib/shell/routes';
import { currentStep, stepOf, stepOpen, stepsLeft } from '@/lib/setup/setup-steps';

import { Link } from '@/components/common/link';

import { AddressStep, AdminStep, ClaimStep } from './account-steps';
import { ModelStep } from './model-step';
import { ProviderStep } from './provider-step';
import { CheckStep, StorageStep } from './server-steps';

/** How the headline counts the steps left, from none to all seven. */
const COUNT_WORDS = [
	'Nothing left',
	'One step',
	'Two steps',
	'Three steps',
	'Four steps',
	'Five steps',
	'Six steps',
	'Seven steps'
] as const;

/** The sign-in a browser with no account yet makes the admin with. */
export interface SetupAccount {
	api: AuthApi;
	auth: AuthState;
}

interface ChecklistProps {
	checklist: SetupChecklist;
	/** Set before an account exists: the claim and admin steps work through it. Signed in, it is left out. */
	account?: SetupAccount;
	/** True while the checklist fades out and the pull request list takes its place. */
	leaving?: boolean;
}

/**
 * The setup checklist: seven steps in one card, the first one not done opened under its row. Before an account
 * exists only the claim, address and admin steps can open; once the admin is signed in, the rest can.
 */
export function Checklist({ checklist, account, leaving = false }: ChecklistProps) {
	const left = stepsLeft(checklist);
	const next = currentStep(checklist);

	function props(id: SetupStepId) {
		return { step: stepOf(checklist, id), current: next === id && stepOpen(id, !account) };
	}

	return (
		<div className="page-column setup" data-width="reading" data-leaving={leaving || undefined} inert={leaving}>
			<h2 className="setup-title">
				<SwapText id={left} mode="wait">
					{COUNT_WORDS[left]} before your first review
				</SwapText>
			</h2>
			<Card>
				<ClaimStep {...props('claim')} api={account?.api} />
				<AddressStep {...props('address')} />
				<AdminStep {...props('admin')} account={account} />
				<ProviderStep {...props('provider')} />
				<ModelStep {...props('model')} />
				<StorageStep {...props('storage')} />
				<CheckStep {...props('check')} />
			</Card>
			<div className="setup-foot">
				<p>Reviews run on this server. Your model provider sees the code under review.</p>
				<Link href={SAMPLE_HREF} className="text-link">
					Look at a sample
				</Link>
			</div>
		</div>
	);
}
