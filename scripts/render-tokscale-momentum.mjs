#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_BASE = "https://tokscale.ai";
const TREND_DAYS = 30;
const COMPARISON_DAYS = 7;

function parseArgs(argv) {
  const args = {
    username: process.env.TOKSCALE_USERNAME || "George-RD",
    out: "assets/tokscale-model-momentum.svg",
    meta: "assets/tokscale-dossier.json",
    base: process.env.TOKSCALE_API_BASE || DEFAULT_BASE,
    fixture: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--username") args.username = argv[++index];
    else if (value === "--out") args.out = argv[++index];
    else if (value === "--meta") args.meta = argv[++index];
    else if (value === "--base") args.base = argv[++index];
    else if (value === "--fixture") args.fixture = argv[++index];
    else throw new Error(`Unknown argument: ${value}`);
  }

  return args;
}

function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function compactNumber(value) {
  const n = number(value);
  const abs = Math.abs(n);
  const units = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];

  for (const [scale, suffix] of units) {
    if (abs >= scale) {
      const scaled = n / scale;
      const digits = Math.abs(scaled) >= 100 ? 0 : Math.abs(scaled) >= 10 ? 1 : 2;
      return `${scaled
        .toFixed(digits)
        .replace(/\.0+$/, "")
        .replace(/(\.\d*[1-9])0+$/, "$1")}${suffix}`;
    }
  }

  return Math.round(n).toLocaleString("en-US");
}

