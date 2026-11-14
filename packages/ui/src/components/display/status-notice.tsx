import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { CodeBlock } from '../content/code-block';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './collapsible';
import { StatusGlyph } from './status-glyph';

/**
 * Where a notice stands. `banner`: a full-width box in the flow, at the top
 * of the content it stands for, its actions at the right; a failure, a page
 * that cannot show, a review's state. `section`: no box, centred in the room
 * an empty list would fill. `inline`: one quiet line in a form.
 */
type NoticeVariant = 'banner' | 'section' | 'inline';

/** `danger` for a failure; `neutral` for an empty or waiting state. */
type NoticeTone = 'neutral' | 'danger';

interface StatusNoticeProps {
	/** What happened, in plain short words: "The pull requests did not load." */
	title: ReactNode;
	/** Quiet facts on the title's line: when it happened, the model it ran with. */
	meta?: ReactNode;
	/** The reason or the way out, on its own line under the title. */
	detail?: ReactNode;
	/** The mark before the title. A danger notice draws the failed glyph unless given one; `null` draws none. */
	glyph?: ReactNode;
	/** Buttons that get the reader out: try again, back to the list. The way forward goes last. */
	actions?: ReactNode;
	/** What sits past a hairline under a banner's text: the steps that were kept, the error's details. */
	footer?: ReactNode;
	/** Defaults to `banner` for a danger tone, else `section`. */
	variant?: NoticeVariant;
	tone?: NoticeTone;
	/**
	 * `alert` interrupts a screen reader; `status` waits its turn. `region`
	 * announces nothing, for a notice that updates itself; name it with
	 * `label`. Defaults to `alert` for danger, else `status`.
	 */
	role?: 'status' | 'alert' | 'region';
	/** The accessible name of a `region`. */
	label?: string;
	/** The title's element: `h1` when the notice is the page, `h2` under a page title, else a paragraph. */
	heading?: 'h1' | 'h2' | 'p';
	className?: string;
}

/**
 * What a page, a section or a line says when it cannot show its content, or
 * where a long task stands: a failure, an empty list, a server that does not
 * answer. Every variant has the same parts: a glyph, the title with its facts,
 * the reason under it, the actions after it. A danger banner is tinted and
 * edged in red; the text stays in ink so the reason reads. It holds no state,
 * so a server component can render it.
 */
export function StatusNotice({
	title,
	meta,
	detail,
	glyph,
	actions,
	footer,
	variant,
	tone = 'neutral',
	role,
	label,
	heading = 'p',
	className
}: StatusNoticeProps) {
	const Title = heading;
	const mark = glyph === undefined && tone === 'danger' ? <StatusGlyph kind="failed" /> : glyph;

	return (
		<div
			data-ui="status-notice"
			data-variant={variant ?? (tone === 'danger' ? 'banner' : 'section')}
			data-tone={tone}
			role={role ?? (tone === 'danger' ? 'alert' : 'status')}
			aria-label={label}
			className={cn(className)}
		>
			<div data-ui="status-notice-body">
				{mark ? <span data-ui="status-notice-glyph">{mark}</span> : null}
				<div data-ui="status-notice-text">
					<div data-ui="status-notice-head">
						<Title data-ui="status-notice-title">{title}</Title>
						{meta ? <span data-ui="status-notice-meta">{meta}</span> : null}
					</div>
					{detail ? <p data-ui="status-notice-detail">{detail}</p> : null}
				</div>
				{actions ? <div data-ui="status-notice-actions">{actions}</div> : null}
			</div>
			{footer ? <div data-ui="status-notice-footer">{footer}</div> : null}
		</div>
	);
}

/**
 * A banner's footer that keeps the raw error out of the way: a Details line
 * that opens the text in a code block, to read or copy into a report.
 */
export function StatusNoticeDetails({ code }: { code: string }) {
	return (
		<Collapsible>
			<CollapsibleTrigger>
				<ChevronRight aria-hidden />
				Details
			</CollapsibleTrigger>
			<CollapsibleContent>
				<CodeBlock code={code} copy wrap />
			</CollapsibleContent>
		</Collapsible>
	);
}
