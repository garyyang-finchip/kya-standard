#!/usr/bin/env bash
# Lay this repo out as an ethereum/ERCs pull request.
# Usage: tools/prepare-pr.sh <path-to-ERCs-fork> <erc-number>
#   e.g. tools/prepare-pr.sh ~/src/ERCs 9999
set -euo pipefail

FORK="${1:?path to ERCs fork}"
NUM="${2:?ERC number (use 9999 until assigned)}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"

DEST_MD="$FORK/ERCS/erc-$NUM.md"
DEST_ASSETS="$FORK/assets/erc-$NUM"

mkdir -p "$FORK/ERCS" "$DEST_ASSETS"
sed -e "s/^eip: 9999/eip: $NUM/" \
    -e "s#eip-9999#eip-$NUM#g" -e "s#erc-9999#erc-$NUM#g" \
    "$HERE/ERCS/erc-kya.md" > "$DEST_MD"

rm -rf "$DEST_ASSETS"
cp -R "$HERE/assets/erc-kya" "$DEST_ASSETS"
# assets must not carry test-only mocks in the PR
rm -rf "$DEST_ASSETS/contracts/mocks"
find "$DEST_ASSETS" -type f \( -name '*.json' -o -name '*.sol' -o -name '*.md' \) -exec sed -i -e "s#eip-9999#eip-$NUM#g" -e "s#erc-9999#erc-$NUM#g" {} +

echo "wrote $DEST_MD"
echo "wrote $DEST_ASSETS/"
echo
echo "next:"
echo "  cd $FORK && git fetch upstream && git checkout -b add-erc-kya upstream/master"
echo "  git add ERCS/erc-$NUM.md assets/erc-$NUM && git commit -m 'Add ERC: Know-Your-Agent (KYA) Framework'"
