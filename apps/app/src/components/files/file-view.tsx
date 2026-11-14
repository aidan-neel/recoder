'use client';

import { REPO_FILE_TEXT_BYTES, type ChatTrailFile } from '@recoder/shared';
import { Button, CodeLines, langForPath, SkeletonText } from '@recoder/ui';
import { RotateCcw } from 'lucide-react';
import { useMemo, useRef } from 'react';

import { fileLines } from '@/lib/files/file-lines';
import type { RepoFileView } from '@/lib/files/use-repo-file';
import { useScrollToLines } from '@/lib/files/use-scroll-to-lines';

interface FileViewProps {
	reference: ChatTrailFile;
	file: RepoFileView;
	/** The ref as a person reads it, for the line that says the file is not there. */
	refName: string;
	onClose: () => void;
}

/** Widths of the bars that stand for code while it loads: lines of different lengths, some of them blank. */
const CODE_WIDTHS = ['46%', '72%', '58%', '0%', '64%', '38%', '82%', '54%', '68%', '0%', '50%', '76%'];

const SKELETON_LINES = 24;

const CODE_LINE_HEIGHT = 22;

/** Bars where the code will stand while the file loads. */
function CodeSkeleton() {
	return (
		<div className="file-skeleton" aria-hidden>
			<SkeletonText count={SKELETON_LINES} widths={CODE_WIDTHS} lineHeight={CODE_LINE_HEIGHT} />
		</div>
	);
}

/** The file's numbered, highlighted lines, scrolled to the lines the reference names. */
function FileCode({ reference, text, truncated }: { reference: ChatTrailFile; text: string; truncated: boolean }) {
	const scroller = useRef<HTMLDivElement | null>(null);
	const lines = useMemo(() => fileLines(text, reference), [text, reference]);

	useScrollToLines(scroller, true, reference);

	return (
		<div ref={scroller} className="file-scroll">
			<CodeLines lines={lines} lang={langForPath(reference.path)} showOldNumbers={false} className="file-code" />
			{truncated ? <p className="file-note">Only the first {REPO_FILE_TEXT_BYTES / 1024} KB is shown.</p> : null}
		</div>
	);
}

/**
 * The file on the right of the panel: its code with line numbers, or what stands in for it. Loading shows bars in
 * the code's shape, unless a file is already on show, which stays, dimmed, until the next one arrives. A binary file
 * is one line; a path the repository does not have at this ref says so; a failed read says why and offers to read
 * it again.
 */
export function FileView({ reference, file, refName, onClose }: FileViewProps) {
	const previous = file.phase === 'loading' ? file.previous : null;
	const previousReference = useMemo(() => (previous ? { path: previous.path } : null), [previous]);

	if (file.phase === 'loading') {
		if (!previous?.text || !previousReference) return <CodeSkeleton />;

		return (
			<div className="file-stale" aria-busy>
				<FileCode reference={previousReference} text={previous.text} truncated={previous.truncated} />
			</div>
		);
	}

	if (file.phase === 'missing') {
		return (
			<div className="file-state">
				<p>This file isn&apos;t in {refName}.</p>
				<Button variant="outline" onClick={onClose}>
					Close
				</Button>
			</div>
		);
	}

	if (file.phase === 'failed') {
		return (
			<div className="file-state">
				<p>{file.error}</p>
				<Button variant="outline" onClick={file.retry}>
					<RotateCcw aria-hidden />
					Retry
				</Button>
			</div>
		);
	}

	if (file.file.binary || file.file.text === undefined) {
		return (
			<div className="file-state">
				<p>This file is binary.</p>
			</div>
		);
	}

	return <FileCode key={reference.path} reference={reference} text={file.file.text} truncated={file.file.truncated} />;
}
