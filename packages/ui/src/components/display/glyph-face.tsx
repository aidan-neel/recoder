'use client';

import { ArrowUpRightIcon, CheckIcon, ProhibitIcon, GitCommitIcon, WarningIcon, XIcon } from '@phosphor-icons/react';

import { Spinner } from '../spinner';

/** Every state an item can be in, from a severity to a decided outcome or a running task. */
export type GlyphKind =
	| 'high'
	| 'medium'
	| 'low'
	| 'question'
	| 'ok'
	| 'sent'
	| 'dismissed'
	| 'failed'
	| 'cancelled'
	| 'outdated'
	| 'spinner'
	| 'idle';

/** The drawing inside one glyph face. Severities and idle draw a dot; decided states draw a small icon on a tint. */
export function GlyphFace({ kind }: { kind: GlyphKind }) {
	switch (kind) {
		case 'spinner':
			return <Spinner size={14} />;

		case 'ok':
			return <CheckIcon size={11} />;

		case 'sent':
			return <ArrowUpRightIcon size={11} />;

		case 'dismissed':
			return <XIcon size={10} />;

		case 'failed':
			return <WarningIcon size={13} />;

		case 'cancelled':
			return <ProhibitIcon size={13} />;

		case 'outdated':
			return <GitCommitIcon size={14} />;

		case 'question':
			return <span data-ui="status-glyph-q">?</span>;

		default:
			return <span data-ui="status-glyph-dot" />;
	}
}
