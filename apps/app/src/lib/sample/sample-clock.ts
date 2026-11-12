/** The sample's story was written against this moment: its newest pull request moved five minutes before it. */
const STORY_NOW = Date.parse('2026-10-13T10:45:00.000Z');

/** How far the story is moved, so that it ends at the moment the sample loaded. */
const SHIFT = Date.now() - STORY_NOW;

/**
 * A time from the sample's story, moved to end at the moment the sample
 * loaded, so ages read "5m" and "2h" on any day, not "4w".
 */
export function sampleTime(storyTime: string): string {
	return new Date(Date.parse(storyTime) + SHIFT).toISOString();
}
