// Renders ../og-image.png and ../apple-touch-icon.png. Needs playwright-core and Chrome.
import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";
const here = new URL(".", import.meta.url);
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true });
const card = await b.newPage({ viewport: { width: 1200, height: 630 } });
await card.goto(new URL("og-card.html", here).href);
await card.screenshot({ path: new URL("../public/og-image.png", here).pathname });
const icon = await b.newPage({ viewport: { width: 180, height: 180 } });
const svg = readFileSync(new URL("../public/favicon.svg", here), "utf8").replace('rx="14"', 'rx="0"');
await icon.setContent(`<!DOCTYPE html><body style="margin:0">${svg}</body>`);
await icon.screenshot({ path: new URL("../public/apple-touch-icon.png", here).pathname });
await b.close();
