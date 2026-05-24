#!/usr/bin/env node
/**
 * Fase 4 — DOM binding + asset smoke checks (no browser required).
 * Usage: node scripts/validate-phase4.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(root, "index.html"), "utf8");
const jsDir = join(root, "js");
const jsText = readdirSync(jsDir)
  .filter((f) => f.endsWith(".js"))
  .map((f) => readFileSync(join(jsDir, f), "utf8"))
  .join("\n");

const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
const missing = ids.filter((id) => {
  const refs = [
    `getElementById("${id}")`,
    `getElementById('${id}')`,
    `"${id}"`,
    `'${id}'`,
    `#${id}`,
    `id="${id}"`,
  ];
  return !refs.some((r) => jsText.includes(r) || html.includes(r));
});

const head = html.slice(0, html.indexOf("</head>"));
const blockingCdn = ["chart.js", "echarts", "maplibre-gl"].filter((s) =>
  head.includes(s),
);
const hasLoadLibs = head.includes("js/load-libs.js");
const stats = JSON.parse(readFileSync(join(root, "data/stats.json"), "utf8"));
const suffixes = (stats.sourceStats?.domainSuffixes || []).map((r) => r.suffix);
const badSuffix = suffixes.filter(
  (s) => !["id", "go.id", "ac.id", "sch.id", "desa.id", "or.id", "co.id", "mil.id", "my.id", "biz.id", "ponpes.id", "web.id"].includes(s),
);

let failed = false;
const ok = (msg) => console.log(`✓ ${msg}`);
const fail = (msg) => {
  console.error(`✗ ${msg}`);
  failed = true;
};

ok(`${ids.length} HTML id= bindings`);
if (missing.length) fail(`Missing JS refs: ${missing.join(", ")}`);
else ok("All ids referenced in JS/HTML");

if (blockingCdn.length) fail(`CDN still in <head>: ${blockingCdn.join(", ")}`);
else ok("No Chart/ECharts/MapLibre in <head>");

if (!hasLoadLibs) fail("load-libs.js missing from <head>");
else ok("load-libs.js present");

if (badSuffix.length) fail(`Unmasked domain suffixes in stats.json: ${badSuffix.join(", ")}`);
else ok(`domainSuffixes safe (${suffixes.length} rows)`);

if (failed) process.exit(1);
console.log("\nFase 4 static validation passed.");
