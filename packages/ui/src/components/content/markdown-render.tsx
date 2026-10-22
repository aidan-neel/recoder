import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { cn } from '../../lib/cn';
import { MARKDOWN_PARTS } from './markdown-parts';
import { rehypeCaret } from './rehype-caret';

type MarkdownVariant = 'ui' | 'ai';

/** What every Markdown renders from: the source, the voice and a class for the wrapper. */
interface StaticMarkdownProps {
	/** The Markdown source (GitHub flavored). Raw HTML renders as text. */
	children: string;
	/** `ui`: the UI sans for chat replies. `ai`: the Lora serif voice for summaries and findings. */
	variant?: MarkdownVariant;
	className?: string;
}

/** A client Markdown's props: text that may still be arriving. */
export interface MarkdownProps extends StaticMarkdownProps {
	/** Shows a blinking caret after the last word while the text is still arriving. */
	streaming?: boolean;
}

const REMARK = [remarkGfm];

const WITH_CARET = [rehypeCaret];

const WITHOUT_CARET: [] = [];

const VOICE: Record<MarkdownVariant, string> = {
	ui: 'font-sans text-[13.5px] leading-[1.6] text-fg',
	ai: 'ai-voice text-[16px] leading-[1.55]'
};

/**
 * The renderer both Markdown components share. It holds no state and no
 * effects, so it runs in a server component as well as on the client.
 * Paragraphs, lists, tables, quotes and links take the kit's quiet styles;
 * fenced code renders through `CodeBlock`. Safe by default: no raw HTML, and
 * only safe link protocols.
 */
export function MarkdownProse({ children, variant = 'ui', streaming = false, className }: MarkdownProps) {
	return (
		<div
			data-ui="markdown"
			data-variant={variant}
			data-state={streaming ? 'streaming' : 'complete'}
			aria-busy={streaming || undefined}
			className={cn('min-w-0 [overflow-wrap:break-word]', VOICE[variant], className)}
		>
			<ReactMarkdown
				remarkPlugins={REMARK}
				rehypePlugins={streaming ? WITH_CARET : WITHOUT_CARET}
				components={MARKDOWN_PARTS}
			>
				{children}
			</ReactMarkdown>
		</div>
	);
}

/**
 * Markdown that is complete when the page renders, such as a docs page. It
 * needs no `'use client'`, so a server component renders it to HTML and the
 * page ships none of the Markdown parser; only a code block's copy button
 * runs on the client.
 */
export function StaticMarkdown(props: StaticMarkdownProps) {
	return <MarkdownProse {...props} />;
}
