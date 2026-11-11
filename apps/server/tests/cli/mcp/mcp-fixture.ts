import { EXIT } from '../../../src/cli/exit';
import { runMcpCommand } from '../../../src/cli/mcp/mcp-command';

/** Ends the fixture if a test fails to, so it never outlives the suite. */
const LIFETIME_MS = 90_000;

setTimeout(() => process.exit(EXIT.failed), LIFETIME_MS).unref();

process.exitCode = await runMcpCommand();
