import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { isSettingsSection, sectionTitle } from '@/lib/settings/sections';

import { SettingsScreen } from '@/components/settings/settings-screen';

interface SectionParams {
	params: Promise<{ section: string }>;
}

export async function generateMetadata({ params }: SectionParams): Promise<Metadata> {
	const { section } = await params;

	return { title: isSettingsSection(section) ? sectionTitle(section) : 'Settings' };
}

/** One section of Settings; an unknown one is a missing page. */
export default async function SettingsSectionPage({ params }: SectionParams) {
	const { section } = await params;

	if (!isSettingsSection(section)) notFound();

	return <SettingsScreen section={section} />;
}
