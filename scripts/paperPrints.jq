fromstream(1 | truncate_stream(inputs | if (.[0] | type) == "string" then error(.[0]) else . end)) |
select(.games | index("paper")) |
{id,oracle_id,name,set,collector_number,lang,color_identity,colors,
 image_uris: ((.image_uris // .card_faces[0].image_uris) | {art_crop,normal})}
