import { codeParts } from '@/lib/review/labels';

/** Model prose with its `code` marks drawn as inline code that never breaks across lines. */
export function InlineText({ text }: { text: string }) {
	return codeParts(text).map((part, index) =>
		index % 2 === 1 ? (
			<code key={index} className="inline-code whitespace-nowrap">
				{part}
			</code>
		) : (
			part
		)
	);
}
