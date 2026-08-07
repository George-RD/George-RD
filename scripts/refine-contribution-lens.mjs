#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const COLORS = {
  paper: "#f1ede4",
  paperSoft: "#f7f4ed",
  ink: "#10231f",
  inkSoft: "#40534e",
  line: "#b9b2a5",
  rust: "#c9482b",
  blue: "#4b7fa0",
  gold: "#d5a72c",
  sage: "#8b9d83",
  intensity: ["#eee9de", "#d7d6c8", "#b7bea9", "#8d9e88", "#556e61", "#10231f"],
};

function parseArgs(argv) {
  const args = {
    input: "assets/contribution-lens.svg",
    mobileInput: "assets/contribution-lens-mobile.svg",
    meta: "assets/contribution-lens.json",
    out: "assets/contribution-lens.svg",
    mobileOut: "assets/contribution-lens-mobile.svg",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--in") args.input = argv[++index];
    else if (value === "--mobile-in") args.mobileInput = argv[++index];
    else if (value === "--meta") args.meta = argv[++index];
    else if (value === "--out") args.out = argv[++index];
    else if (value === "--mobile-out") args.mobileOut = argv[++index];
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

function dateKey(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value).slice(0, 10) : date.toISOString().slice(0, 10);
}

function shortDay(value) {
  const key = dateKey(value);
  if (!key) return "—";
  return new Date(`${key}T00:00:00.000Z`)
    .toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      timeZone: "UTC",
    })
    .toUpperCase();
}

function percentage(value) {
  return `${Math.round(number(value) * 100)}%`;
}

function repoShortName(repo) {
  const clean = String(repo || "").split("/").at(-1) || "";
  const labels = {
    openspine: "SPINE",
    open: "SPINE",
    spine: "SPINE",
    hologlyph: "HOLO",
    "cli-anything-meerk40t": "MEER",
    mag: "MAG",
    cairn: "CAIRN",
    "rive-rs-cli": "RIVE",
    "design-studio": "DESIGN",
    "growth-arsenal": "GROWTH",
    "george-rd": "PROFILE",
  };
  const normalized = clean.toLowerCase();
  if (labels[normalized]) return labels[normalized];
  const parts = clean.split(/[-_\s]+/).filter(Boolean);
  if (parts.length > 1) {
    return parts
      .map((part) => part[0])
      .join("")
      .slice(0, 6)
      .toUpperCase();
  }
  return clean.slice(0, 6).toUpperCase() || "—";
}

function quantile(values, q) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const base = Math.floor(position);
  const rest = position - base;
  return sorted[base + 1] === undefined
    ? sorted[base]
    : sorted[base] + rest * (sorted[base + 1] - sorted[base]);
}

function intensityScale(focus) {
  const positive = focus
    .map((day) => number(day.contributions))
    .filter((value) => value > 0);
  const thresholds = [
    0,
    quantile(positive, 0.2),
    quantile(positive, 0.45),
    quantile(positive, 0.7),
    quantile(positive, 0.9),
  ];
  return (value) => {
    const count = number(value);
    if (count <= 0) return 0;
    if (count <= Math.max(1, thresholds[1])) return 1;
    if (count <= Math.max(thresholds[1] + 1, thresholds[2])) return 2;
    if (count <= Math.max(thresholds[2] + 1, thresholds[3])) return 3;
    if (count <= Math.max(thresholds[3] + 1, thresholds[4])) return 4;
    return 5;
  };
}

function summarize(meta) {
  const focus = [...(meta?.focus || [])].sort((a, b) =>
    String(a.date).localeCompare(String(b.date)),
  );
  const generatedDate = dateKey(meta?.generatedAt) || dateKey(new Date());
  const elapsed = focus.filter((day) => dateKey(day.date) <= generatedDate);
  let streak = 0;
  for (let index = elapsed.length - 1; index >= 0; index -= 1) {
    if (number(elapsed[index].contributions) <= 0) break;
    streak += 1;
  }

  const activeDays = elapsed.filter((day) => number(day.contributions) > 0).length;
  const mergeDays = new Set(
    elapsed.filter((day) => day.event === "merge").map((day) => dateKey(day.date)),
  ).size;
  const topRepos = (meta?.metrics?.topRepos || []).map(repoShortName);

  return {
    focus,
    generatedDate,
    streak,
    activeDays,
    mergeDays: number(meta?.metrics?.mergeDays) || mergeDays,
    focusShare: number(meta?.metrics?.focusShare),
    topRepos,
  };
}

