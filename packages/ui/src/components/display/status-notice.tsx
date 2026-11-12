import type { ReactNode } from 'react';

import { cn } from '../../lib/cn';

/**
 * Where a notice stands. `page`: a whole page that cannot show its content,
 * in the serif voice in a centred column. `section`: centred where a panel or
 * list would be. `inline`: one quiet line in the flow, its actions at the end.
 */
type NoticeVariant = 'page' | 'section' | 'inline';

/** `danger` for a failure; `neutral` for an empty or waiting state. */
type NoticeTone = 'neutral' | 'danger';

interface StatusNoticeProps {
	/** What happened, in plain short words: "Couldn’t load pull requests." */
	title: ReactNode;
	/** The reason or the way out, quieter, after the title. */
	detail?: ReactNode;
	/** Buttons that get the reader out: try again, back to the queue. */
	actions?: ReactNode;
	variant?: NoticeVariant;
	tone?: NoticeTone;
	/** `alert` interrupts a screen reader; `status` waits its turn. Defaults to `alert` for danger, else `status`. */
	role?: 'status' | 'alert';
	/** The text's element: `h1` on a page notice (`h2` under a page title), else a paragraph. */
	heading?: 'h1' | 'h2' | 'p';
	className?: string;
}

/**
 * What a page, a section or a line says when it cannot show its content: a
 * failure, an empty list, a server that does not answer. A danger tone colors
 * the title of a section or inline notice; a page notice keeps the serif
 * voice in ink. It holds no state, so a server component can render it.
 */
export function StatusNotice({
	title,
	detail,
	actions,
	variant = 'section',
	tone = 'neutral',
	role,
	heading,
	className
}: StatusNoticeProps) {
	const Text = heading ?? (variant === 'page' ? 'h1' : 'p');

	return (
		<div
			data-ui="status-notice"
			data-variant={variant}
			data-tone={tone}
			role={role ?? (tone === 'danger' ? 'alert' : 'status')}
			className={cn(className)}
		>
			<Text data-ui="status-notice-text">
				<span data-ui="status-notice-title">{title}</span>
				{detail ? (
					<>
						{' '}
						<span data-ui="status-notice-detail">{detail}</span>
					</>
				) : null}
			</Text>
			{actions ? <div data-ui="status-notice-actions">{actions}</div> : null}
		</div>
	);
}
