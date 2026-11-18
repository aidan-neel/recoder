import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { Skeleton } from '../../src/components/display/skeleton';

/** A component that takes its text as its child, as `Markdown` does, and says what it was handed. */
function TextChild({ children }: { children: string }) {
	return <p>{typeof children}</p>;
}

test('a component under a loading skeleton still gets its lone string child as a string', () => {
	const markup = renderToStaticMarkup(
		<Skeleton loading>
			<div>
				<TextChild>some text</TextChild>
			</div>
		</Skeleton>
	);

	expect(markup).toContain('<p>string</p>');
});