function eventGlyph(type, x, y, scale = 1) {
  if (type === "merge") {
    return `<g class="event" transform="translate(${x} ${y}) scale(${scale})"><circle cx="1" cy="1" r="1.8"/><circle cx="9" cy="1" r="1.8"/><circle cx="9" cy="9" r="1.8"/><path d="M1 3v3c0 2 2 3 4 3h2M9 3v4"/></g>`;
  }
  if (type === "review") {
    return `<g class="event" transform="translate(${x} ${y}) scale(${scale})"><rect x="0" y="1" width="11" height="8" rx="2"/><path d="M3 9v3l3-3"/></g>`;
  }
  if (type === "explore") {
    return `<g class="event" transform="translate(${x} ${y}) scale(${scale})"><circle cx="5" cy="5" r="4"/><path d="M8 8l4 4"/></g>`;
  }
  return "";
}

function familyBand(families, x, y, width, height) {
  const entries = [
    ["claude", number(families?.claude)],
    ["gpt", number(families?.gpt)],
    ["gemini", number(families?.gemini)],
    ["other", number(families?.other)],
  ].filter(([, value]) => value > 0);
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  if (!total) return "";
  let cursor = x;
  const segments = entries
    .map(([family, value], index) => {
      const remaining = x + width - cursor;
      const segmentWidth =
        index === entries.length - 1
          ? remaining
          : Math.max(2, (value / total) * width);
      const rect = `<rect class="family-${family}" x="${cursor.toFixed(1)}" y="${y.toFixed(1)}" width="${segmentWidth.toFixed(1)}" height="${height}"/>`;
      cursor += segmentWidth;
      return rect;
    })
    .join("");
  return `<g class="family-band" data-family-band="true">${segments}</g>`;
}

function renderGrid(summary, geometry) {
  const {
    x,
    y,
    labelWidth,
    cellWidth,
    cellHeight,
    gapX,
    gapY,
    bandHeight,
    mobile = false,
  } = geometry;
  const focus = summary.focus;
  const intensity = intensityScale(focus);
  const weekLabels = Array.from({ length: 4 }, (_, week) => {
    const day = focus[week * 7];
    const xx = x + labelWidth + week * (cellWidth + gapX);
    return `<text class="month" x="${(xx + 5).toFixed(1)}" y="${(y - 11).toFixed(1)}">${escapeXml(shortDay(day?.date))}</text>`;
  }).join("\n  ");
  const dayLabels = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]
    .map(
      (label, row) =>
        `<text class="day" x="${x}" y="${(
          y + row * (cellHeight + gapY) + cellHeight * 0.62
        ).toFixed(1)}">${label}</text>`,
    )
    .join("\n  ");

  const cells = focus
    .map((day, index) => {
      const week = Math.floor(index / 7);
      const row = index % 7;
      const cellX = x + labelWidth + week * (cellWidth + gapX);
      const cellY = y + row * (cellHeight + gapY);
      const future = dateKey(day.date) > summary.generatedDate;
      const level = future ? 0 : intensity(day.contributions);
      const fill = COLORS.intensity[level];
      const textColor = level >= 4 ? COLORS.paperSoft : COLORS.ink;
      const familyTotal = Object.values(day.modelFamilies || {}).reduce(
        (sum, value) => sum + number(value),
        0,
      );
      const repo = future
        ? ""
        : day.repository
          ? repoShortName(day.repository)
          : familyTotal > 0
            ? "TOOLS"
            : "—";
      const event = future
        ? ""
        : eventGlyph(
            day.event,
            cellX + cellWidth - (mobile ? 20 : 18),
            cellY + (mobile ? 12 : 7),
            mobile ? 0.9 : 0.75,
          );
      const band = future
        ? ""
        : familyBand(
            day.modelFamilies,
            cellX + 1,
            cellY + cellHeight - bandHeight - 1,
            cellWidth - 2,
            bandHeight,
          );
      const title = `${day.date} · ${number(day.contributions)} contributions${day.repository ? ` · ${day.repository}` : ""}${day.event ? ` · ${day.event}` : ""}`;
      const baseline = cellY + (mobile ? 22 : 15);
      return `<g class="profile-grid-day${future ? " future" : ""}" data-focus-day="${escapeXml(day.date)}"><rect class="lens-cell" x="${cellX.toFixed(1)}" y="${cellY.toFixed(1)}" width="${cellWidth}" height="${cellHeight}" rx="4" fill="${fill}"><title>${escapeXml(title)}</title></rect>${repo ? `<text class="repo" x="${(cellX + (mobile ? 8 : 7)).toFixed(1)}" y="${baseline.toFixed(1)}" style="fill:${textColor}">${escapeXml(repo)}</text>` : ""}${event}${band}</g>`;
    })
    .join("\n  ");

  return { weekLabels, dayLabels, cells };
}

