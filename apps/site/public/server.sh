#!/bin/sh
# Installs the Recoder server: curl -fsSL https://recoder.dev/server.sh | sh
#
# Installs Docker if it is missing, writes /opt/recoder (compose, Caddyfile, .env and the updater token),
# pulls the signed release image, starts Recoder with the updater sidecar and Caddy for HTTPS, and prints
# the address to open and the setup code to enter. Running it again is safe: data and settings are kept,
# and the generated files are rewritten from this script, so do not edit them.
#
# Flags:
#   --domain recoder.example.com   the domain Caddy serves (asked for when omitted)
#   --internal-tls                 issue the certificate from Caddy's internal CA (air-gapped or test installs)
#   --yes                          answer yes to every question
#
# Environment:
#   RECODER_VERSION      a release tag to pin, like v0.3.0 (default: the latest release)
#   RECODER_INSTALL_DIR  where everything is written (default: /opt/recoder)
set -eu

repo="aidan-neel/recoder"
install_dir="${RECODER_INSTALL_DIR:-/opt/recoder}"
domain_arg=''
internal_tls=no
assume_yes=no

fail() {
	printf 'recoder install: %s\n' "$1" >&2
	exit 1
}

usage() {
	sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
	exit 0
}

while [ $# -gt 0 ]; do
	case "$1" in
	--domain)
		[ $# -ge 2 ] || fail '--domain needs the domain as its second word.'
		domain_arg="$2"
		shift 2
		;;
	--domain=*)
		domain_arg="${1#*=}"
		shift
		;;
	--internal-tls)
		internal_tls=yes
		shift
		;;
	--yes | -y)
		assume_yes=yes
		shift
		;;
	-h | --help)
		usage
		;;
	*)
		fail "unknown flag \"$1\"."
		;;
	esac
done

[ "$(id -u)" = 0 ] || fail 'run me as root: curl -fsSL https://recoder.dev/server.sh | sudo sh'

command -v curl >/dev/null 2>&1 || fail 'curl is required.'

env_file="$install_dir/.env"
compose_file="$install_dir/compose.yaml"
caddyfile="$install_dir/Caddyfile"
token_file="$install_dir/secrets/recoder-updater-token"

mkdir -p "$install_dir/secrets"
chmod 700 "$install_dir/secrets"

if [ ! -f "$env_file" ]; then
	umask 077
	: > "$env_file"
	umask 022
fi

# Adds a key only when it is not there yet, so a re-run keeps every answer and secret.
set_env() {
	grep -q "^$1=" "$env_file" 2>/dev/null || printf '%s=%s\n' "$1" "$2" >> "$env_file"
}

# A terminal to ask on, when there is one: /dev/tty exists in containers where it still cannot open.
has_tty() {
	if [ -c /dev/tty ]; then
		if head -n 0 /dev/tty 2>/dev/null; then
			return 0
		fi
	fi

	return 1
}

# Asks on the terminal, never on stdin: the script itself arrives on stdin when piped.
confirm() {
	[ "$assume_yes" = yes ] && return 0

	if ! has_tty; then
		fail "$1, and there is no terminal to ask on. Run again with --yes."
	fi

	printf '%s [yes/no] ' "$1" > /dev/tty
	answer="$(head -n 1 < /dev/tty || true)"
	[ "$answer" = yes ] || [ "$answer" = y ] || fail 'stopped.'
}

if ! command -v docker >/dev/null 2>&1; then
	confirm "Docker is missing. Install it with Docker's official script?"
	curl -fsSL https://get.docker.com | sh -s -- --non-interactive
	command -v docker >/dev/null 2>&1 || fail 'Docker is still missing after the install.'
fi

docker compose version >/dev/null 2>&1 || fail 'the docker compose plugin is missing (install docker-compose-plugin).'

# The release tag: an argument wins, then what a previous run pinned, then the latest release on GitHub.
docker_tag() {
	if [ -n "${RECODER_VERSION:-}" ]; then
		case "$RECODER_VERSION" in
		v[0-9]*.[0-9]*.[0-9]* | v[0-9]*.[0-9]*.[0-9]*-*) printf '%s' "$RECODER_VERSION" ;;
		*) fail 'RECODER_VERSION must be a release tag, like v0.3.0.' ;;
		esac

		return 0
	fi

	if grep -q '^RECODER_IMAGE_TAG=' "$env_file" 2>/dev/null; then
		sed -n 's/^RECODER_IMAGE_TAG=//p' "$env_file" | head -n 1

		return 0
	fi

	tag="$(curl -fsSL --max-time 15 "https://api.github.com/repos/$repo/releases/latest" |
		sed -n 's/.*"tag_name" *: *"\([^"]*\)".*/\1/p' | head -n 1)"
	[ -n "$tag" ] || fail 'could not read the latest release from GitHub.'
	printf '%s' "$tag"
}

