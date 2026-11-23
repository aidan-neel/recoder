import { Pill, StatusNotice, Icon } from '@recoder/ui';

import type { PersonPageData } from '@/lib/people/types';

import { Avatar } from '@/components/common/avatar';
import { Figures } from '@/components/common/figures';

import { Handle } from './person-actions';

/** Why someone can't be messaged, in one line under their name; nothing for a member. */
function standingNote(data: PersonPageData): string | null {
	if (data.person.bot) return 'A bot account. It never signs in, so it can’t be messaged.';
	if (data.invitable)
		return `${data.name} hasn’t signed in to this Recoder server yet, so they can’t be messaged. Send them the invite link.`;
	if (data.standing.tone === 'danger') return `${data.name} was removed from this server.`;

	return null;
}

/** The top of the profile: who they are on their forge and on this server, then their work here in numbers. */
export function PersonHeader({ data }: { data: PersonPageData }) {
	const note = standingNote(data);

	return (
		<>
			<header className="person-head">
				<Avatar
					name={data.name}
					src={data.person.avatarUrl}
					shape={data.person.bot ? 'square' : 'round'}
					className="person-avatar"
				/>
				<div className="person-title">
					<h1 className="page-title">
						<span className="page-title-text">{data.name}</span>
					</h1>
					<div className="repo-facts">
						<Handle data={data} />
						<Pill tone={data.standing.tone}>{data.standing.label}</Pill>
						{data.since ? <Pill icon={<Icon name="calendar_month" />}>{data.since}</Pill> : null}
					</div>
				</div>
			</header>
			{note ? <StatusNotice variant="inline" title={note} className="person-note" /> : null}
			<Figures figures={data.figures} />
		</>
	);
}