function metricSvg(x, valueY, value, label, note = "") {
  return `<text class="profile-metric" x="${x}" y="${valueY}">${escapeXml(value)}</text>
  <text class="profile-metric-label" x="${x}" y="${valueY + 21}">${escapeXml(label)}</text>${note ? `\n  <text class="profile-metric-note" x="${x}" y="${valueY + 39}">${escapeXml(note)}</text>` : ""}`;
}

function additionalStyles() {
  return `
    .profile-divider{stroke:${COLORS.line};stroke-width:1}
    .profile-metric{fill:${COLORS.ink};font-family:"Arial Narrow","Avenir Next Condensed","Helvetica Neue",sans-serif;font-size:40px;font-weight:900}
    .profile-metric-label,.profile-metric-note{fill:${COLORS.inkSoft};font-family:ui-monospace,"SFMono-Regular",Consolas,monospace;font-weight:700;letter-spacing:1px}
    .profile-metric-label{font-size:10px}.profile-metric-note{font-size:9px}
    .profile-grid .repo{font-size:12px}.profile-grid .family-band{opacity:.96}.profile-grid-day.future{opacity:.3}
  `;
}

function injectStyles(svg) {
  if (svg.includes(".profile-metric{")) return svg;
  const closing = svg.lastIndexOf("</style>");
  if (closing < 0) throw new Error("Contribution lens SVG has no style block");
  return `${svg.slice(0, closing)}${additionalStyles()}${svg.slice(closing)}`;
}

function desktopDetail(summary) {
  const grid = renderGrid(summary, {
    x: 64,
    y: 314,
    labelWidth: 42,
    cellWidth: 166,
    cellHeight: 24,
    gapX: 8,
    gapY: 4,
    bandHeight: 7,
  });
  const topRepos = summary.topRepos.length ? summary.topRepos.join(" + ") : "—";
  return `  <g class="profile-grid">
  <text class="label" x="64" y="280">LATEST 4 WEEKS</text>
  ${grid.weekLabels}
  ${grid.dayLabels}
  ${grid.cells}
  </g>
  <line class="profile-divider" x1="852" y1="270" x2="852" y2="540"/>
  ${metricSvg(882, 310, String(summary.streak), "CURRENT STREAK", `${summary.activeDays} / 28 ACTIVE`)}
  <line class="profile-divider" x1="882" y1="363" x2="1136" y2="363"/>
  ${metricSvg(882, 396, String(summary.mergeDays), "MERGE DAYS", "LATEST 4 WEEKS")}
  <line class="profile-divider" x1="882" y1="446" x2="1136" y2="446"/>
  ${metricSvg(882, 477, percentage(summary.focusShare), "TOP 2 REPOS", topRepos)}
`;
}

