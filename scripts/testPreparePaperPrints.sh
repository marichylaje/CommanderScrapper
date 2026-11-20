#!/usr/bin/env bash
set -euo pipefail
tmp=$(mktemp -d)
trap 'rm -rf -- "$tmp"' EXIT
mkdir "$tmp/scripts"
cp scripts/{preparePaperPrints.sh,paperPrints.jq} "$tmp/scripts/"
cd "$tmp"
# Exercise the full shell pipeline, including decompression, without fetching a bulk archive.
curl() {
  case "${!#}" in
    https://api.scryfall.com/bulk-data/all_cards) cat meta ;;
    https://example.test/prints) cat bulk ;;
    *) return 22 ;;
  esac
}
export -f curl
stamp=2026-11-19T22:23:18.305+00:00
metadata() {
  printf '{"type":"all_cards","updated_at":"%s",%s}\n' "$stamp" "$1" > meta
}
printf '%s\n' '{"id":"sld","games":["paper"],"lang":"ja","card_faces":[{"image_uris":{"normal":"front"}}]}' \
  '{"id":"digital","games":["arena"]}' '{"id":"missing-games"}' > cards
gzip -c cards > bulk
metadata '"jsonl_download_uri":"https://example.test/prints"'
bash scripts/preparePaperPrints.sh
jq -bes 'length == 1 and .[0].id == "sld" and .[0].image_uris.normal == "front"' data/paper-prints.jsonl >/dev/null
test "$(cat data/paper-prints.updated)" = "$stamp"
cp data/paper-prints.jsonl expected
jq -bs . cards > bulk
metadata '"jsonl_download_uri":42,"download_uri":"https://example.test/prints"'
bash scripts/preparePaperPrints.sh
cmp expected data/paper-prints.jsonl
must_fail() {
  if bash scripts/preparePaperPrints.sh; then echo 'Invalid input accepted' >&2; exit 1; fi
  cmp expected data/paper-prints.jsonl
  test "$(cat data/paper-prints.updated)" = "$stamp"
}
printf '[{"games":["paper"]},' > bulk
must_fail
metadata '"download_uri":null'
must_fail
metadata '"jsonl_download_uri":"https://example.test/prints"'
printf '{"games":["paper"]}\n{' | gzip -c > bulk
must_fail
echo 'Paper bulk preparation fixtures passed'
