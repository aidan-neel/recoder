import type { Metadata } from 'next';

import { ReposScreen } from '@/components/repo/repos-screen';

export const metadata: Metadata = { title: 'Repositories' };

export default function ReposPage() {
	return <ReposScreen />;
}