function mobileStyles() {
  return `
    .profile-grid .repo{font-size:14px}.profile-metric{font-size:42px}.profile-metric-label{font-size:12px}.profile-metric-note{font-size:10px}
  `;
}

function injectMobileStyles(svg) {
  if (svg.includes(".profile-metric{")) {
    const closing = svg.lastIndexOf("</style>");
    return `${svg.slice(0, closing)}${mobileStyles()}${svg.slice(closing)}`;
  }
  const withBase = injectStyles(svg);
  const closing = withBase.lastIndexOf("</style>");
  return `${withBase.slice(0, closing)}${mobileStyles()}${withBase.slice(closing)}`;
}

function mobileDetail(summary) {
  const grid = renderGrid(summary, {
    x: 32,
    y: 316,
    labelWidth: 48,
    cellWidth: 133,
    cellHeight: 39,
    gapX: 7,
    gapY: 6,
    bandHeight: 11,
    mobile: true,
  });
  const topRepos = summary.topRepos.length ? summary.topRepos.join(" + ") : "—";
  return `  <g class="profile-grid">
  <text class="label" x="32" y="268">LATEST 4 WEEKS</text>
  ${grid.weekLabels}
  ${grid.dayLabels}
  ${grid.cells}
  </g>
  <line class="rule-strong" x1="32" y1="674" x2="688" y2="674"/>
  ${metricSvg(50, 732, String(summary.streak), "CURRENT STREAK", `${summary.activeDays} / 28 ACTIVE`)}
  ${metricSvg(260, 732, String(summary.mergeDays), "MERGE DAYS", "LATEST 4 WEEKS")}
  ${metricSvg(470, 732, percentage(summary.focusShare), "TOP 2 REPOS", topRepos)}
`;
}

function replaceBetween(svg, startMarker, endMarker, replacement) {
  const start = svg.indexOf(startMarker);
  const end = svg.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) {
    throw new Error(`Could not locate contribution lens detail markers: ${startMarker}`);
  }
  return `${svg.slice(0, start)}${replacement}${svg.slice(end)}`;
}

function refineDesktopSvg(svg, meta) {
  const summary = summarize(meta);
  const styled = injectStyles(svg);
  return replaceBetween(
    styled,
    '  <path class="connector"',
    '  <line class="rule-strong" x1="58" y1="560"',
    desktopDetail(summary),
  );
}

function refineMobileSvg(svg, meta) {
  const summary = summarize(meta);
  const styled = injectMobileStyles(svg);
  return replaceBetween(
    styled,
    '  <path class="connector"',
    '  <line class="rule" x1="32" y1="818"',
    mobileDetail(summary),
  );
}

function updateMeta(meta) {
  const summary = summarize(meta);
  return {
    ...meta,
    metrics: {
      ...(meta.metrics || {}),
      streak: summary.streak,
      activeDays: summary.activeDays,
      mergeDays: summary.mergeDays,
      topRepos: summary.topRepos,
    },
  };
}

async function ensureParent(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [desktopSource, mobileSource, metaSource] = await Promise.all([
    fs.readFile(args.input, "utf8"),
    fs.readFile(args.mobileInput, "utf8"),
    fs.readFile(args.meta, "utf8"),
  ]);
  const meta = JSON.parse(metaSource);
  const desktop = refineDesktopSvg(desktopSource, meta);
  const mobile = refineMobileSvg(mobileSource, meta);
  const refinedMeta = updateMeta(meta);

  await ensureParent(args.out);
  await fs.writeFile(args.out, desktop, "utf8");
  await ensureParent(args.mobileOut);
  await fs.writeFile(args.mobileOut, mobile, "utf8");
  await ensureParent(args.meta);
  await fs.writeFile(args.meta, `${JSON.stringify(refinedMeta, null, 2)}\n`, "utf8");
  console.log(
    `Refined contribution lens: ${refinedMeta.metrics.streak}-day streak, ${refinedMeta.metrics.activeDays}/28 active`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

export {
  refineDesktopSvg,
  refineMobileSvg,
  repoShortName,
  summarize,
  updateMeta,
};
