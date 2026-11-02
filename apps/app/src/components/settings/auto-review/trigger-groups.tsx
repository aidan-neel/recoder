'use client';

import { DEFAULT_MENTION_HANDLE } from '@recoder/shared';

import { useAutoReview } from '@/lib/settings/auto-review-store';

import { SettingsGroup } from '../settings-group';
import { MentionHandleRow } from './mention-handle-row';
import { ToggleRow, useAutoReviewSwitch } from './toggle-row';

/** The mention switch and its handle, which only matters while mentions start reviews. */
function MentionRows() {
	const handle = useAutoReview((state) => state.payload?.settings.mentionHandle ?? DEFAULT_MENTION_HANDLE);
	const mention = useAutoReviewSwitch('onMention');

	return (
		<>
			<ToggleRow
				field="onMention"
				name="Someone mentions Recoder"
				describe={(on) =>
					on
						? `A comment with ${handle} starts a review, and the rest of it is the brief`
						: 'Comments never start a review'
				}
			/>
			<MentionHandleRow disabled={!mention.on} />
		</>
	);
}

/** Settings → Auto-review: what starts a review, and what Recoder says on the pull request. */
export function TriggerGroups() {
	return (
		<>
			<SettingsGroup title="Start a review when">
				<MentionRows />
				<ToggleRow
					field="onOpened"
					name="A pull request opens"
					describe={(on) => (on ? 'Every new pull request gets a review' : 'New pull requests wait for you')}
				/>
				<ToggleRow
					field="onPushed"
					name="New commits land on a reviewed pull request"
					describe={(on) =>
						on ? 'Pull requests Recoder reviewed on its own are reviewed again' : 'A review stays on the commit it read'
					}
				/>
				<ToggleRow
					field="skipDrafts"
					name="Skip drafts"
					describe={(on) =>
						on
							? 'Drafts wait until they’re ready, unless someone mentions Recoder'
							: 'Drafts are reviewed like the rest'
					}
				/>
			</SettingsGroup>
			<SettingsGroup title="On the pull request">
				<ToggleRow
					field="postResults"
					name="Post results"
					describe={(on) =>
						on
							? 'Reacts to the mention, then posts one comment and updates it with the findings. A GitLab token needs the api scope.'
							: 'Results stay in Recoder'
					}
				/>
			</SettingsGroup>
		</>
	);
}