# The public addresses of this server, so the setup wizard can check a domain's DNS against them.
public_ips() {
	v4="$(curl -fsSL --max-time 5 https://api.ipify.org 2>/dev/null || true)"
	v6="$(curl -fsSL --max-time 5 https://api6.ipify.org 2>/dev/null || true)"

	printf '%s\n%s\n' "$v4" "$v6" | sed '/^$/d' | sort -u | tr '\n' ',' | sed 's/,$//'
}

# The secret key seals every saved credential; losing it loses them, so it is generated once and kept.
if ! grep -q '^RECODER_SECRET_KEY=' "$env_file" 2>/dev/null; then
	if command -v openssl >/dev/null 2>&1; then
		secret="$(openssl rand -base64 32)"
	else
		secret="$(head -c 32 /dev/urandom | base64)"
	fi

	set_env RECODER_SECRET_KEY "$secret"
fi

# The token the server and the updater sidecar share over their control socket.
if [ ! -s "$token_file" ]; then
	umask 077
	if command -v openssl >/dev/null 2>&1; then
		openssl rand -hex 32 > "$token_file"
	else
		head -c 32 /dev/urandom | base64 | tr -d '\n' > "$token_file"
	fi
	umask 022
fi

chmod 600 "$token_file"

set_env RECODER_IMAGE_TAG "$(docker_tag)"
set_env RECODER_PUBLIC_IPS "$(public_ips)"

if [ -z "$domain_arg" ] && grep -q '^RECODER_DOMAIN=' "$env_file" 2>/dev/null; then
	domain_arg="$(sed -n 's/^RECODER_DOMAIN=//p' "$env_file")"
fi

if [ -n "${domain_arg:-}" ]; then
	domain_arg="$(printf '%s' "$domain_arg" | tr 'A-Z' 'a-z' | sed 's/\.$//')"

	case "$domain_arg" in
	'' | *[!a-z0-9.-]*)
		fail "that is not a domain: $domain_arg"
		;;
	*)
		case "$domain_arg" in
		*.*) ;;
		*) fail "that is not a domain: $domain_arg" ;;
		esac
		;;
	esac
elif has_tty; then
	printf "The domain Caddy should serve, empty for plain HTTP on this server's address: " > /dev/tty
	domain_arg="$(head -n 1 < /dev/tty || true)"
fi

set_env RECODER_DOMAIN "${domain_arg:-}"

write_caddyfile() {
	{
		printf '{\n\tadmin :2019\n}\n\n'
		if [ -n "$1" ]; then
			printf '%s {\n' "$1"
			if [ "$internal_tls" = yes ]; then
				printf '\ttls internal\n'
			fi
		else
			printf ':80 {\n'
		fi
		printf '\treverse_proxy recoder-server:3001 {\n\t\tflush_interval -1\n\t}\n}\n'
	} > "$caddyfile"
}

