import { loadTelemetryReport } from '../telemetry/telemetry-load';
import { daysReportRoute } from '../usage/report-shared';

/** The pull request and finding telemetry dashboard's data. Admin-only: `isAdminOnly` refuses a member. */
export default daysReportRoute(loadTelemetryReport);
