'use client';

import type { PersonSummary } from '@recoder/shared';
import {
	CommandDialog,
	CommandEmpty,
	CommandFooter,
	CommandInput,
	CommandItem,
	CommandList,
	ForgeMark,
	SkeletonText,
	type CommandHint
} from '@recoder/ui';
import { useEffect, useState } from 'react';

import { useApi } from '@/lib/api/client';
import { failureText } from '@/lib/api/http';
import { useOpenConversation } from '@/lib/messages/open-conversation';
import { displayName } from '@/lib/people/refs';

import { Avatar } from '@/components/common/avatar';

const HINTS: CommandHint[] = [
	{ keys: ['ArrowUp', 'ArrowDown'], label: 'navigate' },
	{ keys: ['Enter'], label: 'message' },
	{ keys: ['Escape'], label: 'close' }
];

type People = { phase: 'loading' } | { phase: 'ready'; people: PersonSummary[] } | { phase: 'failed'; error: string };

/** Everyone who can be messaged, read each time the dialog opens so someone who just joined is there. */
function usePeople(open: boolean): People {
	const client = useApi();
	const [people, setPeople] = useState<People>({ phase: 'loading' });

	useEffect(() => {
		if (!open) return;

		let current = true;

		client.people.list().then(
			(list) => current && setPeople({ phase: 'ready', people: list }),
			(error: unknown) => current && setPeople({ phase: 'failed', error: failureText(error) })
		);

		return () => {
			current = false;
		};
	}, [client, open]);

	return people;
}

/** What the list says when it has no one to offer. */
function emptyText(people: People): string {
	if (people.phase === 'failed') return `The people on this server did not load. ${people.error}`;
	if (people.phase === 'ready' && people.people.length === 0) return 'No one else has signed in to this server yet.';

	return 'No one matches';
}

/** Picks someone on this server and opens the conversation with them, made on first use. */
export function NewMessageDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
	const people = usePeople(open);
	const conversation = useOpenConversation();

	/** Opens the conversation and closes the dialog. */
	function pick(person: PersonSummary): void {
		onOpenChange(false);
		void conversation.open(person.accountId);
	}

	return (
		<CommandDialog open={open} onOpenChange={onOpenChange} label="New message" className="new-message-dialog">
			<CommandInput placeholder="Message someone on this server" />
			<CommandList>
				{people.phase === 'loading' ? (
					<SkeletonText lineHeight={32} count={3} className="new-message-skeleton" />
				) : null}
				{people.phase === 'ready'
					? people.people.map((person) => (
							<CommandItem
								key={person.accountId}
								value={`${person.login} ${person.name ?? ''} ${person.accountId}`}
								leading={<Avatar name={displayName(person)} src={person.avatarUrl} />}
								detail={
									<span className="new-message-handle">
										<ForgeMark provider={person.provider} aria-hidden />@{person.login}
									</span>
								}
								onSelect={() => pick(person)}
							>
								{displayName(person)}
							</CommandItem>
						))
					: null}
				{people.phase === 'loading' ? null : <CommandEmpty>{emptyText(people)}</CommandEmpty>}
			</CommandList>
			<CommandFooter hints={HINTS} />
		</CommandDialog>
	);
}
