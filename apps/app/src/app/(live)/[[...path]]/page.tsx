import { Screens } from '@/components/shell/screens';

/**
 * The list is built ahead; any other address is built on its first request
 * and kept. Each one is the same empty page, since the browser picks the screen.
 */
export function generateStaticParams(): { path: string[] }[] {
	return [{ path: [] }];
}

/**
 * Every address of the live app. The page never reads the address on the
 * server: the browser does (`routeOf`), so going from one page to the next
 * asks this server for nothing.
 */
export default function LivePage() {
	return <Screens />;
}
