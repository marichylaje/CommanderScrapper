#!/usr/bin/env bash
# Requires bash, curl, gzip and jq 1.7+. Run from the repository root.
set -euo pipefail

if [[ ! -f scripts/paperPrints.jq ]]; then
  echo "Missing scripts/paperPrints.jq in repository root" >&2
  exit 1
fi

mkdir -p data
headers=(-H 'User-Agent: CommanderScrapper/3 (offline paper catalog)' -H 'Accept: application/json')
meta=$(curl -fsSL --retry 3 --max-time 60 "${headers[@]}" https://api.scryfall.com/bulk-data/all_cards)
updated=$(jq -ber 'if .type == "all_cards" and (.updated_at | type == "string" and length > 0)
  then .updated_at else error("Expected all_cards metadata with updated_at") end' <<<"$meta")
source=$(jq -ber '
  def https: strings | select(test("^https://[^[:space:]]+$"));
  ((.jsonl_download_uri | https | ["jsonl", .]) //
   (.download_uri | https | ["array", .]) //
   error("all_cards metadata has no HTTPS jsonl_download_uri or download_uri")) | @tsv' <<<"$meta")
IFS=$'\t' read -r format url <<<"$source"
partial=$(mktemp data/paper-prints.partial.XXXXXX)
trap 'rm -f -- "$partial"' EXIT

# curl decodes HTTP compression; gzip -cdf also handles .gz payloads or passes plain input through.
if [[ $format == jsonl ]]; then
  filter=(-Mc -L scripts 'include "paperPrints"; paper_print')
else
  filter=(-nMc --stream --stream-errors -L scripts 'include "paperPrints"; fromstream(1 | truncate_stream(inputs |
    if (.[0] | type) == "string" then error(.[0]) else . end)) | paper_print')
fi

curl -fsSL --compressed --max-time 1800 "${headers[@]}" "$url" |
  gzip -cdf | jq -b "${filter[@]}" > "$partial"

if [[ ! -s $partial ]]; then
  echo "No paper printings in $format bulk download" >&2
  exit 1
fi

mv "$partial" data/paper-prints.jsonl
printf '%s\n' "$updated" > data/paper-prints.updated