import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { percent } from './benchmark-labels-report';
import { readReport } from './benchmark-report';
import { recall, type Totals } from './benchmark-score';
import { selectSet, tracking } from './set-selection';
import { readLabels, taskSetPath } from './task-set';

const USAGE =
	'Usage: bun run --filter @recoder/server eval:select-set -- --dataset <dir> --reports <a.json,b.json> --size 8 --out quick';

const cell = (totals: Totals) => `${totals.found}/${totals.planted} (${percent(recall(totals))})`;

/**
 * Picks a fixed task set from saved benchmark reports and writes it to the
 * dataset's private `sets/` folder, printing why each PR was picked and how
 * the subset's found-over-planted tracked each report's full result. The
 * subset is fit to these reports, so that tracking is in-sample.
 */
function main(): number {
	const { values } = parseArgs({
		args: Bun.argv.slice(2),
		options: {
			dataset: { type: 'string' },
			reports: { type: 'string' },
			size: { type: 'string', default: '8' },
			out: { type: 'string' }
		},
		strict: true
	});

	const size = Number(values.size);

	if (!values.dataset || !values.reports || !values.out || !Number.isInteger(size) || size <= 0) {
		console.error(`--dataset, --reports, --out and a positive --size are required.\n${USAGE}`);

		return 1;
	}

	const dataset = resolve(values.dataset);
	const path = taskSetPath(dataset, values.out);

	const reports = values.reports
		.split(',')
		.map((report) => ({ path: resolve(report.trim()), report: readReport(resolve(report.trim())) }));

	const { set, picks } = selectSet(basename(dataset), readLabels(dataset), reports, { size, name: values.out });

	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(set, null, '\t')}\n`);

	console.log(
		[
			`Task set ${set.name}: ${set.tasks.length} PRs → ${path}`,
			...picks.map((pick) => `  ${pick.id.padEnd(20)} ${pick.reasons.join(' · ')}`),
			'',
			'Found/planted on the set next to the full report (in-sample: the set was picked from these reports)',
			...reports.map(({ path: source, report }) => {
				const { subset, full } = tracking(report, set.tasks);

				return `  ${basename(source).padEnd(28)} subset ${cell(subset).padEnd(16)} full ${cell(full)}`;
			})
		].join('\n')
	);

	return 0;
}

try {
	process.exit(main());
} catch (err) {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
}
