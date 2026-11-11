# 0001. Asynchronous persistence for local and shared storage

Status: Accepted

## Context

Recoder persists reviews in SQLite and executes model streams through synchronous callbacks.
Multiple API replicas require a shared database, atomic updates, and explicit durability boundaries.
Converting synchronous calls to asynchronous calls also separates read/modify/write operations that previously ran without interleaving.

## Decision

Use one asynchronous collection interface for durable state, including the local SQLite implementation.
Use transactional update callbacks for atomic record changes.
Keep token streaming callbacks synchronous and send their persistence effects through ordered queues.
Await those queues before exposing completed operations, and propagate persistence failures to the caller.
Capture each queued operation's asynchronous context and its event payload when it is enqueued.

The local CLI retains SQLite and local settings. A later PostgreSQL backend uses this boundary for shared API state.
The complete HA design and acceptance criteria are in [the HA design](../ha-design.md).

## Alternatives considered

- A second asynchronous API beside the old synchronous store would duplicate decisions and let new callers select the wrong backend.
- Blocking the event loop while a PostgreSQL worker performs I/O would preserve signatures but stall model streams and HTTP requests.
- SQLite replication would retain a single writer and would not coordinate settings, review ownership, or live controls.

## Consequences

Durable callers must await storage operations. Read/modify/write decisions use a transaction or a scoped critical section.
Streaming callbacks can keep their existing shape, but their enclosing operation must drain the persistence queue.
This prerequisite preserves standalone behavior. It does not enable multiple API replicas by itself.
