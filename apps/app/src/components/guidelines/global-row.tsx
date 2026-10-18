'use client';

import type { GuidelinesOverview } from '@recoder/shared';
import { Button } from '@recoder/ui';

import { editLayer, useGuidelinesEditor } from '@/lib/guidelines/editor-store';
import { firstRule, globalSummary, seedText } from '@/lib/guidelines/rules';

import { GuidelinesEditor } from './guidelines-editor';
import { GuidelinesRow } from './guidelines-row';

/**
 * "Every review": the global layer, saved on this machine and applied to
 * every repository. Never saved, it holds Recoder's defaults, which the
 * editor opens on so they can be adjusted rather than retyped.
 */
export function GlobalRow({ overview }: { overview: GuidelinesOverview }) {
	const open = useGuidelinesEditor((state) => state.open === 'global');
	const opened = useGuidelinesEditor((state) => state.sessions.global?.opened);
	const { global } = overview;
	const hasText = global.updatedAt === null || firstRule(global.content) !== null;

	return (
		<GuidelinesRow
			name="Every review"
			summary={globalSummary(global)}
			open={open}
			action={
				<Button variant="outline" onClick={() => editLayer('global', seedText(global.content, overview.template))}>
					{hasText ? 'Edit' : 'Write'}
				</Button>
			}
		>
			{opened === undefined ? null : (
				<GuidelinesEditor
					key={opened}
					scope="global"
					open={open}
					repo={null}
					maxChars={overview.maxChars}
					label="Global guidelines"
				/>
			)}
		</GuidelinesRow>
	);
}