write_compose() {
	cat > "$compose_file" << 'EOF'
name: recoder

services:
  server:
    image: ghcr.io/aidan-neel/recoder:${RECODER_IMAGE_TAG}
    container_name: recoder-server
    restart: unless-stopped
    labels:
      dev.recoder.updater-managed: 'true'
    networks:
      internal:
        aliases: [recoder-server]
    environment:
      PORT: '3001'
      HOST: 0.0.0.0
      RECODER_SECRET_KEY: ${RECODER_SECRET_KEY}
      RECODER_PUBLIC_URL: ${RECODER_PUBLIC_URL}
      FRONTEND_URL: ${RECODER_PUBLIC_URL:-http://localhost:3001}
      RECODER_TLS: ${RECODER_TLS}
      RECODER_PUBLIC_IPS: ${RECODER_PUBLIC_IPS}
      RECODER_DATA_DIR: /app/data
      XDG_CONFIG_HOME: /app/config
      RECODER_WORKDIR: /tmp/recoder-work
      RECODER_COMMAND_TIMEOUT_MS: '120000'
      GITHUB_WEBHOOK_SECRET: ${GITHUB_WEBHOOK_SECRET:-}
      GITLAB_WEBHOOK_SECRET: ${GITLAB_WEBHOOK_SECRET:-}
      RECODER_GITHUB_CLIENT_ID: ${RECODER_GITHUB_CLIENT_ID:-}
      RECODER_GITLAB_CLIENT_ID: ${RECODER_GITLAB_CLIENT_ID:-}
      RECODER_GITHUB_CLIENT_SECRET: ${RECODER_GITHUB_CLIENT_SECRET:-}
      RECODER_GITLAB_CLIENT_SECRET: ${RECODER_GITLAB_CLIENT_SECRET:-}
      GITHUB_TOKEN: ${GITHUB_TOKEN:-}
      GITLAB_TOKEN: ${GITLAB_TOKEN:-}
      GITLAB_HOST: ${GITLAB_HOST:-}
    volumes:
      - recoder-data:/app/data
      - recoder-config:/app/config
      - recoder-work:/tmp/recoder-work
      - recoder-updater-socket:/run/recoder-updater
      - ./secrets/recoder-updater-token:/run/secrets/recoder-updater-token:ro
    depends_on:
      - updater

  updater:
    image: ghcr.io/aidan-neel/recoder-updater:${RECODER_IMAGE_TAG}
    container_name: recoder-updater
    restart: unless-stopped
    networks:
      - internal
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - recoder-data:/app/data:ro
      - recoder-updater:/var/lib/recoder-updater
      - recoder-updater-socket:/run/recoder-updater
      - ./secrets/recoder-updater-token:/run/secrets/recoder-updater-token:ro

  caddy:
    image: caddy:2
    container_name: recoder-caddy
    restart: unless-stopped
    networks:
      edge:
      internal:
        aliases: [caddy]
    ports:
      - '80:80'
      - '443:443'
      - '443:443/udp'
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
      - caddy-config:/config
    depends_on:
      - server

networks:
  edge:
  internal:

volumes:
  recoder-data:
  recoder-config:
  recoder-work:
  recoder-updater:
  recoder-updater-socket:
  caddy-data:
  caddy-config:
EOF
}

if [ -n "${domain_arg:-}" ]; then
	set_env RECODER_TLS caddy
	set_env RECODER_PUBLIC_URL "https://$domain_arg"
else
	set_env RECODER_TLS off
	set_env RECODER_PUBLIC_URL ''
fi

write_caddyfile "${domain_arg:-}"
write_compose

cd "$install_dir"

image_tag="$(docker_tag)"

# A pull that fails is fatal, unless the images are already here (an offline re-run, or a locally built one).
if ! docker compose pull --quiet; then
	for image in "ghcr.io/aidan-neel/recoder:$image_tag" "ghcr.io/aidan-neel/recoder-updater:$image_tag"; do
		docker image inspect "$image" >/dev/null 2>&1 || fail "could not pull $image from ghcr.io. If the release just went out, the ghcr.io/$repo package may still be private: make it public on https://github.com/$repo/pkgs/container/recoder once."
	done
fi

docker compose up -d

wait_for_health() {
	health() {
		if [ -n "${domain_arg:-}" ]; then
			curl -fsSk --max-time 3 --resolve "$domain_arg:443:127.0.0.1" "https://$domain_arg/health" >/dev/null 2>&1
		else
			curl -fsS --max-time 3 http://127.0.0.1/health >/dev/null 2>&1
		fi
	}

	attempts=0
	while [ "$attempts" -lt 60 ]; do
		if health; then
			return 0
		fi
		attempts=$((attempts + 1))
		sleep 2
	done

	docker compose logs --tail 40 server >&2 || true
	fail 'Recoder did not become healthy within two minutes.'
}

wait_for_health

code="$(docker logs recoder-server 2>&1 | sed -n 's/.*setup code: \([A-Za-z0-9]*\).*/\1/p' | head -n 1)"

if [ -n "${domain_arg:-}" ]; then
	address="https://$domain_arg"
else
	address="$(public_ips | cut -d, -f1)"
	if [ -n "$address" ]; then
		address="http://$address"
	else
		address='this server'
	fi
fi

if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q ' active'; then
	printf 'The firewall is on: open ports 80 and 443 with `ufw allow 80,443/tcp`.\n'
fi

echo ''
echo 'Recoder is running.'
echo "Open $address and enter the setup code: ${code:-(docker logs recoder-server shows it)}"
echo 'It updates itself from Settings → Server; the updater keeps a backup before every update.'
