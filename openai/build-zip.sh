#!/bin/sh
# Builds the OpenAI plugin ZIP (ChatGPT and Codex) from this folder: plugin.json, mcp.json,
# skills/ and assets/ at the archive root, nothing else. Usage: openai/build-zip.sh [out.zip]
set -eu
here=$(cd "$(dirname "$0")" && pwd)
version=$(sed -n 's/^  "version": "\(.*\)",$/\1/p' "$here/plugin.json")
out=${1:-"$PWD/box-by-simular-openai-$version.zip"}
rm -f "$out"
cd "$here"
zip -q -r -X "$out" plugin.json mcp.json skills assets -x '*/.DS_Store'
echo "$out"
