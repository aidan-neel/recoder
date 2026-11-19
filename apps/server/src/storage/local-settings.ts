import type { SharedSettingName } from '../config/shared-settings';

/** Persistent settings files that move with a standalone installation. */
export const localSettings: ReadonlyArray<{ name: SharedSettingName; file: string }> = [
	{ name: 'tokens', file: 'tokens.json' },
	{ name: 'gitlab-host', file: 'gitlab-host.json' },
	{ name: 'review-settings', file: 'review-config.json' },
	{ name: 'vllm-servers', file: 'vllm-servers.json' },
	{ name: 'global-guidelines', file: 'review-guidelines.md' },
	{ name: 'auto-review', file: 'auto-review.json' },
	{ name: 'watch-state', file: 'auto-review-state.json' },
	{ name: 'dismissals', file: 'dismissed-findings.json' },
	{ name: 'finding-votes', file: 'finding-votes.json' },
	{ name: 'learned-rules', file: 'learned-rules.json' }
];
