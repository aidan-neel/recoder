#!/bin/sh
# Installs the recoder command line: curl -fsSL https://recoder.dev/install.sh | sh
# RECODER_VERSION picks a release tag (default: the latest).
# RECODER_INSTALL_DIR picks the folder (default: ~/.local/bin).
set -eu

repo="aidan-neel/recoder"
version="${RECODER_VERSION:-latest}"
install_dir="${RECODER_INSTALL_DIR:-$HOME/.local/bin}"

fail() {
	printf 'recoder install: %s\n' "$1" >&2
	exit 1
}

case "$(uname -s)" in
Linux) os=linux ;;
Darwin) os=darwin ;;
*) fail "$(uname -s) is not supported. On Windows, run this in WSL." ;;
esac

case "$(uname -m)" in
x86_64 | amd64) arch=x64 ;;
arm64 | aarch64) arch=arm64 ;;
*) fail "$(uname -m) processors are not supported." ;;
esac

# A shell under Rosetta reports x86_64 on an Apple Silicon Mac; the native binary is faster.
if [ "$os" = darwin ] && [ "$arch" = x64 ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || true)" = 1 ]; then
	arch=arm64
fi

if [ "$version" = latest ]; then
	base="https://github.com/$repo/releases/latest/download"
else
	base="https://github.com/$repo/releases/download/$version"
fi

asset="recoder-$os-$arch"
command -v curl >/dev/null 2>&1 || fail "curl is required."

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

printf 'Downloading %s (%s)...\n' "$asset" "$version"
curl -fsSL "$base/$asset" -o "$tmp/recoder" || fail "could not download $base/$asset."
curl -fsSL "$base/SHA256SUMS" -o "$tmp/SHA256SUMS" || fail "could not download $base/SHA256SUMS."

expected="$(awk -v name="$asset" '$2 == name { print $1 }' "$tmp/SHA256SUMS")"
[ -n "$expected" ] || fail "SHA256SUMS has no entry for $asset."

if command -v sha256sum >/dev/null 2>&1; then
	actual="$(sha256sum "$tmp/recoder" | awk '{ print $1 }')"
else
	actual="$(shasum -a 256 "$tmp/recoder" | awk '{ print $1 }')"
fi

[ "$expected" = "$actual" ] || fail "the download of $asset does not match its checksum."

mkdir -p "$install_dir"
chmod +x "$tmp/recoder"
mv "$tmp/recoder" "$install_dir/recoder"

printf 'Installed recoder %s to %s/recoder\n' "$("$install_dir/recoder" --version)" "$install_dir"

case ":$PATH:" in
*":$install_dir:"*) printf 'Run recoder doctor to check this machine.\n' ;;
*)
	printf '\n%s is not on your PATH. Add this line to your shell profile (~/.zshrc or ~/.bashrc):\n' "$install_dir"
	printf '  export PATH="%s:$PATH"\n' "$install_dir"
	printf 'Then run recoder doctor to check this machine.\n'
	;;
esac
