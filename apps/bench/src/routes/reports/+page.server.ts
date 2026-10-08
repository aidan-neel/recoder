import { listReports } from '$lib/server/report-index';

export async function load() {
	return { reports: await listReports() };
}
