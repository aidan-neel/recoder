import type { TelemetryReport, UsageDays } from '@recoder/shared';
import { pullStates } from '../forge/pulls/pull-states';
import { readAutoReviewSettings } from '../forge/watch/settings';
import { db, modelCalls } from '../store';
import { loadReportPeople } from '../usage/report-shared';
import { buildTelemetryReport } from './telemetry-report';

/**
 * The telemetry report for the last `days` days, built from stored reviews, repositories,
 * pull request states, model calls, accounts and commit-check settings.
 */
export async function loadTelemetryReport(days: UsageDays, now = new Date()): Promise<TelemetryReport> {
	const [reviews, repos, states, calls, people] = await Promise.all([
		db.reviews.list(),
		db.repos.list(),
		pullStates.list(),
		modelCalls.list(),
		loadReportPeople()
	]);

	const settings = readAutoReviewSettings();

	return buildTelemetryReport({ days, now, reviews, repos, pullStates: states, calls, people, settings });
}
