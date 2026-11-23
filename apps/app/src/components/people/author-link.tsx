'use client';

import type { PersonRef } from '@recoder/shared';
import { Button, HoverCard, HoverCardContent, HoverCardTrigger, Pill, SkeletonText, Icon } from '@recoder/ui';
import { useEffect, useState } from 'react';
import { useStore } from 'zustand';

import { useApi, useListStore, useProfileCache } from '@/lib/api/client';
import { useOpenConversation } from '@/lib/messages/open-conversation';
import { personPageData } from '@/lib/people/person-page';
import { displayName, personHref } from '@/lib/people/refs';
import { usePersonRef } from '@/lib/people/use-person-ref';
import type { PersonPageData } from '@/lib/people/types';
import { plural } from '@/lib/shell/format';

import { Avatar } from '@/components/common/avatar';
import { Link } from '@/components/common/link';

import { Handle, PersonActions } from './person-actions';

/** Their open pull requests, reviews run and open bugs, in one line. */
function factsLine(data: PersonPageData): string {
	const [open, , reviews, bugs] = data.figures;

	return [
		plural(Number(open.value), 'open pull request'),
		plural(Number(reviews.value), 'review') + ' run',
		plural(Number(bugs.value), 'open bug')
	].join(' · ');
}

/** What the card shows: the person, where they stand here, a line of numbers, and what can be done with them. */
function PersonCard({ person }: { person: PersonRef }) {
	const client = useApi();
	const profiles = useProfileCache();
	const list = useListStore();
	const repos = useStore(list.state, (state) => state.repos);
	const conversation = useOpenConversation();
	const [profile, setProfile] = useState(() => profiles.peek(person));
	const [failed, setFailed] = useState(false);

	useEffect(() => {
		let current = true;

		profiles.read(person).then(
			(answer) => current && setProfile(answer),
			() => current && setFailed(true)
		);

		return () => {
			current = false;
		};
	}, [profiles, person]);

	const data = profile ? personPageData(profile, repos, client.base) : null;
	const href = personHref(client.base, person);

	return (
		<div className="person-card">
			<div className="person-card-head">
				<Avatar name={data?.name ?? person.login} src={data?.person.avatarUrl} className="person-card-avatar" />
				<div className="person-card-title">
					<span className="person-card-name">{data?.name ?? person.login}</span>
					{data ? (
						<span className="person-card-facts">
							<Handle data={data} />
							<Pill tone={data.standing.tone}>{data.standing.label}</Pill>
						</span>
					) : null}
				</div>
			</div>
			{data ? <p className="person-card-line">{factsLine(data)}</p> : null}
			{!data && !failed ? <SkeletonText lineHeight={18} className="person-card-line" /> : null}
			{failed && !data ? <p className="person-card-line">Their profile did not load.</p> : null}
			<div className="person-card-actions">
				{data ? (
					<PersonActions
						data={data}
						messaging={conversation.opening}
						onMessage={() => data.accountId && void conversation.open(data.accountId)}
					>
						<Button asChild variant="outline">
							<Link href={href}>
								<Icon name="person" />
								Profile
							</Link>
						</Button>
					</PersonActions>
				) : (
					<Button asChild variant="outline">
						<Link href={href}>
							<Icon name="person" />
							Profile
						</Link>
					</Button>
				)}
			</div>
		</div>
	);
}

interface AuthorLinkProps {
	/** The forge login, as the pull request or commit names it. */
	login: string;
	/** The tracked repository it belongs to, which says which forge the login is on. */
	repoId: string;
	avatarUrl?: string | null;
	/** `text`: the name alone, as a list row's meta says it. `avatar`: a small avatar before the name. */
	face?: 'text' | 'avatar';
	className?: string;
}

/**
 * A person's name, linked to their profile, with their card when the pointer rests on it or focus lands on it. In a
 * local repository, which has no people, it is the plain name.
 */
export function AuthorLink({ login, repoId, avatarUrl, face = 'text', className }: AuthorLinkProps) {
	const { base } = useApi();
	const profiles = useProfileCache();
	const person = usePersonRef(repoId, login);
	const name = displayName({ login });

	const content = (
		<>
			{face === 'avatar' ? <Avatar name={name} src={avatarUrl} className="author-avatar" /> : null}
			<span className="author-name">{name}</span>
		</>
	);

	if (!person) return <span className={className ? `author ${className}` : 'author'}>{content}</span>;

	return (
		<HoverCard onOpenChange={(open) => open && profiles.warm(person)}>
			<HoverCardTrigger>
				<Link
					href={personHref(base, person)}
					className={className ? `author author-link ${className}` : 'author author-link'}
				>
					{content}
				</Link>
			</HoverCardTrigger>
			<HoverCardContent className="person-card-surface">
				<PersonCard person={person} />
			</HoverCardContent>
		</HoverCard>
	);
}
