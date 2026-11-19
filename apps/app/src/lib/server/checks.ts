import type { ServerCheck, ServerCheckId } from '@recoder/shared';
import type { GlyphKind } from '@recoder/ui';

/** What each check is called on screen. */
export const CHECK_LABELS: Record<ServerCheckId, string> = {
	https: 'HTTPS',
	reachable: 'Reachable from outside',
	forge: 'Forge',
	webhooks: 'Webhooks',
	model: 'Review model',
	database: 'Database',
	disk: 'Disk',
	version: 'Version'
};

/** The glyph a check's state draws: a warning in the medium severity's colour, a skipped check as a quiet dot. */
export function checkGlyph(check: ServerCheck): GlyphKind {
	switch (check.state) {
		case 'ok':
			return 'ok';
		case 'warn':
			return 'medium';
		case 'fail':
			return 'failed';
		case 'pending':
			return 'spinner';
		case 'skipped':
			return 'idle';
	}
}

/** True when a check failed: setup cannot finish until it passes or warns. */
export function anyFailed(checks: readonly ServerCheck[]): boolean {
	return checks.some((check) => check.state === 'fail');
}
