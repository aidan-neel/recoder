import type { UsageReport } from '@recoder/shared';

import { createReportStore } from './report-shared';

export const useUsage = createReportStore<UsageReport>('Couldn’t read the usage.');
