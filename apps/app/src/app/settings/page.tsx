import type { Metadata } from 'next';

import { SettingsPage } from '@/components/settings/settings-page';
import { DEFAULT_SECTION, sectionTitle } from '@/lib/settings/sections';

export const metadata: Metadata = { title: sectionTitle(DEFAULT_SECTION) };

/** `/settings` shows the first section in place, so the first paint already has its skeleton and no redirect runs. */
export default function Page() {
	return <SettingsPage section={DEFAULT_SECTION} />;
}
