'use client';

import { Button, ForgeMark } from '@recoder/ui';
import { Plus } from 'lucide-react';

import type { Forge } from '@/lib/api/connections';
import { useConnections } from '@/lib/connections/connections-store';
import { FORGES, signedInForges } from '@/lib/connections/forges';

import { SetupStep } from './setup-step';

interface RepoStepProps {
	done: boolean;
	current: boolean;
	onBrowse: () => void;
	onConnect: (forge: Forge) => void;
}

/** "Tracking acme/api", or how many once there are several. */
function trackingLine(names: string[]): string {
	return names.length === 1 ? `Tracking ${names[0]}` : `Tracking ${names.length} repositories`;
}

/**
 * Step three: a repository to review. With a forge signed in it opens the
 * repo browser; without one it offers to connect GitHub or GitLab, or to add
 * a repository by URL.
 */
export function RepoStep({ done, current, onBrowse, onConnect }: RepoStepProps) {
	const names = useConnections((state) => (state.repos ?? []).map((repo) => repo.name).join('\n'));
	const signedIn = useConnections((state) => signedInForges(state.auth).length > 0);
	const lead = current ? 'primary' : 'outline';

	const description = done
		? trackingLine(names.split('\n'))
		: signedIn
			? 'Its open pull requests show up in the queue.'
			: 'Connect GitHub or GitLab to list your repositories, or add one by URL.';

	return (
		<SetupStep done={done} current={current} title="Track a repository" description={description}>
			<div className="setup-actions">
				{signedIn ? (
					<Button variant={lead} onClick={onBrowse}>
						<Plus aria-hidden />
						Browse repos
					</Button>
				) : (
					<>
						{FORGES.map((forge, index) => (
							<Button key={forge.id} variant={index === 0 ? lead : 'outline'} onClick={() => onConnect(forge.id)}>
								<ForgeMark provider={forge.id} />
								Connect {forge.label}
							</Button>
						))}
						<Button variant="ghost" onClick={onBrowse}>
							Add by URL
						</Button>
					</>
				)}
			</div>
		</SetupStep>
	);
}
