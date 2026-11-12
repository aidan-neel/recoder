# 0002. Shared API state and review ownership

Status: Accepted

## Context

API replicas must see the same reviews and settings while a failed executor can be replaced.
The standalone server uses SQLite, files, local controls, and process-local subscriptions.
Database sharing alone would still permit duplicate execution and stale-owner writes.

## Decision

Use PostgreSQL for shared records, versioned settings, commands, ordered events, and publication outcomes.
Give each active review one database-clock lease and increment its fencing epoch on takeover.
Verify that lease in every executor write transaction. Persist commands before acknowledging them.
Keep stopped-chat state durable so replay cannot restart a stopped model request.

Read settings through an operation snapshot and reject stale concurrent edits.
Commit terminal review results, progress, checkpoints, and terminal events atomically.
Coordinate forge publication per pull request and reconcile ambiguous creates before retrying.
Keep SQLite and local settings as the default standalone mode.

## Alternatives considered

- Sharing a SQLite volume would retain one writer and would not share execution controls or events.
- Adding a separate broker would still require transactional ownership and record fencing, while adding another availability dependency.
- Routing each client to one replica would lose its control and event access after that replica failed.

## Consequences

The infrastructure must provide an available PostgreSQL primary endpoint, secrets, TLS, and backups.
Model calls can repeat after a crash. An uncertain forge create fails closed when its marker cannot be reconciled.
API replicas use disposable local checkouts. Existing SQLite data requires an explicit import into an empty destination.
The [operating guide](../ha-operating.md) defines the supported deployment and migration steps.
