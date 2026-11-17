import type { TelemetryReport } from '@recoder/shared';

import { createReportStore } from '../usage/report-shared';

export const useTelemetry = createReportStore<TelemetryReport>('Couldn’t read the telemetry.');
