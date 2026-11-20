import type { DocPage } from '~/lib/docs';

export const server: DocPage = {
	slug: 'server',
	title: 'Run the server',
	body: `Recoder runs as one server that serves the app and the API together, keeps its own data, updates itself, and backs itself up. This page is the operator's route: install it, set it up in the browser, and let it update.

## Install

On a fresh Ubuntu or Debian server, as root:

\`\`\`bash
curl -fsSL https://recoder.dev/server.sh | sh
\`\`\`

The script installs Docker if it is missing, writes \`/opt/recoder\` (a compose file with Recoder, the updater sidecar and Caddy, a \`.env\`, a Caddyfile, and the updater's token), pulls the release image, starts everything, waits for the health check, and prints one line:

\`\`\`
Open https://recoder.example.com and enter the setup code: K7QM4XRP
\`\`\`

Its flags:

| Flag | Meaning |
| --- | --- |
| \`--domain recoder.example.com\` | The domain Caddy serves and gets a certificate for. Asked for when omitted; empty means plain HTTP on the server's own address. |
| \`--internal-tls\` | Issue the certificate from Caddy's internal CA instead of a public one. For air-gapped and test installs; browsers will warn about the certificate. |
| \`--yes\` | Answer yes to every question. |

Environment variables: \`RECODER_VERSION\` pins a release tag (\`v0.3.0\`) instead of the latest, and \`RECODER_INSTALL_DIR\` moves the files somewhere other than \`/opt/recoder\`.

Running the script again is safe: data, secrets and settings are kept, and only the generated files are rewritten — so do not edit \`compose.yaml\` or the \`Caddyfile\`; put extra environment for the server in \`.env\` instead. The script pins the release tag it installed; updates come from the app's updater, not from running the script again.

If the pull fails, the image package on ghcr.io may still be private. The first release has to be made public once, by hand: open [the package's settings](https://github.com/aidan-neel/recoder/pkgs/container/recoder) and change visibility to public, then once more for [the updater's package](https://github.com/aidan-neel/recoder/pkgs/container/recoder-updater).

Prefer no script? The equivalent is a compose file with the image \`ghcr.io/aidan-neel/recoder\`, Caddy in front of it on ports 80 and 443, and the updater sidecar beside it — the script's \`compose.yaml\` is a working reference.

## Set the server up

Open the address the script printed. The first visit asks for the setup code, which unlocks the browser for fifteen minutes and shows a checklist of seven steps: claim the server, point it at an address, sign in as the admin, connect a model provider, pick the review model, confirm storage, and run the server's checks. The first step not done opens; done steps collapse to a line. When every step is done, finish setup and the checklist goes away for good.

The **address** step decides where the server is published and how its TLS works:

- **A domain** — Recoder checks the domain's DNS points at this server, loads it into Caddy, and Caddy requests a certificate. The step answers *pending* while the certificate is being issued and turns *issued* once HTTPS answers. This changes the running Caddy through its admin API and survives restarts.
- **A proxy's address** — if something in front of Recoder already ends TLS (your own nginx, Cloudflare, Tailscale), give it the address instead. Recoder records it and never asks Caddy for anything.
- **Nothing** — a server installed without a domain stays on plain HTTP. You can come back later; the checklist keeps the step open.

Sign-in reuses the flows Recoder always had: OAuth with a GitHub or GitLab app you register, the device flow, or a pasted token. The first sign-in becomes the admin; everyone after that is a member and sees nothing about the server.

## Update

Settings → Server → Updates shows what is available and what an update will do. Updates apply in place: the updater pauses running reviews at their checkpoints, takes a backup, verifies the new image's digest against the signed release manifest, pulls it, restarts on the same data, waits for the health check, and resumes the reviews. If the new version does not become healthy, the updater starts the previous image again and restores the backup it took a minute earlier.

Choose a channel (\`stable\` or \`beta\`) and whether updates install themselves automatically, or leave it on *ask* and press Update when the release notes read well. Automatic installs run in the updater's window, every day at 3 AM by default. *Later* hides one version in this browser until a newer one appears.

## Roll back

The update history lists every version this install has run, newest first. Roll back to one of them: if the data did not change shape since, this swaps the image and keeps everything; if it did, the rollback restores the backup taken before the update that replaced it, and anything written since that backup is gone — the app says so before it happens.

## Back up

Recoder backs its database and settings into one archive under \`/app/data/backups\`: nightly at the hour you choose, and before every update. Download an archive from Settings → Server → Backups; it holds the sealed credentials but not the secret key, because anyone with both could open every credential — the download offers the key only behind an explicit warning. Restoring a backup runs through the updater and reuses the rollback path.

On PostgreSQL, the database's own backups are the ones that count; Recoder says so instead of keeping a second copy.

## Logs

Settings → Server → Logs shows the server's own log, already redacted — no tokens, keys or request bodies — plus the updater's log per update, so a failed update can be read afterwards.

## PostgreSQL

One server runs on the built-in database. Multiple API replicas need PostgreSQL; see [running with multiple API replicas](https://github.com/aidan-neel/recoder/blob/main/docs/ha-operating.md). Moving an existing install is an offline migration: stop the server, back up its data directory, load the database URL and the secret key, run the importer from a checkout, and start the replicas. The setup wizard's storage step points at the same guide instead of moving data live.

## Helm

The Helm chart stays for Kubernetes. A Helm install updates by \`helm upgrade\`, not from the browser: the app shows the exact command instead of an Update button when the chart sets \`RECODER_MANAGED_COMMAND\` in the server's environment. The chart still expects images you build and push yourself; see its [README](https://github.com/aidan-neel/recoder/blob/main/charts/recoder/README.md).

## Uninstall

\`\`\`bash
cd /opt/recoder
docker compose down -v
cd / && rm -rf /opt/recoder
\`\`\`

\`down -v\` removes the volumes: the database, the backups and the updater's journal. Anything you want to keep — reviews, settings, the backups — is in those volumes and in \`.env\`; download what you need before uninstalling. The secret key in \`.env\` is what unseals every stored credential, so keep it if there is any chance of coming back.

## Releases

A \`v*\` tag builds the CLI binaries for four platforms, the server image and the updater image for amd64 and arm64, signs all of them with Sigstore through GitHub's OIDC (no stored keys), and publishes a signed \`release.json\` manifest — version, channel, per-platform digests, data versions, release notes, and the oldest version that may update in place. The updater trusts nothing it cannot verify against that manifest, and pulls by digest, never by tag.

The checklist for a release:

1. \`main\` is green: CI runs the whole verify suite on it.
2. Tag \`v0.3.0\` and push the tag. Everything above happens by itself.
3. First release only: make [the image package](https://github.com/aidan-neel/recoder/pkgs/container/recoder) and [the updater's](https://github.com/aidan-neel/recoder/pkgs/container/recoder-updater) public on ghcr.io, or installs cannot pull them.
4. The first release also waits on the setup lock for the settings routes (issue AID-31, being fixed in RECO-25): until those routes refuse a locked browser, a public server would serve its settings pages to anyone who reaches it.`
};
