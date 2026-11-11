import type { Surface } from '../terminal/surface.js';
import { wrapText } from '../terminal/text.js';

const INLINE_CODE = /`([^`\n]+)`/g;

/** Stands for a space inside an inline code span while the prose is wrapped, so a span is never broken across lines. */
const UNBROKEN_SPACE = '\u00a0';

/**
 * Prose a model wrote, wrapped to the width for a terminal: each `inline code` span is kept on one line and colored,
 * and its backticks are dropped.
 */
export function prose(text: string, width: number, surface: Surface): string[] {
	const unbroken = text.trim().replace(INLINE_CODE, (span: string) => span.replaceAll(' ', UNBROKEN_SPACE));

	return wrapText(unbroken, width).map((line) =>
		line.replace(INLINE_CODE, (_, code: string) => surface.paint.code(code.replaceAll(UNBROKEN_SPACE, ' ')))
	);
}
