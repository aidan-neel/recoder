import { Fragment, type CSSProperties } from 'react';

import { DESCRIPTION, HEADLINE } from '~/lib/site';

/** Index of each sentence's first word, so the reveal staggers across both sentences. */
const FIRST_WORD = HEADLINE.map((_, sentence) =>
	HEADLINE.slice(0, sentence).reduce((count, text) => count + text.split(' ').length, 0)
);

/**
 * The home page title in the Home brief's serif. Each word resolves out of a
 * blur in turn (CSS only, so it plays from the server's HTML); screen readers
 * hear the whole headline once, through the label.
 */
export function HeroHeadline() {
	return (
		<h1 id="site-title" className="site-brief" aria-label={DESCRIPTION}>
			{HEADLINE.map((sentence, s) => (
				<span key={sentence} className={s === 0 ? 'site-brief-lead' : undefined} aria-hidden>
					{sentence.split(' ').map((word, w) => (
						<Fragment key={w}>
							<span className="hero-word" style={{ '--w': FIRST_WORD[s] + w } as CSSProperties}>
								{word}
							</span>{' '}
						</Fragment>
					))}
				</span>
			))}
		</h1>
	);
}