function signedPercentagePoints(value) {
  const rounded = Math.abs(value) < 0.05 ? 0 : value;
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded.toFixed(1)} PP`;
}

function dateKey(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function formatShortDate(value) {
  const key = dateKey(value);
  if (!key) return "UNKNOWN";
  return new Date(`${key}T00:00:00.000Z`)
    .toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      timeZone: "UTC",
    })
    .toUpperCase();
}

function canonicalModelName(value) {
  let model = String(value || "").trim();
  if (!model || model === "unknown" || model === "<synthetic>") return "";
  model = model.replace(/^(?:anthropic|openai|google)\//, "");
  model = model.replace(/^deepseek:(?=deepseek-)/, "");
  return model;
}

function tokenBreakdownTotal(value) {
  if (!value || typeof value !== "object") return 0;
  return (
    number(value.input) +
    number(value.output) +
    number(value.cacheRead) +
    number(value.cacheWrite) +
    number(value.reasoning) +
    number(value.inputTokens) +
    number(value.outputTokens) +
    number(value.cacheReadTokens) +
    number(value.cacheWriteTokens) +
    number(value.reasoningTokens)
  );
}

function modelEntryTokens(entry) {
  if (typeof entry === "number") return number(entry);
  if (!entry || typeof entry !== "object") return 0;
  if (typeof entry.tokens === "number") return number(entry.tokens);
  if (typeof entry.totalTokens === "number") return number(entry.totalTokens);
  if (entry.tokens && typeof entry.tokens === "object") return tokenBreakdownTotal(entry.tokens);
  return tokenBreakdownTotal(entry);
}

function clientTokenTotal(client) {
  if (!client || typeof client !== "object") return 0;
  if (typeof client.totalTokens === "number") return number(client.totalTokens);
  if (typeof client.tokens === "number") return number(client.tokens);
  return tokenBreakdownTotal(client.tokens || client);
}

function modelTotalsForContribution(contribution) {
  const totals = new Map();

  for (const client of contribution?.clients || []) {
    const entries = Object.entries(client.models || {});
    if (entries.length > 0) {
      for (const [rawModel, data] of entries) {
        const model = canonicalModelName(rawModel);
        if (!model) continue;
        totals.set(model, number(totals.get(model)) + modelEntryTokens(data));
      }
      continue;
    }

    const model = canonicalModelName(client.modelId || client.model);
    if (model) totals.set(model, number(totals.get(model)) + clientTokenTotal(client));
  }

  return totals;
}

function dateRange(endDate, count) {
  const end = new Date(`${dateKey(endDate)}T00:00:00.000Z`);
  if (Number.isNaN(end.getTime())) return [];
  const dates = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const date = new Date(end);
    date.setUTCDate(end.getUTCDate() - offset);
    dates.push(date.toISOString().slice(0, 10));
  }
  return dates;
}

function contributionModelTotal(contribution) {
  return [...modelTotalsForContribution(contribution).values()].reduce(
    (sum, value) => sum + number(value),
    0,
  );
}

function latestModelActivityDate(profile) {
  const contributions = [...(profile?.contributions || [])]
    .filter((entry) => entry?.date)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  for (let index = contributions.length - 1; index >= 0; index -= 1) {
    if (contributionModelTotal(contributions[index]) > 0) {
      return dateKey(contributions[index].date);
    }
  }

  return (
    dateKey(contributions.at(-1)?.date) ||
    dateKey(profile?.updatedAt) ||
    dateKey(profile?.dateRange?.end) ||
    dateKey(new Date())
  );
}

function buildModelMomentum(profile, count = 5) {
  const contributions = [...(profile?.contributions || [])]
    .filter((entry) => entry?.date)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const dataThrough = latestModelActivityDate(profile);
  const dates = dateRange(dataThrough, TREND_DAYS);
  const indexByDate = new Map(dates.map((date, index) => [date, index]));
  const seriesByModel = new Map();

  for (const contribution of contributions) {
    const index = indexByDate.get(dateKey(contribution.date));
    if (index === undefined) continue;
    for (const [model, tokens] of modelTotalsForContribution(contribution)) {
      if (tokens <= 0) continue;
      const series = seriesByModel.get(model) || Array(TREND_DAYS).fill(0);
      series[index] += tokens;
      seriesByModel.set(model, series);
    }
  }

  const recentStart = Math.max(0, TREND_DAYS - COMPARISON_DAYS);
  const priorStart = Math.max(0, recentStart - COMPARISON_DAYS);
  const priorEnd = recentStart;
  const allSeries = [...seriesByModel.entries()];
  const totalRecent = allSeries.reduce(
    (total, [, series]) => total + series.slice(recentStart).reduce((sum, value) => sum + value, 0),
    0,
  );
  const totalPrior = allSeries.reduce(
    (total, [, series]) =>
      total + series.slice(priorStart, priorEnd).reduce((sum, value) => sum + value, 0),
    0,
  );

  const metrics = allSeries
    .map(([model, series]) => {
      const recentTokens = series.slice(recentStart).reduce((sum, value) => sum + value, 0);
      const priorTokens = series
        .slice(priorStart, priorEnd)
        .reduce((sum, value) => sum + value, 0);
      const recentShare = totalRecent ? recentTokens / totalRecent : 0;
      const priorShare = totalPrior ? priorTokens / totalPrior : 0;
      const deltaPercentagePoints = (recentShare - priorShare) * 100;
      const direction =
        deltaPercentagePoints > 0.5
          ? "up"
          : deltaPercentagePoints < -0.5
            ? "down"
            : "flat";
      return {
        model,
        series,
        recentTokens,
        priorTokens,
        recentShare,
        priorShare,
        deltaPercentagePoints,
        direction,
      };
    })
    .filter((entry) => entry.recentTokens > 0 || entry.priorTokens > 0)
    .sort(
      (a, b) =>
        b.recentTokens - a.recentTokens ||
        b.priorTokens - a.priorTokens ||
        b.deltaPercentagePoints - a.deltaPercentagePoints,
    );

  const selected = metrics.filter((entry) => entry.recentTokens > 0).slice(0, count);
  const minimumRiserVolume = Math.max(totalRecent * 0.005, 1_000_000);
  const fastestRiser = totalRecent
    ? [...metrics]
        .filter(
          (entry) =>
            entry.recentTokens >= minimumRiserVolume && entry.deltaPercentagePoints > 0.05,
        )
        .sort(
          (a, b) =>
            b.deltaPercentagePoints - a.deltaPercentagePoints ||
            b.recentTokens - a.recentTokens,
        )[0] || null
    : null;

  if (
    fastestRiser &&
    !selected.some((entry) => entry.model === fastestRiser.model) &&
    selected.length > 0
  ) {
    selected[selected.length - 1] = fastestRiser;
    selected.sort(
      (a, b) =>
        b.recentTokens - a.recentTokens ||
        b.deltaPercentagePoints - a.deltaPercentagePoints,
    );
  }

  return {
    dates,
    dataThrough,
    sourceUpdatedAt: profile?.updatedAt || null,
    recentStart,
    priorStart,
    priorEnd,
    totalRecent,
    totalPrior,
    rows: selected,
    leading: metrics.find((entry) => entry.recentTokens > 0) || null,
    fastestRiser,
  };
}

function sparkGeometry(series, x, y, width, height) {
  const maxValue = Math.max(...series, 1);
  const step = series.length > 1 ? width / (series.length - 1) : width;
  const points = series.map((value, index) => ({
    x: x + index * step,
    y: y + height - (number(value) / maxValue) * height,
  }));
  const line = points
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`,
    )
    .join(" ");
  const area = points.length
    ? `M${points[0].x.toFixed(1)} ${(y + height).toFixed(1)} ${points
        .map((point) => `L${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
        .join(" ")} L${points.at(-1).x.toFixed(1)} ${(y + height).toFixed(1)} Z`
    : `M${x} ${y + height}L${x + width} ${y + height}Z`;
  return { line, area, last: points.at(-1) || { x, y: y + height } };
}

function renderMomentumSvg({ momentum, username, base = DEFAULT_BASE, generatedAt = new Date() }) {
  const generated = new Date(generatedAt);
  const generatedKey = dateKey(generated);
  const firstRecentDate = momentum.dates[momentum.recentStart] || momentum.dataThrough;
  const lastDate = momentum.dates.at(-1) || momentum.dataThrough;
  const priorFirstDate = momentum.dates[momentum.priorStart];
  const priorLastDate = momentum.dates[Math.max(momentum.priorStart, momentum.priorEnd - 1)];
  const leading = momentum.leading;
  const riser = momentum.fastestRiser;

  const rows = momentum.rows
    .map((entry, index) => {
      const top = 180 + index * 48;
      const textY = top + 22;
      const spark = sparkGeometry(entry.series, 355, top + 2, 540, 28);
      const boundaryX = 355 + (momentum.recentStart / (TREND_DAYS - 1)) * 540;
      return `<g class="model-row" style="animation-delay:${index * 110}ms">
    <text class="row-rank" x="58" y="${textY}">${String(index + 1).padStart(2, "0")}</text>
    <text class="row-model" x="96" y="${textY}">${escapeXml(entry.model)}</text>
    <line class="row-baseline" x1="355" y1="${top + 30}" x2="895" y2="${top + 30}" />
    <line class="recent-boundary" x1="${boundaryX.toFixed(1)}" y1="${top}" x2="${boundaryX.toFixed(1)}" y2="${top + 31}" />
    <path class="spark-area ${entry.direction}" d="${spark.area}" />
    <path class="spark ${entry.direction}" style="animation-delay:${index * 110}ms" pathLength="1" d="${spark.line}" />
    <circle class="spark-dot ${entry.direction}" style="animation-delay:${index * 110 + 900}ms" cx="${spark.last.x.toFixed(1)}" cy="${spark.last.y.toFixed(1)}" r="3.5" />
    <text class="row-value" x="1032" y="${textY}" text-anchor="end">${escapeXml(compactNumber(entry.recentTokens))}</text>
    <text class="row-delta ${entry.direction}" x="1142" y="${textY}" text-anchor="end">${escapeXml(signedPercentagePoints(entry.deltaPercentagePoints))}</text>
    <line class="row-rule" x1="58" y1="${top + 41}" x2="1142" y2="${top + 41}" />
  </g>`;
    })
    .join("\n  ");

  const emptyRows = momentum.rows.length
    ? ""
    : `<text class="empty" x="58" y="245">NO MODEL-LEVEL ACTIVITY RECORDED IN THIS WINDOW</text>`;
  const sourceUpdated = dateKey(momentum.sourceUpdatedAt);
  const sourceStamp = sourceUpdated
    ? `SOURCE UPDATED ${formatShortDate(sourceUpdated)}`
    : `SOURCE TOKSCALE.AI/U/${username}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 450" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXml(username)} personal model momentum</title>
  <desc id="desc">Thirty-day model activity, anchored to the latest day with model-level data, with the latest seven days compared with the preceding seven days.</desc>
  <!-- Generated from ${escapeXml(new URL(`/api/users/${encodeURIComponent(username)}?period=month`, base).href)} at ${generated.toISOString()} -->
  <style>
    .paper{fill:#f1ede4}.edge,.rule,.row-rule,.row-baseline,.recent-boundary{fill:none;stroke:#b9b2a5}.edge{stroke:#10231f;stroke-width:2}.rule{stroke-width:1}.row-rule{stroke-width:.8;opacity:.6}.row-baseline{stroke-width:1;opacity:.8}.recent-boundary{stroke-width:1;stroke-dasharray:3 4;opacity:.7}
    .kicker{fill:#c9482b;font-family:ui-monospace,"SFMono-Regular",Consolas,monospace;font-size:14px;font-weight:700;letter-spacing:2px}.meta,.summary-label,.column-label,.row-rank,.stamp{fill:#304943;font-family:ui-monospace,"SFMono-Regular",Consolas,monospace;font-weight:700;letter-spacing:1px}.meta{font-size:11px}.summary-label,.column-label{font-size:10px}.summary-value{fill:#10231f;font-family:"Arial Narrow","Avenir Next Condensed","Helvetica Neue",sans-serif;font-size:23px;font-weight:800}.summary-note{fill:#304943;font-family:"Avenir Next","Segoe UI","Helvetica Neue",sans-serif;font-size:11px;font-weight:600}.row-rank{font-size:11px}.row-model{fill:#10231f;font-family:"Avenir Next","Segoe UI","Helvetica Neue",sans-serif;font-size:15px;font-weight:700}.row-value,.row-delta{font-family:ui-monospace,"SFMono-Regular",Consolas,monospace;font-size:12px;font-weight:700;letter-spacing:.5px}.row-value{fill:#10231f}.row-delta.up{fill:#c9482b}.row-delta.down{fill:#173e50}.row-delta.flat{fill:#445d50}
    .spark{fill:none;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:1;stroke-dashoffset:1;animation:draw 1300ms cubic-bezier(0.16,1,0.3,1) forwards}.spark.up{stroke:#c9482b}.spark.down{stroke:#173e50}.spark.flat{stroke:#445d50}.spark-area{opacity:.09}.spark-area.up,.spark-dot.up{fill:#c9482b}.spark-area.down,.spark-dot.down{fill:#173e50}.spark-area.flat,.spark-dot.flat{fill:#445d50}.spark-dot{transform-box:fill-box;transform-origin:center;animation:ping 650ms cubic-bezier(0.16,1,0.3,1) both}.model-row{animation:reveal 500ms cubic-bezier(0.16,1,0.3,1) both}.stamp{font-size:10px}.empty{fill:#304943;font-family:ui-monospace,"SFMono-Regular",Consolas,monospace;font-size:13px;font-weight:700;letter-spacing:1px}
    @keyframes draw{to{stroke-dashoffset:0}}@keyframes reveal{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}@keyframes ping{from{opacity:0;transform:scale(.3)}to{opacity:1;transform:scale(1)}}
    @media (prefers-reduced-motion:reduce){.spark,.spark-dot,.model-row{animation:none}.spark{stroke-dashoffset:0}}
  </style>
  <rect class="paper" width="1200" height="450" />
  <rect class="edge" x="1" y="1" width="1198" height="448" />
  <line class="rule" x1="58" y1="58" x2="1142" y2="58" />
  <text class="kicker" x="58" y="39">TOKSCALE / PERSONAL MODEL MOMENTUM</text>
  <text class="meta" x="1142" y="39" text-anchor="end">DATA THROUGH ${escapeXml(formatShortDate(momentum.dataThrough))} / GENERATED ${escapeXml(formatShortDate(generatedKey))}</text>

  <text class="summary-label" x="58" y="87">LEADING NOW</text>
  <text class="summary-value" x="58" y="116">${escapeXml(leading?.model || "NO MODEL DATA")}</text>
  <text class="summary-note" x="58" y="134">${escapeXml(leading ? `${compactNumber(leading.recentTokens)} IN LATEST 7D` : "")}</text>

  <text class="summary-label" x="420" y="87">FASTEST RISER</text>
  <text class="summary-value" x="420" y="116">${escapeXml(riser?.model || "NO MATERIAL CHANGE")}</text>
  <text class="summary-note" x="420" y="134">${escapeXml(riser ? `${signedPercentagePoints(riser.deltaPercentagePoints)} SHARE SHIFT` : "")}</text>

  <text class="summary-label" x="822" y="87">7 DAY MODEL TOKENS</text>
  <text class="summary-value" x="822" y="116">${escapeXml(compactNumber(momentum.totalRecent))}</text>
  <text class="summary-note" x="822" y="134">${escapeXml(`${formatShortDate(firstRecentDate)} — ${formatShortDate(lastDate)}`)}</text>

  <line class="rule" x1="58" y1="151" x2="1142" y2="151" />
  <text class="column-label" x="58" y="169">RANK / MODEL</text>
  <text class="column-label" x="355" y="169">30 DAY TRACE / DASHED LINE MARKS LATEST 7D</text>
  <text class="column-label" x="1032" y="169" text-anchor="end">LATEST 7D</text>
  <text class="column-label" x="1142" y="169" text-anchor="end">SHARE SHIFT</text>

  ${rows}
  ${emptyRows}

  <text class="stamp" x="58" y="430">BASELINE ${escapeXml(`${formatShortDate(priorFirstDate)} — ${formatShortDate(priorLastDate)}`)}</text>
  <text class="stamp" x="1142" y="430" text-anchor="end">${escapeXml(sourceStamp)} / TOKSCALE.AI/U/${escapeXml(username)}</text>
</svg>\n`;
}

function serializeMomentum(momentum, generatedAt = new Date()) {
  return {
    generatedAt: new Date(generatedAt).toISOString(),
    dataThrough: momentum.dataThrough,
    sourceUpdatedAt: momentum.sourceUpdatedAt,
    dates: momentum.dates,
    latestWindow: {
      start: momentum.dates[momentum.recentStart] || null,
      end: momentum.dates.at(-1) || null,
      totalTokens: momentum.totalRecent,
    },
    previousWindow: {
      start: momentum.dates[momentum.priorStart] || null,
      end: momentum.dates[Math.max(momentum.priorStart, momentum.priorEnd - 1)] || null,
      totalTokens: momentum.totalPrior,
    },
    leadingModel: momentum.leading?.model || null,
    fastestRiser: momentum.fastestRiser?.model || null,
    models: momentum.rows.map((entry) => ({
      model: entry.model,
      recentTokens: entry.recentTokens,
      priorTokens: entry.priorTokens,
      recentShare: entry.recentShare,
      priorShare: entry.priorShare,
      deltaPercentagePoints: entry.deltaPercentagePoints,
      direction: entry.direction,
      series: entry.series,
    })),
  };
}

async function fetchProfile(base, username) {
  const url = new URL(`/api/users/${encodeURIComponent(username)}`, base);
  url.searchParams.set("period", "month");
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "George-RD-profile-momentum/3.0",
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Tokscale request failed ${response.status} ${response.statusText}: ${body.slice(0, 200)}`,
    );
  }
  const payload = await response.json();
  if (payload?.error) throw new Error(`Tokscale API error: ${payload.error}`);
  return payload;
}

