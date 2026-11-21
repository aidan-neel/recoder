'use client';

import {
	CaretRightIcon,
	ChatCircleTextIcon,
	InfoIcon,
	LightbulbIcon,
	WarningIcon,
	WarningOctagonIcon
} from '@phosphor-icons/react';
import {
	Children,
	isValidElement,
	type ComponentProps,
	type ComponentType,
	type CSSProperties,
	type ReactNode
} from 'react';
import type { Components, ExtraProps } from 'react-markdown';

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../display/collapsible';
import { safeHttpUrl, safeSrcSet } from './github-markdown-plugins';
import {
	MARKDOWN_PARTS,
	partsWithInlineCode,
	partsWithLinkOverride,
	type InlineCodeComponent,
	type LinkOverride
} from './markdown-parts';

type HastElement = NonNullable<ExtraProps['node']>;

const ALIGNMENTS = new Set(['absmiddle', 'bottom', 'left', 'middle', 'right', 'top']);

/** Parses a positive numeric HTML dimension (`"32"`, `"32px"`, `16`), or null when absent or invalid. */
function parseDimension(raw: unknown): number | null {
	if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? raw : null;
	if (typeof raw !== 'string') return null;

	const match = /^\s*(\d+(?:\.\d+)?)\s*(?:px)?\s*$/i.exec(raw);

	if (!match) return null;

	const value = Number(match[1]);

	return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Inline sizing for Markdown images that preserves HTML `width`/`height` attributes (overriding
 * Tailwind Preflight's `img { height: auto }`) without distorting wide images inside narrow columns.
 */
function imageStyle(width: number | null, height: number | null): CSSProperties | undefined {
	if (width !== null && height !== null) {
		return { width, maxWidth: '100%', height: 'auto', aspectRatio: `${width} / ${height}` };
	}

	if (height !== null) return { height, width: 'auto', maxWidth: '100%' };
	if (width !== null) return { width, maxWidth: '100%', height: 'auto' };

	return undefined;
}

/** Safe alignment value from HTML `align`, or undefined when absent or unknown. */
function imageAlign(raw: unknown): string | undefined {
	if (typeof raw !== 'string') return undefined;

	const normalized = raw.trim().toLowerCase();

	return ALIGNMENTS.has(normalized) ? normalized : undefined;
}

interface GitHubImageProps extends ComponentProps<'img'> {
	align?: string;
	'data-theme-only'?: 'dark' | 'light';
}

/**
 * Renders an image from GitHub Markdown over `http:`/`https:` with no referrer.
 * Preserves explicit dimensions and alignment; unsafe or missing URLs fall back to alt text.
 */
function GitHubImage({
	src,
	srcSet,
	alt,
	title,
	width,
	height,
	align,
	'data-theme-only': themeOnly
}: GitHubImageProps) {
	const safeSrc = safeHttpUrl(src);

	if (!safeSrc) return alt ? <span>{alt}</span> : null;

	const safeSet = srcSet ? safeSrcSet(srcSet)?.srcSet : undefined;
	const parsedWidth = parseDimension(width);
	const parsedHeight = parseDimension(height);

	return (
		/* eslint-disable-next-line @next/next/no-img-element -- external forge Markdown image from arbitrary hosts; the kit is not tied to Next. */
		<img
			src={safeSrc}
			srcSet={safeSet}
			alt={alt ?? ''}
			title={title}
			width={parsedWidth ?? undefined}
			height={parsedHeight ?? undefined}
			style={imageStyle(parsedWidth, parsedHeight)}
			data-align={imageAlign(align)}
			data-theme-only={themeOnly}
			loading="lazy"
			decoding="async"
			referrerPolicy="no-referrer"
		/>
	);
}

const SCHEME_MEDIA = /prefers-color-scheme\s*:\s*(dark|light)/i;

interface PictureSource {
	src: string;
	srcSet?: string;
}

/** Extracts `prefers-color-scheme` sources and the fallback `<img>` from a sanitized `<picture>` node. */
function readPicture(node: HastElement | undefined) {
	if (!node) return null;

	let dark: PictureSource | null = null;
	let light: PictureSource | null = null;
	let fallback: HastElement | null = null;

	for (const child of node.children) {
		if (child.type !== 'element') continue;

		if (child.tagName === 'img' && !fallback) {
			fallback = child;
			continue;
		}

		if (child.tagName !== 'source') continue;

		const media = typeof child.properties.media === 'string' ? child.properties.media : '';
		const scheme = SCHEME_MEDIA.exec(media)?.[1].toLowerCase();
		const source = safeSrcSet(child.properties.srcSet);

		if (!scheme || !source) continue;
		if (scheme === 'dark' && !dark) dark = source;
		if (scheme === 'light' && !light) light = source;
	}

	return { dark, light, fallback };
}

/** String property from a HAST element, or undefined when absent. */
function stringProp(node: HastElement | null, key: string): string | undefined {
	const value = node?.properties[key];

	return typeof value === 'string' ? value : undefined;
}

/** Dimension property from a HAST element, as a string or number when present. */
function dimProp(node: HastElement | null, key: string): string | number | undefined {
	const value = node?.properties[key];

	return typeof value === 'string' || typeof value === 'number' ? value : undefined;
}

/**
 * Renders `<picture>` from GitHub Markdown so dark/light `<source media="(prefers-color-scheme: …)">`
 * images follow Recoder's active theme (`.dark` class) as well as the system preference.
 */
function GitHubPicture({ node, children }: ComponentProps<'picture'> & ExtraProps) {
	const parsed = readPicture(node);

	if (!parsed) return <picture>{children}</picture>;

	const { dark, light, fallback } = parsed;
	const fallbackSrc = safeHttpUrl(stringProp(fallback, 'src'));
	const fallbackSource: PictureSource | null = fallbackSrc ? { src: fallbackSrc } : null;

	const shared: Pick<GitHubImageProps, 'alt' | 'title' | 'width' | 'height' | 'align'> = {
		alt: stringProp(fallback, 'alt') ?? '',
		title: stringProp(fallback, 'title'),
		width: dimProp(fallback, 'width'),
		height: dimProp(fallback, 'height'),
		align: stringProp(fallback, 'align')
	};

	if (!dark && !light) {
		return fallbackSource ? <GitHubImage {...shared} src={fallbackSource.src} /> : null;
	}

	const darkSource = dark ?? fallbackSource;
	const lightSource = light ?? fallbackSource;

	if (darkSource && lightSource && darkSource.src === lightSource.src && darkSource.srcSet === lightSource.srcSet) {
		return <GitHubImage {...shared} src={darkSource.src} srcSet={darkSource.srcSet} />;
	}

	return (
		<span data-ui="markdown-picture">
			{darkSource ? (
				<GitHubImage {...shared} src={darkSource.src} srcSet={darkSource.srcSet} data-theme-only="dark" />
			) : null}
			{lightSource ? (
				<GitHubImage {...shared} src={lightSource.src} srcSet={lightSource.srcSet} data-theme-only="light" />
			) : null}
		</span>
	);
}

/** Marker component for `<summary>` inside `<details>`; `GitHubDetails` lifts its children into the trigger. */
function GitHubSummary({ children }: ComponentProps<'summary'>) {
	return <>{children}</>;
}

/** True when a React child is only whitespace text between HTML tags. */
function isWhitespace(child: ReactNode): boolean {
	return typeof child === 'string' && child.trim() === '';
}

/** Renders GitHub `<details>`/`<summary>` blocks using the kit's `Collapsible` with smooth unfold and reduced motion. */
function GitHubDetails({ open, node, children }: ComponentProps<'details'> & ExtraProps) {
	let summary: ReactNode = null;
	const body: ReactNode[] = [];

	for (const child of Children.toArray(children)) {
		if (summary === null && isValidElement<{ children?: ReactNode }>(child) && child.type === GitHubSummary) {
			summary = child.props.children;
			continue;
		}

		body.push(child);
	}

	while (body.length > 0 && isWhitespace(body[0])) body.shift();
	while (body.length > 0 && isWhitespace(body[body.length - 1])) body.pop();

	const openProp = node?.properties.open;
	const defaultOpen = Boolean(open) || (openProp !== undefined && openProp !== false && openProp !== null);

	return (
		<Collapsible defaultOpen={defaultOpen} data-markdown-details="">
			<CollapsibleTrigger data-markdown-summary="">
				<CaretRightIcon aria-hidden data-ui="disclosure-chevron" />
				<span data-ui="markdown-summary-label">{summary ?? 'Details'}</span>
			</CollapsibleTrigger>
			<CollapsibleContent>
				<div data-ui="markdown-details-body">{body}</div>
			</CollapsibleContent>
		</Collapsible>
	);
}

interface AlertSpec {
	label: string;
	Icon: ComponentType<{ 'aria-hidden'?: boolean }>;
}

const ALERTS: Record<string, AlertSpec> = {
	note: { label: 'Note', Icon: InfoIcon },
	tip: { label: 'Tip', Icon: LightbulbIcon },
	important: { label: 'Important', Icon: ChatCircleTextIcon },
	warning: { label: 'Warning', Icon: WarningIcon },
	caution: { label: 'Caution', Icon: WarningOctagonIcon }
};

type AlertBlockquoteProps = ComponentProps<'blockquote'> & ExtraProps & { 'data-alert'?: string };

/** Renders a standard blockquote, or a GitHub alert (`> [!NOTE]`, `> [!WARNING]`, …) with its icon and label. */
function GitHubBlockquote({ children, 'data-alert': alert, node: _node, ...props }: AlertBlockquoteProps) {
	const spec = alert ? ALERTS[alert] : undefined;

	if (!spec) return <blockquote {...props}>{children}</blockquote>;

	const { label, Icon } = spec;

	return (
		<blockquote {...props} data-alert={alert}>
			<p data-ui="markdown-alert-title">
				<Icon aria-hidden />
				{label}
			</p>
			{children}
		</blockquote>
	);
}

/** Element renderers for GitHub/forge Markdown: safe images, theme-aware pictures, kit collapsibles and alerts. */
const GITHUB_MARKDOWN_PARTS: Components = {
	...MARKDOWN_PARTS,
	img: GitHubImage,
	picture: GitHubPicture,
	details: GitHubDetails,
	summary: GitHubSummary,
	blockquote: GitHubBlockquote
};

const BASE_BY_ORIGIN = new Map<string, Components>();

/** One distinct base table per forge origin so `cachedMarkdown` keeps trees from different hosts apart. */
function baseForOrigin(origin: string | null): Components {
	const key = origin ?? '';
	const kept = BASE_BY_ORIGIN.get(key);

	if (kept) return kept;

	const parts: Components = { ...GITHUB_MARKDOWN_PARTS };

	BASE_BY_ORIGIN.set(key, parts);

	return parts;
}

/** The parts a GitHub Markdown renders with, memoized by origin and override identity so rendered trees stay cached. */
export function githubClientParts(
	linkOverride?: LinkOverride,
	inlineCode?: InlineCodeComponent,
	origin: string | null = null
): Components {
	const root = baseForOrigin(origin);
	const base = linkOverride ? partsWithLinkOverride(linkOverride, root) : root;

	return inlineCode ? partsWithInlineCode(base, inlineCode) : base;
}
