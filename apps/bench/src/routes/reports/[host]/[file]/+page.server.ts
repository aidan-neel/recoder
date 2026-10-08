import { error } from '@sveltejs/kit';
import { reportView } from '$lib/reports/detail';
import { host } from '$lib/server/hosts';
import { listReports, readReport } from '$lib/server/report-index';

export async function load({ params }) {
	const entry = (await listReports()).find((item) => item.key === `${params.host}/${params.file}`);

	if (!entry) error(404, 'No such report.');

	return { view: reportView(readReport(host(params.host), params.file), entry) };
}
