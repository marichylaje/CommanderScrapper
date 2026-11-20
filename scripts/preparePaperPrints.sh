#!/usr/bin/env bash
# Requires curl and jq 1.7+. Stream all_cards (all languages), not oracle_cards or the reducer.
set -euo pipefail
mkdir -p data
headers=(-H 'User-Agent: CommanderScrapper/3 (offline paper catalog)' -H 'Accept: application/json')
meta=$(curl -fsSL --retry 3 --max-time 60 "${headers[@]}" https://api.scryfall.com/bulk-data/all_cards)
updated=$(jq -er '.updated_at' <<<"$meta")
url=$(jq -er '.download_uri | select(startswith("https://"))' <<<"$meta")
# --stream reconstructs just one printing at a time; --stream-errors makes malformed input fatal.
curl -fsSL --compressed --max-time 1800 "${headers[@]}" "$url" |
  jq -nMc --stream --stream-errors -f scripts/paperPrints.jq > data/paper-prints.partial
test -s data/paper-prints.partial
mv data/paper-prints.partial data/paper-prints.jsonl
printf '%s\n' "$updated" > data/paper-prints.updated
