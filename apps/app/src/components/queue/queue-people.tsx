'use client';

import { initials, type PrPerson } from '@recoder/shared';
import { useState } from 'react';

/** Avatars past this many collapse into a +N count. */
const SHOWN = 4;

/** One 16px avatar: the picture, or initials when there is none or it fails to load. */
function Avatar({ person }: { person: PrPerson }) {
	const [failed, setFailed] = useState(false);

	return (
		<span className="queue-avatar">
			{person.avatarUrl && !failed ? (
				/* eslint-disable-next-line @next/next/no-img-element -- 16px forge avatars from any host; next/image needs each host configured */
				<img
					src={person.avatarUrl}
					alt=""
					loading="lazy"
					referrerPolicy="no-referrer"
					onError={() => setFailed(true)}
				/>
			) : (
				initials(person.name ?? person.login)
			)}
		</span>
	);
}

/**
 * The people assigned to a pull request, as a tiny overlapping stack on the
 * row's title line. The kit has no avatar, so the queue draws its own.
 */
export function QueuePeople({ people }: { people: PrPerson[] }) {
	if (people.length === 0) return null;

	const names = `Assigned to ${people.map((person) => person.name ?? person.login).join(', ')}`;

	return (
		<span className="queue-people" role="img" title={names} aria-label={names}>
			{people.slice(0, SHOWN).map((person) => (
				<Avatar key={person.login} person={person} />
			))}
			{people.length > SHOWN ? <span className="queue-people-more">+{people.length - SHOWN}</span> : null}
		</span>
	);
}
