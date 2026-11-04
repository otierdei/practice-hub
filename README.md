# Practice Hub

App für Otis Schlagzeugschüler: Stunden loggen, Hausaufgaben, Übungsbibliothek, Stoppuhr mit Metronom, Fortschritt. Rollen: Lehrer, Schüler, Eltern.

- `index.html`, `sw.js`, `manifest.webmanifest`, `datenschutz.html`: App auf GitHub Pages
- `worker/`: Cloudflare Worker mit D1 (Jurisdiktion EU), Deploy über `.github/workflows/worker.yml`
- Keine Schülerdaten im Repo.

## Tests
- `node --test worker/test/worker.test.mjs` (Rechte je Rolle, Löschkonzept)
- `node tools/dev-server.mjs` und dann `node tools/e2e.cjs` (Ablauf im Browser, Playwright)
