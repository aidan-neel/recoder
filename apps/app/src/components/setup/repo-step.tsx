'use client';

import { Button } from '@recoder/ui';

import { useRepoStep } from '@/lib/setup/use-repo-step';

import { SetupStep } from './setup-step';

interface RepoStepProps {
	done: boolean;
	current: boolean;
	/** Opens the repository browser, which also adds one by URL. */
	onBrowse: () => void;
}

/**
 * Step three: a repository to review. With a forge signed in it opens the
 * repository browser; without one it adds a repository by URL. Forges are
 * linked at sign-in, so this step never asks for a token.
 */
export function RepoStep({ done, current, onBrowse }: RepoStepProps) {
	const step = useRepoStep(done);
	const lead = current ? 'primary' : 'outline';

	return (
		<SetupStep name="Repository" detail={step.description} done={done} current={current}>
			{done ? null : (
				<Button variant={lead} onClick={onBrowse}>
					{step.signedIn ? 'Browse repositories' : 'Add by URL'}
				</Button>
			)}
		</SetupStep>
	);
}
