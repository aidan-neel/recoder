import { Button } from '@recoder/ui';
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Page not found · Recoder' };

/** An unknown address, or a docs page that does not exist. The nav stays, with a way home. */
export default function NotFound() {
	return (
		<div className="site-column">
			<h1 className="site-headline">
				<span className="site-headline-lead">This page doesn’t exist.</span>
			</h1>
			<div className="site-actions">
				<Button asChild>
					<Link href="/">Back to home</Link>
				</Button>
			</div>
		</div>
	);
}
