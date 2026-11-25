import { repoKey } from '../connections/repo-input';
import { sampleSeed } from '../sample/sample-pulls';
import { parsePullRef } from '../shell/pull-ref';

const sample = sampleSeed();

const pulls = sample.pulls.flatMap(({ repoId, pull, status }) => {
	const repo = sample.repos.find(({ id }) => id === repoId);

	return repo && status.state === 'open' ? [{ ...pull, repo: repo.name, address: repoKey(repo.url) }] : [];
});

export type LabPull = (typeof pulls)[number];

const examples = [
	{
		repo: 'acme/api',
		number: 216,
		label: 'Usage exports',
		age: '5 min ago',
		terms: ['usage exports', 's3'],
		brief: 'Review the usage exports. Check how partial uploads recover after a retry.'
	},
	{
		repo: 'acme/api',
		number: 211,
		label: 'Webhook retries',
		age: '2 hr ago',
		terms: ['webhook retries', 'webhook', 'webhooks', 'backoff'],
		brief: "Review the webhook retries. Check that a timeout doesn't deliver an event twice."
	},
	{
		repo: 'acme/web',
		number: 88,
		label: 'Settings forms',
		age: '3 hr ago',
		terms: ['settings form', 'settings forms', 'form kit', 'settings'],
		brief: 'Review the settings forms. Check that validation errors are announced.'
	}
];

export const LAB_EXAMPLES = examples.flatMap((example) => {
	const pull = pulls.find(({ repo, number }) => repo === example.repo && number === example.number);

	return pull ? [{ ...example, pull }] : [];
});

export const EXAMPLE_PULL_LINK = LAB_EXAMPLES[0].pull.url;

export function labPullLabel(pull: LabPull): string {
	return `${pull.repo} #${pull.number}`;
}

export function resolveLabLink(value: string) {
	const ref = parsePullRef(value);

	if (!ref?.address) return { error: 'Paste a full pull request link, not just a number or a repository address.' };

	const pull = pulls.find(({ address, number }) => address === ref.address && number === ref.number);

	return pull ? { pull } : { error: 'That pull request isn’t open in the sample. Try the example link.' };
}

export function matchLabBrief(brief: string) {
	const normalized = ` ${brief
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim()} `;

	return LAB_EXAMPLES.flatMap(({ pull, terms }) => {
		const term = terms.find((candidate) => normalized.includes(` ${candidate} `));

		return term ? [{ pull, term }] : [];
	});
}
