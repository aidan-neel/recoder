# Run multiple Recoder API replicas

The HA deployment uses an external PostgreSQL service for durable application state and coordination.
Each API replica accepts requests. Each active review has one leased executor that owns its pipeline and live discussions.
SQLite remains the standalone CLI backend behind the same asynchronous persistence interface.

## Storage and settings

Reviews, repositories, diffs, checkpoints, progress, metrics, jobs, commands, and events live in PostgreSQL.
Update operations lock the affected record and commit its change in one transaction.
API tokens, model settings, vLLM connections, guidelines, watcher settings and cursors, GitLab host settings, and dismissals also live there.

Each HTTP operation and background job loads a settings snapshot before invoking application logic.
Synchronous model configuration reads that snapshot. Changes commit together with version checks.
A concurrent stale settings edit fails instead of silently overwriting another replica's change.
Local CLI commands retain their existing file settings when shared storage is not configured.

## Review ownership

The coordinator claims work using PostgreSQL row locks and expiring leases measured by the database clock.
A takeover increments the ownership epoch. Every executor write checks its owner, epoch, and lease within the write transaction.
The old executor aborts after failed lease renewal and cannot commit after another executor takes over.
Starting an API replica never fails reviews owned by a live peer.

Review starts and controls enter a durable inbox before the API acknowledges them.
The owner processes pause, resume, cancellation, and chat while the pipeline runs.
Command and message identifiers remain stable across redelivery.
After owner failure, another replica restores the revision-validated checkpoint and recreates its temporary checkout.

## Events and external effects

An event append updates the progress snapshot and allocates its sequence in the same transaction.
Any API replica can serve a snapshot and replay later events without sticky sessions.
Database notifications may wake subscribers, but the durable log remains authoritative.

Automatic review triggers need transactional deduplication across webhook and polling paths.
Publishing to a forge needs an outbox and coordination for the repository and pull request, including reconciliation of uncertain results.
Remote model calls may repeat after a crash. The service cannot promise exactly-once effects from a provider without idempotency support.

## Implementation sequence

1. Move durable access behind asynchronous repositories while preserving standalone behavior.
2. Add PostgreSQL persistence, versioned shared settings, and an explicit import path for existing local data.
3. Add fenced review ownership, durable commands, event replay, and recovery.
4. Configure multiple API and frontend replicas in Helm, rolling updates, topology placement, and disruption budgets.

The first prerequisite establishes the storage boundary. It does not enable HA by itself.
Each later prerequisite depends on the verified predecessor. The chart exposes HA only after the runtime supports it.

## Acceptance checks

Use a real PostgreSQL container and two independent API processes with separate local data and checkout directories.
Use a temporary forge repository and deterministic HTTP model fixture, with no user credentials.

- Concurrent starts create one executor.
- Starting a second replica leaves a peer's running review intact.
- A request and event stream on another replica see the same saved review, settings, and ordered progress.
- Pause, resume, cancellation, and live discussions work across replicas.
- Killing an executor during a model request lets another replica recover and finish the review.
- An expired executor cannot write results, events, or checkpoints after takeover.
- Repeated webhook deliveries create one review.
- An uncertain forge publication is reconciled before another create is attempted.
- A rolling Kubernetes update preserves saved data and completes work after executor replacement.

PostgreSQL availability, backups, authentication, TLS, and replication belong to the infrastructure deployment.
Multiple API replicas do not make a single unreplicated database highly available.
