def paper_print:
  if type != "object" then error("Expected a printing object") else . end |
  select((.games | arrays | index("paper")) and (.lang == "en" or .lang == "ja")) |
  {
    id,
    oracle_id: (.oracle_id // .card_faces[0].oracle_id // .card_faces[1].oracle_id),
    name,
    set,
    collector_number,
    lang,
    color_identity,
    colors,
    image_uris: ((.image_uris // .card_faces[0].image_uris) | {art_crop,normal})
  };