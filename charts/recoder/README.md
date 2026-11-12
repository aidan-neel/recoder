# Deploy Recoder on Kubernetes

This chart deploys the Recoder API and Next.js review app on Linux nodes with Kubernetes 1.26 or newer and Helm 3 or newer.
The default uses one API replica with SQLite and requires a `ReadWriteOnce` storage provisioner or existing writable claim.
For multiple API replicas, configure an external PostgreSQL service as described below.

## Build the images

Build both images from the same Recoder revision and push them to your registry. The chart does not assume a published image exists.
Use immutable tags for upgrades.
HA images must include the shared PostgreSQL runtime and its asynchronous storage prerequisite, [PR #157](https://github.com/aidan-neel/recoder/pull/157).
The HA chart depends on those runtime changes. An older API image lacks `/health/ready` and cannot pass the PostgreSQL readiness probe.

```sh
docker build -f apps/server/Dockerfile -t registry.example.org/recoder/server:REVISION .
docker build -f apps/app/Dockerfile \
  --build-arg NEXT_PUBLIC_API_URL=https://api.recoder.example.org \
  -t registry.example.org/recoder/app:REVISION .
docker push registry.example.org/recoder/server:REVISION
docker push registry.example.org/recoder/app:REVISION
```

`NEXT_PUBLIC_API_URL` must be reachable from the user's browser. A Kubernetes service DNS name is not a browser URL.
The app compiles this URL into its JavaScript bundle. Rebuild the app image when the URL changes.
For local port forwarding, build with `http://localhost:3001` instead.

## Configure the release

Create `recoder-values.yaml` with your image names and non-secret configuration.

```yaml
server:
  image:
    repository: registry.example.org/recoder/server
    tag: REVISION
  frontendUrl: https://recoder.example.org
  existingSecret: recoder-credentials
  env:
    RECODER_REVIEW_BASE_URL: https://models.example.org/v1
    RECODER_REVIEW_MODEL: your-review-model
app:
  image:
    repository: registry.example.org/recoder/app
    tag: REVISION
```

Create the `recoder-credentials` Secret in the release namespace through your existing secret management process.
Its keys become API server environment variables. Supported keys include `RECODER_REVIEW_API_KEY`, `GITHUB_TOKEN`,
`GITLAB_TOKEN`, `GITHUB_WEBHOOK_SECRET`, and `GITLAB_WEBHOOK_SECRET`. Omit `existingSecret` when credentials are unnecessary.
Never put credentials in Helm values or command-line overrides. See [server configuration](../../.env.example).

The chart creates two private `ClusterIP` services, `<release>-recoder-server` on port 3001 and
`<release>-recoder-app` on port 3000. Your infrastructure must provide the namespace, Secret, registry access,
TLS, authentication, and routes for the browser-facing app and API URLs. Preserve streaming responses at the API proxy.
The chart creates no ingress, namespace, model server, worker, or database service.
Restrict access to trusted users. The API's CORS configuration is not access control.

## Configure HA

Add this configuration to the image and model values above.

```yaml
server:
  replicaCount: 2
  database:
    existingSecret: recoder-database
    secretKey: RECODER_DATABASE_URL
app:
  replicaCount: 2
```

Provision `recoder-database` in the release namespace through your secret manager.
The selected key must hold the PostgreSQL connection URL, including the database, credentials, and required TLS configuration.
Use `server.database` for this reference rather than placing the URL in values or `server.env`.
`server.env.RECODER_JOB_CONCURRENCY` sets how many reviews each API pod runs at once, from 1 through 32 (default 2).
Every pod of the release shares it, so the chart rejects `0`; an API-only replica (`0`) belongs in a separate deployment
next to pods that run reviews. See the [HA operating guide](../../docs/ha-operating.md).
The chart's explicit database variable takes precedence over a key with the same name in `server.existingSecret`.
Existing pods keep their environment. Restart the API deployment after rotating its database Secret.

The database stores reviews, checkpoints, settings, credentials, review commands, and ordered events.
API replicas coordinate review ownership there. A surviving replica can restore the checkpoint after the executor exits.
Requests and event streams can reach different replicas without sticky sessions.
Model requests can repeat after a crash; review recovery does not guarantee exactly-once remote effects.

PostgreSQL availability, replication, backups, authentication, and TLS belong to your infrastructure.
Two API replicas do not make a single unreplicated database highly available.
Use multiple schedulable nodes and sufficient capacity for one extra pod during updates.
Replica groups use hostname spread constraints with `ScheduleAnyway`; Kubernetes can co-locate them when capacity is limited.
Each group with at least two replicas gets a disruption budget that keeps one available during voluntary evictions.
The budget does not prevent node failures or replace database HA.

The PostgreSQL mode mounts `/app/data` as bounded disposable storage and creates no API data claim.
Do not set `server.persistence.existingClaim` in this mode. Changing the database Secret does not import data from a SQLite claim.
Retain the original claim and backup until the data migration has been verified.
For an existing installation, stop the SQLite API and use the [HA operating guide](../../docs/ha-operating.md) to import its data into an empty database.
The import command is `bun apps/server/src/storage/import-local.ts --source <stopped-server-data-directory>` with `RECODER_DATABASE_URL` supplied through the environment.
Switch the Helm release to PostgreSQL only after the import succeeds and its saved data has been checked.

## Install and access the app

```sh
helm lint --strict charts/recoder -f recoder-values.yaml
helm upgrade --install recoder charts/recoder \
  --namespace recoder --values recoder-values.yaml --wait --timeout 5m
```

For a local app image built with `http://localhost:3001`, set `server.frontendUrl` to `http://localhost:3000`
and run these commands in separate terminals.

```sh
kubectl --namespace recoder port-forward service/recoder-recoder-server 3001:3001
kubectl --namespace recoder port-forward service/recoder-recoder-app 3000:3000
```

Open `http://localhost:3000`. `http://localhost:3001/health` reports API process health.
In PostgreSQL mode, `/health/ready` also checks shared storage before the API pod receives traffic.
Neither probe verifies model connectivity or review completion.

## Storage and upgrade behavior

In the default SQLite mode, the API mounts its database, review progress, connected tokens, and settings at `/app/data`.
The default claim is `<release>-recoder-data`, with 10 GiB and the cluster's default storage class.
The API uses `Recreate` updates and one replica. An upgrade causes downtime and never starts a second SQLite writer.
The frontend can scale independently and uses rolling updates.

The API handles `SIGTERM` by flushing review progress and exiting. The pod has a 30-second termination grace period.
This does not drain active reviews. Wait for reviews to finish before an upgrade or backup.
Worktrees under `/tmp/recoder-work` and temporary files are size-limited `emptyDir` volumes and disappear when a pod is replaced.
In SQLite mode, saved review data survives but interrupted reviews do not resume automatically.

In PostgreSQL mode, API updates use `RollingUpdate`, `maxUnavailable: 0`, and `maxSurge: 1`.
The 30-second termination grace period lets the executor stop local work before another replica restores its checkpoint.
Shared review data remains in PostgreSQL when a pod is replaced. Temporary checkouts are recreated as needed.
An update can interrupt model calls and event connections; clients must reconnect and work may repeat.
Keep API images on a mutually compatible database schema throughout a rollout.

Back up the data before an upgrade, then update both image tags and run the install command again.
Keep the release name, namespace, and storage settings stable across upgrades. Existing volume sizes and storage classes
follow the storage provider's expansion and immutability rules.

For SQLite, use a restored or pre-provisioned claim by setting `server.persistence.existingClaim`. The chart then creates no claim.
The volume must permit UID/GID 1000 to write. `fsGroup: 1000` handles supported volume drivers.

## Back up and restore data

For PostgreSQL, use your database provider's consistent backup and restore procedure.
Back up the complete Recoder database, including settings, ownership, commands, checkpoints, and event records.
Before restoring a backup, stop all API replicas so an old executor cannot write to the restored state.
Restore to a separate database, update the database Secret reference, and verify saved reviews and provider settings before admitting traffic.
Protect backups as secrets because they contain connected credentials and repository data.

For SQLite, back up the retained claim with this procedure.

1. Wait for active reviews to finish.
2. Stop the API writer.

   ```sh
   kubectl --namespace recoder scale deployment/recoder-recoder-server --replicas=0
   kubectl --namespace recoder wait --for=delete pod \
     --selector=app.kubernetes.io/instance=recoder,app.kubernetes.io/component=server --timeout=90s
   ```

3. Use your storage provider's snapshot or backup procedure for the entire `recoder-recoder-data` claim.
   Include the database and its SQLite WAL files together. Store backups as secrets because they contain connected tokens and repository data.
4. Start the API again.

   ```sh
   kubectl --namespace recoder scale deployment/recoder-recoder-server --replicas=1
   kubectl --namespace recoder rollout status deployment/recoder-recoder-server
   ```

To restore, stop the API and restore the complete backup into a separate writable claim in the release namespace.
Set `server.persistence.existingClaim` to that claim and run `helm upgrade` with your values.
Check saved reviews and provider settings before starting another review. Do not attach one claim to two API releases.

To roll back an image, first confirm that it supports the database schema already in use.
Do not roll a PostgreSQL release back to an image that only supports SQLite, or remove its database Secret reference.
Switching between storage modes does not transfer data. Keep the old database or claim and its backup until the replacement is verified.

## Remove the release

```sh
helm uninstall recoder --namespace recoder
```

The chart-created data claim has `helm.sh/resource-policy: keep` and remains after uninstall.
Existing claims are also left untouched. To reinstall with retained data, set `server.persistence.existingClaim`
to the retained claim name. Delete the claim separately only when you intend to erase its data.
Uninstalling a PostgreSQL release leaves the external database and its Secret untouched.

## Runtime limits

The supplied server image supports remote OpenAI-compatible model endpoints and read-only reviews.
The chart sets `RECODER_EXEC=off`. Linux code execution needs bubblewrap and a runtime that allows its user and mount namespaces.
The supplied Dockerfile does not install bubblewrap, and the chart grants no privileged mode or extra capabilities.
Sandboxed test execution, overlay mounts, local model servers, and distributed workers are unsupported by this chart.
macOS Seatbelt and native Windows sandbox modes cannot run in these Linux containers.
Agent CLIs such as OpenCode are not installed in the supplied image. Configure an external model endpoint instead.

The containers run as UID/GID 1000 with read-only root filesystems, dropped capabilities, and no Kubernetes API token.
The API has a writable temporary home under `/tmp`. UI-connected credentials remain in the SQLite data claim or shared PostgreSQL database.
Apply cluster network policies that permit the API to reach only the required database, forge, and model endpoints.

## Values

| Value | Default | Purpose |
| --- | --- | --- |
| `server.image.repository`, `server.image.tag` | Required | API image built from `apps/server/Dockerfile`. |
| `app.image.repository`, `app.image.tag` | Required | Review app image built from `apps/app/Dockerfile`. |
| `server.image.pullPolicy`, `app.image.pullPolicy` | `IfNotPresent` | Image pull policy. |
| `imagePullSecrets` | `[]` | Existing registry secrets as a list of `{name: secret-name}` objects. |
| `server.replicaCount`, `app.replicaCount` | `1`, `1` | API and frontend replicas. Multiple API replicas require `server.database.existingSecret`. |
| `server.database.existingSecret` | Empty | Existing Secret that enables shared PostgreSQL storage. |
| `server.database.secretKey` | `RECODER_DATABASE_URL` | Secret key holding the database connection URL. |
| `server.frontendUrl` | `http://localhost:3000` | Browser origin for trusted-origin checks and links. |
| `server.existingSecret` | Empty | Existing Secret whose keys become API environment variables. |
| `server.env` | `RECODER_EXEC: 'off'` | Additional non-secret server settings. Fixed ports and storage paths cannot be overridden. |
| `server.persistence.existingClaim` | Empty | Existing claim instead of a chart-created volume. |
| `server.persistence.storageClass` | `null` | Cluster default when null; `''` selects no storage class. |
| `server.persistence.size` | `10Gi` | Requested capacity of a chart-created claim. |
| `server.workSizeLimit` | `10Gi` | Disposable checkout capacity. |
| `server.tmpSizeLimit`, `app.tmpSizeLimit` | `1Gi`, `256Mi` | Disposable temporary storage capacity. |
| `server.dataSizeLimit` | `1Gi` | Disposable `/app/data` capacity in PostgreSQL mode. |
| `server.resources` | 250m/512Mi requests, 2 CPU/2Gi limits | API compute budget. |
| `app.resources` | 100m/256Mi requests, 1 CPU/1Gi limits | App compute budget. |

## Validate the chart

The test values use intentionally unreachable image names for rendering only.

```sh
helm lint --strict charts/recoder -f charts/recoder/tests/values.yaml
bun test charts/recoder/tests/render.test.ts
```

These checks cover manifests, storage selection, secret references, replica safety, update strategies, and disruption budgets.
They do not prove that a model endpoint can complete a review. Before production use, complete a review with your
model configuration, restart the API, upgrade the release, and confirm that the saved review remains available.
