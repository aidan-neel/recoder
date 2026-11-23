'use client';

import { Button, ForgeMark, Tooltip, Icon } from '@recoder/ui';
import type { ReactNode } from 'react';

import { useApi } from '@/lib/api/client';
import { copyInvite } from '@/lib/people/invite';
import type { PersonPageData } from '@/lib/people/types';

interface PersonActionsProps {
	data: PersonPageData;
	/** Opens the conversation with them. */
	onMessage: () => void;
	messaging: boolean;
	/** Between the forge link and Message: the author card's Profile. */
	children?: ReactNode;
}

/**
 * What can be done with a person: open them on their forge, then message them when they are on this server, or copy
 * the invite link when they could join it. A bot and a removed member get neither.
 */
export function PersonActions({ data, onMessage, messaging, children }: PersonActionsProps) {
	const { base } = useApi();
	const forgeName = `Open on ${data.forge.label}`;

	return (
		<>
			<Tooltip content={forgeName}>
				<Button asChild variant="ghost" size="icon" aria-label={forgeName}>
					<a href={data.forge.url} target="_blank" rel="noreferrer">
						<Icon name="arrow_outward" />
					</a>
				</Button>
			</Tooltip>
			{children}
			{data.accountId ? (
				<Button variant="primary" status={messaging ? 'pending' : 'idle'} onClick={onMessage}>
					<Icon name="forum" />
					Message
				</Button>
			) : null}
			{data.invitable ? (
				<Button variant="outline" onClick={() => copyInvite(base)}>
					<Icon name="link" />
					Copy invite link
				</Button>
			) : null}
		</>
	);
}

/** The forge's mark and the person's login, as their handle reads everywhere. */
export function Handle({ data }: { data: Pick<PersonPageData, 'person' | 'handle'> }) {
	return (
		<span className="person-handle">
			<ForgeMark provider={data.person.provider} aria-hidden />@{data.handle}
		</span>
	);
}