async function loadProfile(args) {
  if (args.fixture) return JSON.parse(await fs.readFile(args.fixture, "utf8"));
  return fetchProfile(args.base, args.username);
}

async function patchMeta(metaPath, momentum, generatedAt) {
  if (!metaPath) return;
  let meta = {};
  try {
    meta = JSON.parse(await fs.readFile(metaPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  meta.modelMomentum = serializeMomentum(momentum, generatedAt);
  meta.sourceFreshness = {
    dataThrough: momentum.dataThrough,
    sourceUpdatedAt: momentum.sourceUpdatedAt,
    generatedAt: new Date(generatedAt).toISOString(),
  };
  await fs.mkdir(path.dirname(metaPath), { recursive: true });
  await fs.writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const profile = await loadProfile(args);
  const generatedAt = new Date();
  const momentum = buildModelMomentum(profile, 5);
  const svg = renderMomentumSvg({
    momentum,
    username: args.username,
    base: args.base,
    generatedAt,
  });

  await fs.mkdir(path.dirname(args.out), { recursive: true });
  await fs.writeFile(args.out, svg, "utf8");
  await patchMeta(args.meta, momentum, generatedAt);
  console.log(
    `Rendered Tokscale momentum for ${args.username}; data through ${momentum.dataThrough}`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

export {
  buildModelMomentum,
  canonicalModelName,
  latestModelActivityDate,
  modelTotalsForContribution,
  renderMomentumSvg,
  serializeMomentum,
};
