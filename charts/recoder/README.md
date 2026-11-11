# Deploy Recoder on Kubernetes

This chart runs one API server and one Next.js review app on Linux nodes with Kubernetes 1.26 or newer.
It requires Helm 3 or newer and a storage provisioner for a `ReadWriteOnce` volume, or an existing writable claim.

## Build the images

Build both images from the same Recoder revision and push them to your registry. The chart does not assume a published image exists.
Use immutable tags for upgrades.

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

Open `http://localhost:3000`. `http://localhost:3001/health` reports API health.
Health probes check HTTP service availability, not model connectivity or review completion.

## Storage and upgrade behavior

The API mounts its SQLite database, review progress, connected tokens, and settings at `/app/data`.
The default claim is `<release>-recoder-data`, with 10 GiB and the cluster's default storage class.
Both deployments use a single replica and `Recreate` updates. An upgrade causes downtime and never starts a second API writer.

The API handles `SIGTERM` by flushing review progress and exiting. The pod has a 30-second termination grace period.
This does not drain active reviews. Wait for reviews to finish before an upgrade or backup.
Worktrees under `/tmp/recoder-work` and temporary files are size-limited `emptyDir` volumes and disappear when a pod is replaced.
Saved review data survives; interrupted reviews do not resume automatically.

Back up the data before an upgrade, then update both image tags and run the install command again.
Keep the release name, namespace, and storage settings stable across upgrades. Existing volume sizes and storage classes
follow the storage provider's expansion and immutability rules.

To use a restored or pre-provisioned claim, set `server.persistence.existingClaim`. The chart then creates no claim.
The volume must permit UID/GID 1000 to write. `fsGroup: 1000` handles supported volume drivers.

## Back up and restore data

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

## Remove the release

```sh
helm uninstall recoder --namespace recoder
```

The chart-created data claim has `helm.sh/resource-policy: keep` and remains after uninstall.
Existing claims are also left untouched. To reinstall with retained data, set `server.persistence.existingClaim`
to the retained claim name. Delete the claim separately only when you intend to erase its data.

## Runtime limits

The supplied server image supports remote OpenAI-compatible model endpoints and read-only reviews.
The chart sets `RECODER_EXEC=off`. Linux code execution needs bubblewrap and a runtime that allows its user and mount namespaces.
The supplied Dockerfile does not install bubblewrap, and the chart grants no privileged mode or extra capabilities.
Sandboxed test execution, overlay mounts, local model servers, and distributed workers are unsupported by this chart.
macOS Seatbelt and native Windows sandbox modes cannot run in these Linux containers.
Agent CLIs such as OpenCode are not installed in the supplied image. Configure an external model endpoint instead.

The containers run as UID/GID 1000 with read-only root filesystems, dropped capabilities, and no Kubernetes API token.
The API has a writable temporary home under `/tmp`; credentials persisted through the Recoder UI remain under `/app/data`.
Apply cluster network policies that permit the API to reach only the required forge and model endpoints.

## Values

| Value | Default | Purpose |
| --- | --- | --- |
| `server.image.repository`, `server.image.tag` | Required | API image built from `apps/server/Dockerfile`. |
| `app.image.repository`, `app.image.tag` | Required | Review app image built from `apps/app/Dockerfile`. |
| `server.image.pullPolicy`, `app.image.pullPolicy` | `IfNotPresent` | Image pull policy. |
| `imagePullSecrets` | `[]` | Existing registry secrets as a list of `{name: secret-name}` objects. |
| `server.frontendUrl` | `http://localhost:3000` | Browser origin for trusted-origin checks and links. |
| `server.existingSecret` | Empty | Existing Secret whose keys become API environment variables. |
| `server.env` | `RECODER_EXEC: 'off'` | Additional non-secret server settings. Fixed ports and storage paths cannot be overridden. |
| `server.persistence.existingClaim` | Empty | Existing claim instead of a chart-created volume. |
| `server.persistence.storageClass` | `null` | Cluster default when null; `''` selects no storage class. |
| `server.persistence.size` | `10Gi` | Requested capacity of a chart-created claim. |
| `server.workSizeLimit` | `10Gi` | Disposable checkout capacity. |
| `server.tmpSizeLimit`, `app.tmpSizeLimit` | `1Gi`, `256Mi` | Disposable temporary storage capacity. |
| `server.resources` | 250m/512Mi requests, 2 CPU/2Gi limits | API compute budget. |
| `app.resources` | 100m/256Mi requests, 1 CPU/1Gi limits | App compute budget. |

## Validate the chart

The test values use intentionally unreachable image names for rendering only.

```sh
helm lint --strict charts/recoder -f charts/recoder/tests/values.yaml
bun test charts/recoder/tests/render.test.ts
```

These checks cover manifests, storage selection, secret references, and rejected values.
They do not prove that a model endpoint can complete a review. Before production use, complete a review with your
model configuration, restart the API, upgrade the release, and confirm that the saved review remains available.
