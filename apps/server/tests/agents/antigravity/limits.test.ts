import { expect, test } from 'bun:test';
import { antigravityLimits } from '../../../src/agents/antigravity/limits';

/** A bucket of the report `agy -p /usage --output-format json` of agy 1.5.8 printed on 2026-11-13. */
function bucket(id: string, name: string, window: string, remaining: number, reset: string) {
	return {
		id,
		name,
		description: 'You have used some of your limit.',
		window,
		remaining_fraction: remaining,
		reset_time: reset
	};
}

/** That report, with other values and one disabled bucket added. */
const REPORT = {
	conversation_id: '',
	status: 'SUCCESS',
	response: 'Gemini Models\tWeekly Limit Remaining\t48%\t2026-11-19T06:12:46Z\n',
	duration_seconds: 0,
	num_turns: 0,
	command: {
		name: 'usage',
		data: {
			description: 'Within each group, models share a weekly limit and a 5-hour limit.',
			groups: [
				{
					name: 'Gemini Models',
					description: 'Models within this group: Gemini Flash, Gemini Pro',
					buckets: [
						bucket('gemini-weekly', 'Weekly Limit Remaining', 'weekly', 0.4758903980255127, '2026-11-19T06:12:46Z'),
						bucket('gemini-5h', 'Five Hour Limit Remaining', '5h', 0.83, '2026-11-13T20:34:30Z')
					]
				},
				{
					name: 'Claude and GPT models',
					buckets: [
						bucket('3p-weekly', 'Weekly Limit Remaining', 'weekly', 1, '2026-11-19T23:09:41Z'),
						{ ...bucket('3p-daily', 'Daily Limit Remaining', 'daily', 0.5, '2026-11-14T00:00:00Z'), disabled: true }
					]
				}
			]
		}
	}
};

test('each group’s buckets are windows named by length and group, used share being what is not left', () => {
	expect(antigravityLimits(REPORT)).toEqual({
		status: 'ready',
		plan: null,
		windows: [
			{ label: 'Weekly Gemini', usedPercent: 52.4, resetsAt: '2026-11-19T06:12:46.000Z' },
			{ label: '5-hour Gemini', usedPercent: 17, resetsAt: '2026-11-13T20:34:30.000Z' },
			{ label: 'Weekly Claude and GPT', usedPercent: 0, resetsAt: '2026-11-19T23:09:41.000Z' }
		]
	});
});

test('a report that did not succeed is signed out when it asks for a sign-in, else a failed read', () => {
	const signedOut = { status: 'ERROR', error: 'Please sign in to continue.' };
	const failed = { status: 'ERROR', error: 'internal' };

	expect(antigravityLimits(signedOut)).toEqual({ status: 'signed-out' });
	expect(() => antigravityLimits(failed)).toThrow('Antigravity’s usage could not be read: it reported ERROR.');
});
