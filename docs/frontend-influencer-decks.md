# Decks de influencers: cómo leer `sideboard`

Los archivos `data/influencers/influencer_precons_NN.json` (y `TOTAL.json`) contienen un array de decks.
Cada deck ahora trae, además de `cards`, una clave hermana **`sideboard`** con las cartas del banquillo.

## Forma de un deck

```jsonc
{
  "name": "Yalla, Yalla Inalla!",
  "commander": "Inalla, Archmage Ritualist (FCA) 52",
  // "partner": "Tymna the Weaver (CMR) 539 *E*",       // opcional: solo en decks con partner
  "influencerName": "Flo",
  "socialNetworks": [{ "instagram": "@mtgcommanderlandau", "tiktok": null, "youtube": null }],
  "deckDescription": { "en": "", "es": "", "it": "", "de": "", "ja": "", "pt": "", "fr": "" },
  "cards": [
    { "name": "Alania, Divergent Storm (BLB) 327", "count": 1 },
    { "name": "Swamp (OTJ) 282", "count": 28 }
  ],
  "sideboard": [
    { "name": "Cyclonic Rift (RVR) 40", "count": 1 },
    { "name": "Herald's Horn (LTC) 280", "count": 1 }
  ]
}
```

## Reglas de `sideboard`

- Es **siempre un array** con el mismo formato que `cards` (`{ name, count }`). Si el deck no tiene banquillo viene vacío: `[]`.
- Los datos publicados antes de esta versión no traen la clave: leer con `deck.sideboard ?? []`.
- **No cuenta** para las 100 cartas del deck: `cards` + commander(s) ya forman el mazo; el banquillo es aparte.
- El commander y el partner **no** aparecen ni en `cards` ni en `sideboard`.
- Solo se incluye el *sideboard* de la fuente. El *maybeboard*, los tokens y los companions no se exportan.
- Una misma carta con distinta impresión o acabado aparece en entradas distintas; `count` es la cantidad de copias de esa entrada.

## Formato de `name` (cartas, `sideboard`, `commander` y `partner`)

```
[Nombre de la carta] ([EDICIÓN]) [Número de coleccionista] [*Acabado*]
```

| Parte | Ejemplo | Siempre presente |
|---|---|---|
| Nombre | `Sol Ring`, `Brazen Borrower // Petty Theft` | Sí |
| Edición (código de set, mayúsculas) | `(CMM)` | No |
| Número de coleccionista | `123`, `2023-4` | Solo si hay edición |
| Acabado | `*F*` foil, `*E*` etched. Sin etiqueta = normal | No |

- La cantidad **no** va en el nombre: está en `count`.
- Hay un caso sin edición: cartas cuya web de origen no indica la impresión (por ejemplo, el banquillo de un deck de Deckstats). Llegan solo con el nombre: `"Chasm Guide"`.
- Para mostrar la carta exacta, buscar por set + número en Scryfall (`/cards/{set}/{numero}`); si no hay edición, buscar por nombre.

## Parsear `name`

Esta expresión regular se probó con todas las cartas publicadas (cards, sideboard, commander y partner) y reconstruye el texto original sin pérdidas:

```ts
const CARD_LINE = /^(.*?)(?: \(([A-Za-z0-9]+)\)(?: (\S+))?)?(?: \*([FE])\*)?$/;

function parseCardName(line: string) {
  const [, name, set, collectorNumber, finish] = line.match(CARD_LINE)!;
  return {
    name,                                      // "Sol Ring"
    set: set?.toLowerCase() ?? null,           // "cmm"
    collectorNumber: collectorNumber ?? null,  // "123"
    finish: finish === 'F' ? 'foil' : finish === 'E' ? 'etched' : 'normal',
  };
}
```

Ejemplos:

| `name` | Resultado |
|---|---|
| `Sol Ring (CMM) 123` | `Sol Ring`, `cmm`, `123`, normal |
| `Atraxa, Praetors' Voice (PF26) 10 *F*` | `Atraxa, Praetors' Voice`, `pf26`, `10`, foil |
| `Chasm Guide` | `Chasm Guide`, sin set, sin número, normal |
