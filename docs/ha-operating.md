# Run Recoder with multiple API replicas

Use PostgreSQL mode when more than one API replica serves the same installation.
The API stores reviews, settings, credentials, commands, checkpoints, and event history in the shared database.
Each active review has one leased executor. Requests and event streams can reach any API replica.

Provision a writable PostgreSQL endpoint with the availability, replication, backups, and TLS configuration your installation requires.
Use its writable primary endpoint, not a read replica. The service account needs permission to create the application tables and read and write them.
Multiple API pods do not make an unreplicated database highly available.

Keep the database URL in your secret manager and reference it from a Kubernetes Secret.
Require encrypted connections and certificate verification for connections outside a trusted local test environment.
Do not put database credentials in Helm values, image layers, command arguments, or source control.

## Configure the server

The server reads these variables at startup.

| Variable | Default | Meaning |
| --- | --- | --- |
| `RECODER_DATABASE_URL` | Unset | A `postgres://` or `postgresql://` connection URL. Setting it selects shared storage. |
| `RECODER_INSTANCE_ID` | A generated identifier | Executor identity. Use a distinct value for each replica when setting it explicitly. |
| `RECODER_JOB_LEASE_MS` | `30000` | Ownership lease in milliseconds, from 1000 through 300000. |
| `RECODER_JOB_POLL_MS` | `250` | Work polling interval in milliseconds, from 50 through 5000. |
| `RECODER_JOB_CONCURRENCY` | `2` | Maximum owned review actors per API replica, from 1 through 32. |

All replicas of one installation must use the same database and compatible server images.
The API image must include this PostgreSQL runtime and the `/health/ready` endpoint.
Use separate databases for separate installations. Configure model endpoints and forge credentials through the shared settings API or server environment.
Model selection is captured for a running operation; changing settings does not replace models halfway through that operation.

Without `RECODER_DATABASE_URL`, Recoder retains standalone SQLite storage and local settings files.
Local CLI use remains local by default. Configuring multiple API replicas against a SQLite file is unsupported.

Use `/health` for process liveness and `/health/ready` for readiness.
In PostgreSQL mode, readiness fails when shared storage cannot be queried.
The Helm chart uses database readiness before routing requests to PostgreSQL API pods.

## Import a standalone installation

The import command reads an explicit stopped data directory. It never searches the operator's home directory or overwrites an existing destination.
Existing SQLite volumes require this explicit import before shared storage starts; setting the database URL does not copy their data.
It imports `recoder.db`, its committed WAL contents, and these settings files when present.

- `tokens.json`
- `gitlab-host.json`
- `review-config.json`
- `vllm-servers.json`
- `review-guidelines.md`
- `auto-review.json`
- `auto-review-state.json`
- `dismissed-findings.json`
- `finding-votes.json`

Missing settings remain unset. An explicitly saved empty guidelines file remains empty.
Legacy model settings pass through the same migration as local server startup.
Temporary checkouts, caches, CLI login files, and unrelated files are not imported.

1. Wait for active forge publications to finish, then stop the source server and all destination API replicas.
2. Back up the complete source data directory, including SQLite WAL files.
3. Load `RECODER_DATABASE_URL` for an empty destination from your secret manager.
4. From the Recoder checkout, run the import.

   ```sh
   bun apps/server/src/storage/import-local.ts --source /backups/recoder-data
   ```

   The command reports record and settings counts. It commits them together or rolls them all back.
   Source files remain unchanged. The database snapshot is read from a temporary copy so SQLite cannot create side files in the source directory.
5. Start the HA API replicas with the same database URL, then check saved reviews, guidelines, and model settings.

Queued and running reviews become recoverable work after API startup. Their saved checkpoints remain available, and imported pauses remain paused.
The import command itself does not invoke a model or send a forge message.
An interrupted discussion reply is marked as interrupted; send a new message to retry it.

The importer accepts database files and individual SQLite side files up to 1 GiB, settings files up to 4 MiB,
individual records or diffs up to 64 MiB, and at most 100000 records.
It rejects settings or database symlinks that resolve outside the selected directory.
For a larger installation, prepare a separate migration rather than bypassing these limits.

## Recover work after replica loss

After an executor loses ownership, another replica can claim the review once its lease expires.
The new executor restores a checkpoint that matches the repository revision and recreates its disposable checkout.
Persisted pause and cancellation state survives that change. Clients can reconnect their event streams to any replica.

Failover can pause progress for the lease period, polling delay, and checkout or model recovery time.
An in-flight model request can repeat after a crash, so token charges can repeat too.
Persisted chat commands retain their message identifiers when delivered to a successor.

Forge publication records retain uncertain create attempts. A retry searches for the comment marker before creating another comment.
If Recoder cannot establish the outcome of a previous create, inspect the pull request and resolve that uncertainty before another create.
Do not clear publication state merely to force a retry.

The supplied image uses remote model endpoints with `RECODER_EXEC=off`.
It does not install the Linux bubblewrap dependency or local agent CLIs.
Machine-local repositories and provider login files are not portable between pods; provide shared accessible resources or use remote forge repositories.

## Upgrade and back up

Back up PostgreSQL and the deployment's external Secrets before an upgrade.
Use immutable image tags and keep all replicas on compatible schema and protocol versions during a rolling update.
Let active reviews finish when possible. A replacement executor can recover persisted checkpoints, but an interrupted provider call can repeat.

Use your PostgreSQL provider's consistent backup and restore process for the entire application database.
Include review records, settings, actor leases and commands, events, and publication records together.
Backups contain connected credentials and repository information; restrict and encrypt them like the live database.
The API pods' temporary directories are disposable and do not replace a database backup.

To restore, stop API replicas, restore the database and matching external Secrets, and start compatible images against the restored writable endpoint.
Keep the previous deployment stopped so it cannot execute work against the restored installation.
Verify readiness, saved reviews, model settings, and forge publication state before starting another review.

Removing the Helm release leaves the external database and Secrets under infrastructure control.
Restoring PostgreSQL does not roll back messages already sent to a forge or model charges already incurred.

## Verify the installation

Run the PostgreSQL integration checks only against an isolated test database.
These tests create and remove their own schemas or databases and use temporary repositories and deterministic model fixtures.

```sh
TEST_DATABASE_URL="$RECODER_TEST_DATABASE_URL" \
RECODER_POSTGRES_TEST_URL="$RECODER_TEST_DATABASE_URL" \
bun test apps/server/tests/integration apps/server/tests/config/shared-settings.test.ts
```

The two-process tests cover shared settings, concurrent admission, remote event streams and controls, and executor loss during a review or discussion.
The import tests cover committed WAL data, empty-setting preservation, paused recovery, atomic rollback, source preservation, and path confinement.
Use your own model and forge configuration to verify a complete review before production use.
