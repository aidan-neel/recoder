'use client';

import { useMembersSection } from '@/lib/members/use-members-section';

import { SectionNotice } from '@/components/settings/section-notice';
import { SettingsSkeleton } from '@/components/settings/settings-skeleton';

import { MemberList } from './member-list';
import { MembersModels } from './members-models';

/** The groups' row counts while the list loads: the admin and two members, then the models row. */
const LOADING_GROUPS = [3, 1] as const;

/** Admin → People and Models: who has signed in to this server, and whether they pick their own models. */
export function MembersSection() {
	const section = useMembersSection();

	if (section.view === 'loading') return <SettingsSkeleton groups={LOADING_GROUPS} />;

	if (section.view === 'failed') return <SectionNotice what="Members" error={section.error} retry={section.retry} />;

	return (
		<>
			<MemberList members={section.members} />
			<MembersModels />
		</>
	);
}
