import { redirect } from 'next/navigation';

import { settingsHref } from '@/lib/shell/routes';

/** Settings opens on its first section. */
export default function SettingsPage() {
	redirect(settingsHref('models'));
}
