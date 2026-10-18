import { Button, CodeBlock } from '@recoder/ui';
import { ArrowUpRight } from 'lucide-react';
import type { Metadata } from 'next';
import type { CSSProperties } from 'react';

import { HeroDemo } from '~/components/hero-demo/hero-demo';
import { HeroHeadline } from '~/components/home/hero-headline';
import { WaitlistForm } from '~/components/home/waitlist-form';
import { DESCRIPTION, REPO_URL, SITE_URL } from '~/lib/site';

export const metadata: Metadata = {
	title: 'Recoder',
	description: DESCRIPTION,
	alternates: { canonical: SITE_URL },
	openGraph: { title: 'Recoder', description: DESCRIPTION, url: SITE_URL, type: 'website' }
};

const INSTALL = `git clone ${REPO_URL} && cd recoder && docker compose up --build`;

/** Home: the headline, the two ways in, the install line and the demo, rising in that order on first load. */
export default function Home() {
	return (
		<div className="site-column">
			<section aria-labelledby="site-title">
				<HeroHeadline />
				<div className="hero-rise mt-[22px] flex flex-wrap items-start gap-2">
					<Button asChild variant="primary" className="brief-action">
						<a href={REPO_URL}>
							Self-host on GitHub
							<ArrowUpRight aria-hidden />
						</a>
					</Button>
					<WaitlistForm />
				</div>
			</section>
			<div className="site-install hero-rise" style={{ '--d': 1 } as CSSProperties}>
				<CodeBlock code={INSTALL} copy className="install-command" />
			</div>
			<div className="hero-stage">
				<div className="hero-glow" aria-hidden />
				<HeroDemo />
			</div>
		</div>
	);
}
