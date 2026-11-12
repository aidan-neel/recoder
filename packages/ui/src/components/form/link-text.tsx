'use client';

import { Link } from 'lucide-react';
import { Fragment } from 'react';

import { ForgeMark } from '../display/forge-mark';
import { Tooltip } from '../overlay/tooltip';
import { describeLink } from './link-describe';
import { docFromText, segmentsOf } from './link-model';

/**
 * Text a person wrote, with each bare `http:` or `https:` link drawn the way
 * the link field draws it. Everything else stays plain text: no markup is read.
 */
export function LinkText({ text }: { text: string }) {
	return segmentsOf(docFromText(text)).map((segment, index) => (
		<Fragment key={index}>{segment.kind === 'text' ? segment.text : <LinkEmbed url={segment.url} />}</Fragment>
	));
}

/**
 * One link outside a field: the forge's mark (or a link glyph) and a short
 * label. It is a real link that opens in a new tab, and hovering it shows the
 * full URL.
 */
function LinkEmbed({ url }: { url: string }) {
	const description = describeLink(url);

	return (
		<Tooltip content={<span data-ui="link-embed-url">{url}</span>}>
			<a
				href={url}
				target="_blank"
				rel="noopener noreferrer"
				data-ui="link-embed"
				data-kind={description.kind}
				aria-label={description.name}
			>
				{description.forge ? (
					<ForgeMark provider={description.forge} className="size-3" />
				) : (
					<Link aria-hidden className="size-3" />
				)}
				<span data-ui="link-embed-label">{description.label}</span>
			</a>
		</Tooltip>
	);
}
