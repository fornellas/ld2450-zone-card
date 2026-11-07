// Renders the built card in headless Chrome, with fake data, and saves a screenshot of it.
//
// Usage:
//   node scripts/screenshot/screenshot.mjs           writes docs/screenshot.png
//   node scripts/screenshot/screenshot.mjs --check   fails if docs/screenshot.png is out of date (build first)
// Needs a Chrome or Chromium: set CHROME_PATH if it isn't found.

import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import puppeteer from "puppeteer-core";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const committed = join(root, "docs/screenshot.png");
const check = process.argv.includes("--check");
// Where a check leaves what the card looks like now, to see (or keep) when the committed one is out of date
const output = check ? join(root, "dist/screenshot.png") : committed;

// Chrome builds and platforms anti-alias differently (about 0.5% of the pixels between a laptop and GitHub Actions):
// only a larger share of different pixels, or a different size, is a real change
const MAX_DIFFERENT_PIXELS = 0.015;

const CHROME_CANDIDATES = [
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];
const chrome = process.env.CHROME_PATH ?? CHROME_CANDIDATES.find(existsSync);
if (chrome === undefined) throw new Error("Chrome not found: set CHROME_PATH");

const fonts = join(root, "node_modules/@fontsource/roboto/files");
const files = {
  "/": [join(root, "scripts/screenshot/index.html"), "text/html"],
  "/ld2450-zone-card.js": [join(root, "dist/ld2450-zone-card.js"), "text/javascript"],
  "/fonts/roboto-latin-400-normal.woff2": [join(fonts, "roboto-latin-400-normal.woff2"), "font/woff2"],
  "/fonts/roboto-latin-500-normal.woff2": [join(fonts, "roboto-latin-500-normal.woff2"), "font/woff2"],
};
const server = createServer((req, res) => {
  const file = files[req.url ?? ""];
  if (file === undefined) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "content-type": file[1] }).end(readFileSync(file[0]));
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  args: ["--no-sandbox", "--font-render-hinting=none", "--disable-font-subpixel-positioning", "--disable-lcd-text"],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 520, height: 800, deviceScaleFactor: 2 });
  page.on("pageerror", (err) => {
    throw err;
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  // The card has rendered once the map shows the zone and the sections are open
  const card = await page.waitForSelector("ld2450-zone-card");
  await page.waitForFunction(() => {
    const root = document.querySelector("ld2450-zone-card")?.shadowRoot;
    const map = root?.querySelector("ld2450-zone-map")?.shadowRoot;
    return map?.querySelector("g.zone") != null && root.querySelectorAll("details[open]").length === 3;
  });
  await page.evaluate(() => document.fonts.ready);
  await card.screenshot({ path: output, omitBackground: true });
  console.log(`Wrote ${output}`);
  if (check) compare();
} finally {
  await browser.close();
  server.close();
}

function compare() {
  const expected = PNG.sync.read(readFileSync(committed));
  const actual = PNG.sync.read(readFileSync(output));
  let ratio = 1;
  if (expected.width === actual.width && expected.height === actual.height) {
    const different = pixelmatch(expected.data, actual.data, undefined, actual.width, actual.height, {
      threshold: 0.3,
    });
    ratio = different / (actual.width * actual.height);
  }
  console.log(`${(ratio * 100).toFixed(3)}% of the pixels differ from docs/screenshot.png`);
  if (ratio > MAX_DIFFERENT_PIXELS) {
    console.error("docs/screenshot.png is out of date: run `npm run screenshot` and commit it.");
    process.exitCode = 1;
  }
}
