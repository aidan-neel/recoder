'use client';

import {
	CITATION_PREFIX,
	citationRef,
	parseCitationTarget,
	type ChatCitation,
	type ChatTrailFile
} from '@recoder/shared';
import { HoverCard, HoverCardContent, HoverCardTrigger, type LinkOverride } from '@recoder/ui';
import { FileText } from 'lucide-react';
import { createContext, use, useState, type ComponentProps, type ReactNode } from 'react';

import { fileName, lineRange } from '@/lib/chat/trail';

import { useOpenFile } from './file-reference';

/** The passages a reply cites, and whether the reply is finished, so a link with no passage can be told from one still waiting for it. */
interface CitedPassages {
	citations: readonly ChatCitation[];
	complete: boolean;
}

const NO_PASSAGES: CitedPassages = { citations: [], complete: true };

export const CitedPassagesContext = createContext<CitedPassages>(NO_PASSAGES);

/** A reply's links to the repository (`#cite:path:12-20`) drawn as chips; the Markdown takes this to draw them. */
export const CITATION_LINKS: LinkOverride = { prefix: CITATION_PREFIX, component: CitationLink };

interface Passage {
	file: ChatTrailFile;
	snippet: string;
}

/**
 * A citation in a reply: the file's name with its lines, and "+1" when the link cites more than one. Resting on it
 * opens a card with each passage. While the reply is still writing the chip has no card yet; once it is finished, a
 * link to a file the server could not read is plain text, so no chip promises what the card cannot show.
 */
function CitationLink({ href, children }: { href: string; children: ReactNode }) {
	const { citations, complete } = use(CitedPassagesContext);
	const [cardOpen, setCardOpen] = useState(false);
	const files = parseCitationTarget(href);

	const passages = files.flatMap((file): Passage[] => {
		const found = citations.find((citation) => citationRef(citation) === citationRef(file));

		return found ? [{ file, snippet: found.snippet }] : [];
	});

	if (files.length === 0 || (complete && passages.length === 0)) return <>{children}</>;

	if (passages.length === 0) return <CitationChip files={files} />;

	return (
		<HoverCard open={cardOpen} onOpenChange={setCardOpen}>
			<HoverCardTrigger>
				<CitationChip files={files} onPress={() => setCardOpen(false)} />
			</HoverCardTrigger>
			<HoverCardContent className="cite-card">
				{passages.map((passage) => (
					<PassageView key={citationRef(passage.file)} passage={passage} />
				))}
			</HoverCardContent>
		</HoverCard>
	);
}

/** The chip. It passes on the props a hover card trigger gives it, so the card can hang from it; `onPress` runs when it is pressed. */
function CitationChip({
	files,
	onPress,
	...trigger
}: { files: ChatTrailFile[]; onPress?: () => void } & ComponentProps<'button'>) {
	const openFile = useOpenFile();
	const [first] = files;
	const lines = lineRange(first);

	return (
		<button
			type="button"
			className="cite-chip"
			data-openable={openFile ? '' : undefined}
			onClick={() => {
				onPress?.();
				openFile?.(first);
			}}
			{...trigger}
		>
			<FileText aria-hidden />
			<span>
				{fileName(first.path)}
				{lines ? `:${lines}` : ''}
			</span>
			{files.length > 1 ? <span className="cite-more">+{files.length - 1}</span> : null}
		</button>
	);
}

/** One passage in the card: where it is, its name and lines, and its text. */
function PassageView({ passage: { file, snippet } }: { passage: Passage }) {
	const lines = lineRange(file);
	const folder = file.path.slice(0, Math.max(0, file.path.lastIndexOf('/')));

	return (
		<section className="cite-passage">
			<p className="cite-path">
				<FileText aria-hidden />
				{folder || 'repository root'}
			</p>
			<p className="cite-title">
				{fileName(file.path)}
				{lines ? (
					<span className="cite-lines">
						{' '}
						{lines.includes('-') ? 'lines' : 'line'} {lines}
					</span>
				) : null}
			</p>
			<pre className="cite-snippet">{snippet}</pre>
		</section>
	);
}
