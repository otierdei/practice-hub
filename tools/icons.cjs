const { chromium } = require('playwright');
(async () => { const b = await chromium.launch(); const p = await b.newPage();
for (const s of [180, 512]) { await p.setViewportSize({ width: s, height: s }); await p.setContent(`<style>body{margin:0;background:#4f5a2c}</style><img src="http://localhost:8080/icon.svg" width="${s}" height="${s}">`); await p.waitForTimeout(200); await p.screenshot({ path: `icon-${s}.png` }); }
await b.close(); })();
