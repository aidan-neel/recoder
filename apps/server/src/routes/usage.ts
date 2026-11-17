import { daysReportRoute } from '../usage/report-shared';
import { loadUsageReport } from '../usage/usage-load';

/** The usage dashboard's data. Admin-only: `isAdminOnly` refuses a member before this route runs. */
export default daysReportRoute(loadUsageReport);
