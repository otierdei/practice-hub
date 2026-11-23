# iReal Pro Import

iReal Pro Playlist (Ablage > Playlist exportieren > iReal Pro Format, .html mit irealb:// Link) in Roadmaps umwandeln:

    python3 -I tools/ireal/decode.py playlist.html songs.json        # entschlüsseln (irealb Verfahren)
    python3 -I tools/ireal/to_roadmap.py songs.json roadmaps.json    # in das Roadmap Format (worker/src/roadmap.js)

Abgebildet: Formteile (*A, *B, *i, *V), eckige Klammern, Wiederholungen mit 1. und 2. Schluss, x (Takt wiederholen), r (zwei Takte wiederholen), N.C.
Weggelassen: Alternativakkorde in Klammern, Text in < >, Coda und Segno Sprünge (linear gelesen).
Nur Akkordfolgen übernehmen, keine Melodien oder Texte.

jazz-einstieg.json: Otis iReal Playlist "Playlist" (9 Songs), exportiert am 23.11.2026.
