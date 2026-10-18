'use client';

import { ArrowUpRight, Check, GitCommitHorizontal, TriangleAlert, X } from 'lucide-react';

import { Spinner } from '../spinner';

/** Every state an item can be in, from a severity to a decided outcome or a running task. */
export type GlyphKind =
	'high' | 'medium' | 'low' | 'question' | 'ok' | 'sent' | 'dismissed' | 'failed' | 'outdated' | 'spinner' | 'idle';

/** The drawing inside one glyph face. Severities and idle draw a dot; decided states draw a small icon on a tint. */
export function GlyphFace({ kind }: { kind: GlyphKind }) {
	switch (kind) {
		case 'spinner':
			return <Spinner size={14} />;

		case 'ok':
			return <Check size={11} strokeWidth={2.5} />;

		case 'sent':
			return <ArrowUpRight size={11} strokeWidth={2.5} />;

		case 'dismissed':
			return <X size={10} strokeWidth={2.5} />;

		case 'failed':
			return <TriangleAlert size={13} strokeWidth={2} />;

		case 'outdated':
			return <GitCommitHorizontal size={14} strokeWidth={2} />;

		case 'question':
			return <span data-ui="status-glyph-q">?</span>;

		default:
			return <span data-ui="status-glyph-dot" />;
	}
}
