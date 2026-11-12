'use client';

import { Button } from '@recoder/ui';

import type { Forge } from '@/lib/api/connections';
import { FORGES } from '@/lib/connections/forges';
import { useRepoStep } from '@/lib/setup/use-repo-step';

import { SetupStep } from './setup-step';

interface RepoStepProps {
	done: boolean;
	current: boolean;
	/** Opens the repository browser, which also adds one by URL. */
	onBrowse: () => void;
	/** Opens the token dialog for a forge. */
	onConnect: (forge: Forge) => void;
}

/**
 * Step three: a repository to review. With a forge signed in it opens the
 * repository browser; without one it offers to connect each forge, or to add
 * a repository by URL.
 */
export function RepoStep({ done, current, onBrowse, onConnect }: RepoStepProps) {
	const step = useRepoStep(done);
	const lead = current ? 'primary' : 'outline';

	return (
		<SetupStep name="Repository" detail={step.description} done={done} current={current}>
			{!done && step.signedIn ? (
				<Button variant={lead} onClick={onBrowse}>
					Browse repositories
				</Button>
			) : null}
			{!done && !step.signedIn ? (
				<>
					{FORGES.map((forge, index) => (
						<Button key={forge.id} variant={index === 0 ? lead : 'outline'} onClick={() => onConnect(forge.id)}>
							Connect {forge.label}
						</Button>
					))}
					<Button variant="ghost" onClick={onBrowse}>
						Add by URL
					</Button>
				</>
			) : null}
		</SetupStep>
	);
}
