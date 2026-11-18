#!/usr/bin/env bash
# Starts the PostgreSQL the HA suite needs, unless turbo already holds a passing run of that suite for this
# code. Most changes leave the server alone, and those runs never pull the image.
set -euo pipefail

status=$(bunx turbo run test:ha --dry=json | jq -r '.tasks[] | select(.taskId == "@recoder/server#test:ha") | .cache.status')

if [ "$status" = HIT ]; then
	echo "The HA suite is cached for this code; PostgreSQL is not needed."
	exit 0
fi

docker run --detach --name recoder-ha-postgres --publish 5432:5432 \
	--env POSTGRES_USER=recoder --env POSTGRES_PASSWORD=recoder-test-only --env POSTGRES_DB=recoder \
	postgres:17-alpine

# Over TCP, because the image's first-boot setup server answers on the socket alone and then restarts.
timeout 60 bash -c \
	'until docker exec recoder-ha-postgres pg_isready --host 127.0.0.1 --username recoder --dbname recoder; do sleep 1; done'
