#!/usr/bin/env bash
# Deletes every turbo cache entry this run neither read nor wrote, so the cache saved for the next run holds one
# entry per task instead of growing with every commit. Sets the `changed` output to whether any task ran, which
# is when there is something new worth saving.
set -euo pipefail

cache_dir=${TURBO_CACHE_DIR:-.turbo/cache}
summaries=(.turbo/runs/*.json)

if [ ! -e "${summaries[0]}" ] || [ ! -d "$cache_dir" ]; then
	echo "changed=false" >> "$GITHUB_OUTPUT"
	exit 0
fi

used=$(jq -r '.tasks[].hash' "${summaries[@]}" | sort -u)

for entry in "$cache_dir"/*; do
	name=$(basename "$entry")
	hash=${name%%[.-]*}

	if ! grep -qx "$hash" <<< "$used"; then
		rm -f "$entry"
	fi
done

misses=$(jq -s '[.[].tasks[] | select(.cache.status == "MISS")] | length' "${summaries[@]}")

if [ "$misses" -gt 0 ]; then
	echo "changed=true" >> "$GITHUB_OUTPUT"
else
	echo "changed=false" >> "$GITHUB_OUTPUT"
fi
