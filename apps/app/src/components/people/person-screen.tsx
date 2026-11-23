'use client';

import { Button, Skeleton, StatusNotice } from '@recoder/ui';
import { ArrowCounterClockwiseIcon, UserCircleDashedIcon } from '@phosphor-icons/react';
import type { PersonRef } from '@recoder/shared';

import { usePersonPage } from '@/lib/people/use-person-page';
import { useAfterPaint } from '@/lib/shell/use-after-paint';

import { Crumbs } from '@/components/common/crumbs';
import { Page } from '@/components/common/page';
import { RepoSkeleton } from '@/components/repo/repo-skeleton';

import { PersonActions } from './person-actions';
import { PersonMain, PersonSide } from './person-columns';
import { PersonHeader } from './person-header';

/**
 * A person known to this server through their forge: who they are, whether they are on this server, and their work
 * in the tracked repositories. Message is the one primary when they can be messaged. It paints once the profile is
 * in, from the repository page's skeleton, which has the same shape.
 */
export function PersonScreen({ person }: { person: PersonRef }) {
	const view = usePersonPage(person);
	const painted = useAfterPaint();
	const { data } = view;
	const loading = view.phase === 'loading' && painted;

	return (
		<Page
			start={<Crumbs parts={[{ label: data?.name ?? person.login }]} />}
			end={data ? <PersonActions data={data} onMessage={() => void view.message()} messaging={view.messaging} /> : null}
		>
			<div className="page-scroll">
				{view.phase === 'missing' ? (
					<div className="page-notice">
						<StatusNotice
							variant="banner"
							heading="h1"
							glyph={<UserCircleDashedIcon aria-hidden />}
							title={`No one called ${person.login} works in the tracked repositories.`}
							detail="The login may be mistyped, or they renamed it on the forge."
						/>
					</div>
				) : null}
				{view.phase === 'failed' ? (
					<div className="page-notice">
						<StatusNotice
							tone="danger"
							heading="h1"
							title="The profile did not load."
							detail={view.error}
							actions={
								<Button onClick={view.retry}>
									<ArrowCounterClockwiseIcon aria-hidden />
									Try again
								</Button>
							}
						/>
					</div>
				) : null}
				<Skeleton id="person-page" loading={loading}>
					{loading ? <RepoSkeleton /> : null}
					{data ? (
						<div className="page-column repo-page person-page">
							<PersonHeader data={data} />
							<div className="repo-columns">
								<PersonMain view={view} data={data} />
								<PersonSide data={data} />
							</div>
						</div>
					) : null}
				</Skeleton>
			</div>
		</Page>
	);
}
