'use client';

import { ScrollArea, Skeleton, SkeletonText } from '@recoder/ui';
import { usePathname } from 'next/navigation';
import { Suspense, type ReactNode } from 'react';

import { PanelHeader } from '@/components/common/panel-header';
import { QueueLoading } from '@/components/queue/queue-skeleton';
import { ReviewSkeleton } from '@/components/review/review-skeleton';
import { SettingsNav } from '@/components/settings/settings-nav';
import { SettingsSectionSkeleton } from '@/components/settings/settings-skeleton';
import { SETTINGS_SECTIONS, sectionFromPath, type SettingsSection } from '@/lib/settings/sections';
import { activeTab, QUEUE_TAB } from '@/lib/shell/routes';
import { handOffOnLeave } from '@/lib/shell/skeleton-handoff';

/**
 * A page skeleton's root: the boot frame's, the shell's for a page still
 * arriving, or the fallback for a page whose code is on its way. When its
 * bars already show as it leaves, the page's own bars show at once instead
 * of holding again (`handOffOnLeave`).
 */
function RouteSkeleton({ children }: { children: ReactNode }) {
	return (
		<div ref={handOffOnLeave} data-ui="page-skeleton" className="contents">
			{children}
		</div>
	);
}

/**
 * Settings while its page loads: the section nav, the section's title and its
 * groups' skeleton, in the page's own structure, so the page lands on the
 * same lines.
 */
function SettingsLoading({ section }: { section: SettingsSection }) {
	const title = SETTINGS_SECTIONS.find((item) => item.id === section)?.label;

	return (
		<div data-ui="settings-page" className="settings-page">
			<SettingsNav active={section} />
			<div className="settings-main" aria-busy="true">
				<PanelHeader className="px-6">
					<h1 className="settings-title">{title}</h1>
				</PanelHeader>
				<ScrollArea className="min-h-0 flex-1">
					<div className="settings-column">
						<SettingsSectionSkeleton section={section} />
					</div>
				</ScrollArea>
			</div>
		</div>
	);
}

/** The page notice's title line: 27px serif on a 1.38 line, as the kit's page notice sets it. */
const NOTICE_LINE = 27 * 1.38;

/**
 * An address no page claims, while a navigation waits for it: the shape of
 * the page notice the 404 shows, in its centred column, so the canvas is
 * never bare. Route waits are short and the router announces the page that
 * lands, so it is marked busy and announces nothing itself.
 */
function NoticeLoading() {
	return (
		<RouteSkeleton>
			<div className="mx-auto w-full max-w-[640px] px-8 py-24" aria-busy="true">
				<SkeletonText count={1} lineHeight={NOTICE_LINE} barHeight={27} widths={['58%']} />
				<Skeleton className="mt-6 h-[calc(var(--size-control-md)-2px)] w-[140px] rounded-[8px]" />
			</div>
		</RouteSkeleton>
	);
}

interface PageSkeletonProps {
	/** The page's path; the address on screen when left out. */
	path?: string;
	/**
	 * The page itself, which the boot frame paints for an address no page
	 * claims (the 404): it holds no browser state, so the server can paint it
	 * as it is, and the first frame is never a bare canvas. A page that finds
	 * its address unknown as it renders (a settings section that does not
	 * exist) paints the notice's skeleton instead: the server can't paint the
	 * 404 that page asks for, so the browser renders it.
	 */
	page?: ReactNode;
}

/**
 * A page's own loading shape, picked by its path: the frame paints it in the
 * server's HTML and while the app hydrates, the shell draws it for a page
 * the router is still getting (`ShellPage`), and it stands in for a page
 * whose code is still on its way. It renders the same skeletons the pages
 * render, so the page that replaces it lands on the same lines.
 */
export function PageSkeleton({ path, page }: PageSkeletonProps) {
	const shown = usePathname();
	const pathname = path ?? shown;
	const tab = activeTab(pathname);
	const section = sectionFromPath(pathname);

	if (tab === QUEUE_TAB) {
		return (
			<RouteSkeleton>
				<QueueLoading />
			</RouteSkeleton>
		);
	}

	if (tab) {
		return (
			<RouteSkeleton>
				<ReviewSkeleton id={tab} />
			</RouteSkeleton>
		);
	}

	if (section) {
		return (
			<RouteSkeleton>
				<SettingsLoading section={section} />
			</RouteSkeleton>
		);
	}

	return page ? <Suspense fallback={<NoticeLoading />}>{page}</Suspense> : <NoticeLoading />;
}
