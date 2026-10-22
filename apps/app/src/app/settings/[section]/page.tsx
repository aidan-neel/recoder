import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { SettingsPage } from '@/components/settings/settings-page';
import { isSettingsSection, SETTINGS_SECTIONS, sectionTitle } from '@/lib/settings/sections';

export function generateStaticParams() {
	return SETTINGS_SECTIONS.map((section) => ({ section: section.id }));
}

/** Each section names itself in the browser tab ("Connections settings · Recoder"); an unknown one is the 404, title included. */
export async function generateMetadata({ params }: PageProps<'/settings/[section]'>): Promise<Metadata> {
	const { section } = await params;

	if (!isSettingsSection(section)) notFound();

	return { title: sectionTitle(section) };
}

export default async function Page({ params }: PageProps<'/settings/[section]'>) {
	const { section } = await params;

	if (!isSettingsSection(section)) notFound();

	return <SettingsPage section={section} />;
}
