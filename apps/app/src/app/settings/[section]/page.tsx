import { notFound, redirect } from 'next/navigation';

import { isSettingsSection } from '@/lib/settings/sections';

/** An old `/settings/<id>` link opens that section's modal over the queue, keeping `add=provider`. */
export default async function Page({ params, searchParams }: PageProps<'/settings/[section]'>) {
	const { section } = await params;
	const { add } = await searchParams;

	if (!isSettingsSection(section)) notFound();

	redirect(`/?settings=${section}${add === 'provider' ? '&add=provider' : ''}`);
}
