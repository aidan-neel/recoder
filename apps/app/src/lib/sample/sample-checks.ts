import type { PrCheck } from '@recoder/shared';

const RUN_URL = 'https://github.com/acme/web/actions';

const PASSED_NAMES = [
	'Check',
	'Remove preview download',
	'Build the app',
	'Build the server',
	'Lint the app',
	'Lint the server',
	'Typecheck the app',
	'Typecheck the server',
	'Unit tests: app',
	'Unit tests: server',
	'Unit tests: shared',
	'Unit tests: ui',
	'Helm lint',
	'Helm render tests',
	'Dead code',
	'Format',
	'Build the site',
	'Site tests',
	'CLI tests',
	'Package the CLI for linux x64',
	'Package the CLI for linux arm64',
	'Package the CLI for macOS x64',
	'Package the CLI for macOS arm64',
	'Eval fixtures',
	'Parser fixtures',
	'Sandbox escape tests',
	'Database migrations',
	'Postgres integration tests',
	'Vercel',
	'Vercel Preview Comments',
	'GitGuardian Security Checks'
];

const SKIPPED_NAMES = [
	'Tear down relay preview',
	'Package and sign macOS arm64 preview',
	'Publish anonymous download',
	'Verify preview eligibility',
	'Retry teardown for PR ${{ matrix.number }}',
	'List closed relay previews',
	'Publish the Helm chart',
	'Release notes',
	'Deploy the docs'
];

function checksNamed(names: string[], state: PrCheck['state']): PrCheck[] {
	return names.map((name) => ({ name, state, url: RUN_URL }));
}

/** About forty checks as a busy repository reports them: one failure, mostly passes, a run of skips. */
export const MANY_CHECKS: PrCheck[] = [
	...checksNamed(SKIPPED_NAMES.slice(0, 4), 'skipped'),
	...checksNamed(['CodeRabbit'], 'failed'),
	...checksNamed(PASSED_NAMES, 'passed'),
	...checksNamed(SKIPPED_NAMES.slice(4), 'skipped')
];

/** The same checks with none failing. */
export const MANY_CHECKS_PASSING: PrCheck[] = MANY_CHECKS.filter((check) => check.state !== 'failed');
