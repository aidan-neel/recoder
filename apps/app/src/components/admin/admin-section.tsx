'use client';

import { useGuidelines } from '@/lib/guidelines/guidelines-store';
import { useGuidelinesSection } from '@/lib/guidelines/use-guidelines-section';

import { GlobalRow } from '@/components/guidelines/global-row';
import { GuidelinesConfirm } from '@/components/guidelines/guidelines-confirm';
import { SectionNotice } from '@/components/settings/section-notice';
import { SettingsGroup } from '@/components/settings/settings-group';
import { SettingsSkeleton } from '@/components/settings/settings-skeleton';

import { MembersSection } from './members-section';
import { UpdateStrip } from './update-strip';

/**
 * The global guidelines layer: what every review follows. Reads the overview
 * alone — each repository's file stays on the Guidelines page.
 */
function Guidelines() {
	const section = useGuidelinesSection(useGuidelines.getState().loadOverview);

	if (section.overview) {
		return (
			<SettingsGroup title="Guidelines">
				<GlobalRow overview={section.overview} />
			</SettingsGroup>
		);
	}

	if (section.status === 'offline' || section.status === 'failed') {
		return (
			<SectionNotice
				what="Guidelines"
				error={section.status === 'failed' ? section.error : null}
				retry={section.retry}
			/>
		);
	}

	return <SettingsSkeleton groups={[1]} />;
}

/**
 * Settings → Recoder: the running Recoder and its updates, the global review
 * guidelines, who has signed in, and their models.
 */
export function AdminSection() {
	return (
		<div className="settings">
			<UpdateStrip />
			<Guidelines />
			<MembersSection />
			<GuidelinesConfirm />
		</div>
	);
}
