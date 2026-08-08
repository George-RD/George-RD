#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DISPLAY_DAYS = 14;
const COLORS = {
  paper: "#f1ede4",
  paperDeep: "#e4ded1",
  paperSoft: "#f7f4ed",
  ink: "#10231f",
  inkSoft: "#40534e",
  line: "#b9b2a5",
  rust: "#c9482b",
  blue: "#4b7fa0",
  gold: "#d5a72c",
  sage: "#8b9d83",
};

const DETAIL_START = "<!-- profile-detail:start -->";
const DETAIL_END = "<!-- profile-detail:end -->";
const STYLE_START = "/* profile-refinement:start */";
const STYLE_END = "/* profile-refinement:end */";

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

function coordinate(value) {
  const rounded = Math.round(number(value) * 100) / 100;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

function dateKey(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value).slice(0, 10)
    : date.toISOString().slice(0, 10);
}

function dateParts(value) {
  const key = dateKey(value);
  if (!key) return { weekday: "—", dayMonth: "—" };
  const date = new Date(`${key}T00:00:00.000Z`);
  return {
    weekday: date
      .toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" })
      .toUpperCase(),
    dayMonth: date
      .toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        timeZone: "UTC",
      })
      .toUpperCase(),
  };
}

function percentage(value) {
  return `${Math.round(number(value) * 100)}%`;
}

function repoShortName(repo) {
  const clean = String(repo || "").split("/").at(-1) || "";
  const labels = {
    private: "PRIV",
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

function repositoryActivity(day) {
  const repositories = Array.isArray(day?.repositories)
    ? day.repositories
        .map((repository) => ({
          name: repository?.name || "repository",
          score: number(repository?.score),
          share: number(repository?.share),
        }))
        .filter((repository) => repository.score > 0)
        .sort(
          (left, right) =>
            right.score - left.score || left.name.localeCompare(right.name),
        )
    : [];

  if (repositories.length) return repositories;
  if (!day?.repository) return [];
  return [
    {
      name: day.repository,
      score: Math.max(1, number(day.contributions)),
      share: 1,
    },
  ];
}

function summarize(meta) {
  const focus = [...(meta?.focus || [])].sort((left, right) =>
    String(left.date).localeCompare(String(right.date)),
  );
  const generatedDate = dateKey(meta?.generatedAt) || dateKey(new Date());
  const elapsed = focus.filter((day) => dateKey(day.date) <= generatedDate);
  const recent = elapsed.slice(-DISPLAY_DAYS);

  let streak = 0;
  for (let index = elapsed.length - 1; index >= 0; index -= 1) {
    if (number(elapsed[index].contributions) <= 0) break;
    streak += 1;
  }

  const repoTotals = new Map();
  for (const day of recent) {
    for (const repository of repositoryActivity(day)) {
      repoTotals.set(
        repository.name,
        number(repoTotals.get(repository.name)) + repository.score,
      );
    }
  }
  const sortedRepos = [...repoTotals.entries()].sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
  );
  const repoTotal = sortedRepos.reduce((sum, [, score]) => sum + score, 0);
  const topTwoTotal = sortedRepos
    .slice(0, 2)
    .reduce((sum, [, score]) => sum + score, 0);

  return {
    focus,
    recent,
    generatedDate,
    streak,
    activeDays: recent.filter((day) => number(day.contributions) > 0).length,
    focusShare: repoTotal ? topTwoTotal / repoTotal : 0,
    topRepos: sortedRepos.slice(0, 2).map(([name]) => repoShortName(name)),
    maxContributions: Math.max(
      1,
      ...recent.map((day) => number(day.contributions)),
    ),
  };
}

function familyEntries(families) {
  return [
    ["claude", number(families?.claude)],
    ["gpt", number(families?.gpt)],
    ["gemini", number(families?.gemini)],
    ["other", number(families?.other)],
  ].filter(([, value]) => value > 0);
}

function modelBand(families, { x, y, width, height }) {
  const entries = familyEntries(families);
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  if (!total) {
    return `<g class="model-band" data-model-band="day"><rect class="model-band-empty" x="${coordinate(x)}" y="${coordinate(y)}" width="${coordinate(width)}" height="${coordinate(height)}"/><path class="model-band-empty-mark" d="M${coordinate(x + width / 2 - 8)} ${coordinate(y + height / 2)}h16"/></g>`;
  }

  let cumulative = 0;
  const segments = entries
    .map(([family, value], index) => {
      const segmentX = x + (cumulative / total) * width;
      cumulative += value;
      const segmentEnd =
        index === entries.length - 1
          ? x + width
          : x + (cumulative / total) * width;
      return `<rect class="family-${family}" x="${coordinate(segmentX)}" y="${coordinate(y)}" width="${coordinate(segmentEnd - segmentX)}" height="${coordinate(height)}"/>`;
    })
    .join("");

  return `<g class="model-band" data-model-band="day"><rect class="model-band-base" x="${coordinate(x)}" y="${coordinate(y)}" width="${coordinate(width)}" height="${coordinate(height)}"/>${segments}</g>`;
}

function dayTitle(day) {
  const repositories = repositoryActivity(day)
    .map((repository) => `${repository.name} ${percentage(repository.share)}`)
    .join(", ");
  const models = familyEntries(day.modelFamilies)
    .map(([family, value]) => `${family} ${value}`)
    .join(", ");
  return `${day.date} · ${number(day.contributions)} GitHub contributions${repositories ? ` · repositories: ${repositories}` : ""}${models ? ` · tracked AI: ${models}` : " · no tracked AI data"}`;
}

function renderRepositoryText(day, layout, x, y) {
  const repositories = repositoryActivity(day);
  const dominant = repositories[0];
  const secondary = repositories.slice(1, 3);
  const extra = Math.max(0, repositories.length - 3);

  if (!dominant) {
    return `<text class="repo-empty" x="${coordinate(x + layout.repoX)}" y="${coordinate(y + layout.dominantY)}">NO REPO ACTIVITY</text>`;
  }

  const secondaryLabels = secondary.map((repository) =>
    repoShortName(repository.name),
  );
  if (layout.mobile && extra > 0) secondaryLabels.push(`+${extra} MORE`);
  const secondaryText = secondaryLabels.join(" · ");
  const extraMarkup =
    !layout.mobile && extra > 0
      ? `<text class="repo-more" x="${coordinate(x + layout.repoX)}" y="${coordinate(y + layout.moreY)}">+${extra} MORE</text>`
      : "";

  return `<text class="dominant-repo" x="${coordinate(x + layout.repoX)}" y="${coordinate(y + layout.dominantY)}">${escapeXml(repoShortName(dominant.name))}</text>${secondaryText ? `<text class="secondary-repos" x="${coordinate(x + layout.repoX)}" y="${coordinate(y + layout.secondaryY)}">${escapeXml(secondaryText)}</text>` : ""}${extraMarkup}`;
}

function renderDay(day, index, summary, layout) {
  const column = index % layout.columns;
  const row = Math.floor(index / layout.columns);
  const x = layout.x + column * (layout.columnWidth + layout.gapX);
  const y = layout.y + row * (layout.rowHeight + layout.gapY);
  const { weekday, dayMonth } = dateParts(day.date);
  const activityRatio = Math.max(
    0,
    Math.min(1, number(day.contributions) / summary.maxContributions),
  );
  const fillEnd = x + layout.columnWidth * activityRatio;
  const divider =
    column > 0
      ? `<line class="day-divider" x1="${coordinate(x - layout.gapX / 2)}" y1="${coordinate(y - 3)}" x2="${coordinate(x - layout.gapX / 2)}" y2="${coordinate(y + layout.activityY)}"/>`
      : "";
  const dateLabel = `${weekday} ${dayMonth}`;

  return `<g class="recent-day" data-recent-day="${escapeXml(day.date)}"><title>${escapeXml(dayTitle(day))}</title>${divider}<text class="day-date" x="${coordinate(x)}" y="${coordinate(y + layout.dateY)}">${escapeXml(dateLabel)}</text><text class="day-contributions" x="${coordinate(x + layout.columnWidth)}" y="${coordinate(y + layout.dateY)}" text-anchor="end">${number(day.contributions)}</text>${renderRepositoryText(day, layout, x, y)}${modelBand(day.modelFamilies, { x, y: y + layout.bandY, width: layout.columnWidth, height: layout.bandHeight })}<line class="activity-track" x1="${coordinate(x)}" y1="${coordinate(y + layout.activityY)}" x2="${coordinate(x + layout.columnWidth)}" y2="${coordinate(y + layout.activityY)}"/><line class="activity-fill" x1="${coordinate(x)}" y1="${coordinate(y + layout.activityY)}" x2="${coordinate(fillEnd)}" y2="${coordinate(y + layout.activityY)}"/></g>`;
}

function renderGrid(summary, layout) {
  return summary.recent
    .map((day, index) => renderDay(day, index, summary, layout))
    .join("\n  ");
}

function profileStyles({ mobile = false } = {}) {
  return `
    ${STYLE_START}
    .day-date,.day-contributions,.recent-summary,.recent-help,.secondary-repos,.repo-more,.repo-empty{font-family:ui-monospace,"SFMono-Regular",Consolas,monospace;font-weight:750;letter-spacing:.5px}
    .day-date{fill:${COLORS.ink};font-size:9.5px}.day-contributions{fill:${COLORS.inkSoft};font-size:9.5px}
    .dominant-repo{fill:${COLORS.ink};font-family:"Arial Narrow","Avenir Next Condensed","Helvetica Neue",sans-serif;font-size:19px;font-weight:900;letter-spacing:-.2px}
    .secondary-repos{fill:${COLORS.inkSoft};font-size:8.5px}.repo-more{fill:${COLORS.inkSoft};font-size:7.5px}.repo-empty{fill:${COLORS.inkSoft};font-size:8px}
    .recent-summary{fill:${COLORS.ink};font-size:10px}.recent-help{fill:${COLORS.inkSoft};font-size:8.5px;letter-spacing:.45px}
    .day-divider{stroke:${COLORS.line};stroke-width:1}
    .activity-track{stroke:${COLORS.line};stroke-width:1}.activity-fill{stroke:${COLORS.ink};stroke-width:2;stroke-linecap:butt}
    .model-band-base,.model-band-empty{fill:${COLORS.paperDeep}}.model-band-empty-mark{fill:none;stroke:${COLORS.line};stroke-width:1.2;stroke-linecap:round}
    .family-claude{fill:${COLORS.rust}}.family-gpt{fill:${COLORS.blue}}.family-gemini{fill:${COLORS.gold}}.family-other{fill:${COLORS.sage}}
    .recent-selection{pointer-events:none}.selection-segment{fill:none;stroke:${COLORS.ink};stroke-width:1.8;rx:4}
    .footer-label,.footer-note{fill:${COLORS.inkSoft};font-family:ui-monospace,"SFMono-Regular",Consolas,monospace;font-weight:700;letter-spacing:.7px}.footer-label{font-size:9px}.footer-note{font-size:8px}
    ${mobile ? `.day-date{font-size:10px}.day-contributions{font-size:10px}.dominant-repo{font-size:17px}.secondary-repos{font-size:8px}.repo-more{font-size:7px}.repo-empty{font-size:8px}.recent-summary{font-size:10px}.recent-help{font-size:8px}.footer-label{font-size:10px}.footer-note{font-size:9px}` : ""}
    ${STYLE_END}
  `;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function injectStyles(svg, options) {
  const stylePattern = new RegExp(
    `\\s*${escapeRegExp(STYLE_START)}[\\s\\S]*?${escapeRegExp(STYLE_END)}\\s*`,
    "g",
  );
  const cleaned = svg.replace(stylePattern, "");
  const closing = cleaned.lastIndexOf("</style>");
  if (closing < 0) throw new Error("Contribution lens SVG has no style block");
  return `${cleaned.slice(0, closing)}${profileStyles(options)}${cleaned.slice(closing)}`;
}

function updateHeader(svg, mobile = false) {
  return svg
    .replaceAll("365 DAYS / LATEST 4 WEEKS", "365 DAYS / LATEST 14 DAYS")
    .replaceAll("latest four weeks", "latest 14 days")
    .replaceAll(
      "the latest four weeks enlarged to show repository focus, model-family mix and merge activity",
      "the latest 14 days enlarged to show daily repository ranking and tracked model-family mix",
    )
    .replaceAll(
      "the latest 14 days enlarged to show daily repository shares and tracked model-family mix",
      "the latest 14 days enlarged to show daily repository ranking and tracked model-family mix",
    )
    .replaceAll(
      "a year overview, the latest 14 days and three focus metrics",
      "a year overview and the latest 14 days with daily repository ranking and tracked model mix",
    )
    .replaceAll(
      "a year overview, the latest four weeks and three focus metrics",
      "a year overview and the latest 14 days with daily repository ranking and tracked model mix",
    )
    .replace(
      /<desc id="desc">[^<]*<\/desc>/,
      `<desc id="desc">${mobile ? "A mobile contribution lens with a year overview and the latest 14 days showing daily repository ranking and tracked model mix." : "A contribution lens with a year overview and the latest 14 days showing daily repository ranking and tracked model mix."}</desc>`,
    );
}

function selectionSegments(svg, dates) {
  const selected = new Set(dates.map(dateKey));
  const groups = new Map();
  const cellPattern = /<rect class="overview-cell" data-day="([^"]+)" x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"[^>]*>/g;
  for (const match of svg.matchAll(cellPattern)) {
    const [, date, xRaw, yRaw, widthRaw, heightRaw] = match;
    if (!selected.has(dateKey(date))) continue;
    const x = number(xRaw);
    const y = number(yRaw);
    const width = number(widthRaw);
    const height = number(heightRaw);
    const key = coordinate(x);
    const group = groups.get(key) || {
      x,
      minY: y,
      maxY: y + height,
      width,
    };
    group.minY = Math.min(group.minY, y);
    group.maxY = Math.max(group.maxY, y + height);
    group.width = Math.max(group.width, width);
    groups.set(key, group);
  }

  return [...groups.values()]
    .sort((left, right) => left.x - right.x)
    .map(
      (group) =>
        `<rect class="selection-segment" x="${coordinate(group.x - 3)}" y="${coordinate(group.minY - 3)}" width="${coordinate(group.width + 6)}" height="${coordinate(group.maxY - group.minY + 6)}" rx="4"/>`,
    )
    .join("");
}

function updateOverviewSelection(svg, dates) {
  const segments = selectionSegments(svg, dates);
  const group = `  <g class="recent-selection" aria-hidden="true">${segments}</g>`;
  const existingGroup = /\s*<g class="recent-selection"[\s\S]*?<\/g>\s*/;
  if (existingGroup.test(svg)) return svg.replace(existingGroup, `\n${group}\n`);
  const existingSelection = /\s*<rect class="selection"[^>]*\/>\s*/;
  if (existingSelection.test(svg)) {
    return svg.replace(existingSelection, `\n${group}\n`);
  }

  const markerIndex = svg.indexOf(DETAIL_START);
  const connectorIndex = svg.indexOf('<path class="connector"');
  const insertAt = markerIndex >= 0 ? markerIndex : connectorIndex;
  if (insertAt < 0) return svg;
  const lineStart = svg.lastIndexOf("\n", insertAt) + 1;
  return `${svg.slice(0, lineStart)}${group}\n${svg.slice(lineStart)}`;
}

function desktopDetail(summary) {
  const layout = {
    x: 58,
    y: 303,
    columns: 7,
    columnWidth: (1084 - 6 * 11) / 7,
    rowHeight: 103,
    gapX: 11,
    gapY: 17,
    dateY: 10,
    repoX: 0,
    dominantY: 47,
    secondaryY: 69,
    moreY: 83,
    bandY: 88,
    bandHeight: 7,
    activityY: 103,
    mobile: false,
  };
  return `  <g class="recent-grid">
  <text class="label" x="58" y="272">LATEST 14 DAYS</text>
  <text class="recent-summary" x="1142" y="272" text-anchor="end">${summary.activeDays} / 14 ACTIVE · ${summary.streak}-DAY STREAK</text>
  <text class="recent-help" x="58" y="290">REPOS RANKED BY GITHUB ACTIVITY</text>
  <text class="recent-help" x="1142" y="290" text-anchor="end">LOWER BAND = WHOLE-DAY TOKSCALE MIX</text>
  ${renderGrid(summary, layout)}
  </g>
`;
}

function mobileDetail(summary) {
  const layout = {
    x: 32,
    y: 292,
    columns: 2,
    columnWidth: 322,
    rowHeight: 66,
    gapX: 12,
    gapY: 8,
    dateY: 13,
    repoX: 82,
    dominantY: 28,
    secondaryY: 45,
    moreY: 56,
    bandY: 54,
    bandHeight: 7,
    activityY: 66,
    mobile: true,
  };
  return `  <g class="recent-grid">
  <text class="label" x="32" y="258">LATEST 14 DAYS</text>
  <text class="recent-summary" x="688" y="258" text-anchor="end">${summary.activeDays} / 14 ACTIVE · ${summary.streak}-DAY STREAK</text>
  <text class="recent-help" x="32" y="278">REPOS RANKED BY GITHUB ACTIVITY</text>
  <text class="recent-help" x="688" y="278" text-anchor="end">LOWER BAND = WHOLE-DAY TOKSCALE MIX</text>
  ${renderGrid(summary, layout)}
  </g>
`;
}

function desktopFooter() {
  return `  <line class="rule-strong" x1="58" y1="560" x2="1142" y2="560"/>
  <text class="footer-note" x="58" y="584">TYPE WEIGHT = REPO RANK · RULE LENGTH = GITHUB ACTIVITY</text>
  <circle cx="465" cy="580" r="4" fill="${COLORS.rust}"/><text class="footer-label" x="478" y="584">CLAUDE</text>
  <circle cx="595" cy="580" r="4" fill="${COLORS.blue}"/><text class="footer-label" x="608" y="584">GPT</text>
  <circle cx="695" cy="580" r="4" fill="${COLORS.gold}"/><text class="footer-label" x="708" y="584">GEMINI</text>
  <circle cx="825" cy="580" r="4" fill="${COLORS.sage}"/><text class="footer-label" x="838" y="584">OTHER</text>
  <text class="footer-note" x="1142" y="584" text-anchor="end">COLOURS = TRACKED AI USE FOR WHOLE DAY</text>`;
}

function mobileFooter() {
  return `  <line class="rule" x1="32" y1="818" x2="688" y2="818"/>
  <text class="footer-note" x="32" y="846">TYPE = REPO RANK · RULE LENGTH = GITHUB ACTIVITY</text>
  <circle cx="42" cy="878" r="5" fill="${COLORS.rust}"/><text class="footer-label" x="57" y="882">CLAUDE</text>
  <circle cx="188" cy="878" r="5" fill="${COLORS.blue}"/><text class="footer-label" x="203" y="882">GPT</text>
  <circle cx="292" cy="878" r="5" fill="${COLORS.gold}"/><text class="footer-label" x="307" y="882">GEMINI</text>
  <circle cx="444" cy="878" r="5" fill="${COLORS.sage}"/><text class="footer-label" x="459" y="882">OTHER</text>
  <text class="footer-note" x="688" y="882" text-anchor="end">WHOLE-DAY AI MIX</text>`;
}

function wrapDetail(replacement) {
  return `  ${DETAIL_START}\n${replacement}  ${DETAIL_END}\n`;
}

function replaceDetailAndFooter(svg, detail, footer) {
  const existingStart = svg.indexOf(DETAIL_START);
  const connectorStart = svg.indexOf('<path class="connector"');
  const start = existingStart >= 0 ? existingStart : connectorStart;
  if (start < 0) throw new Error("Could not locate contribution lens detail region");
  const lineStart = svg.lastIndexOf("\n", start) + 1;
  return `${svg.slice(0, lineStart)}${wrapDetail(detail)}${footer}\n</svg>\n`;
}

function refineDesktopSvg(svg, meta) {
  const summary = summarize(meta);
  const styled = injectStyles(updateHeader(svg, false));
  const selected = updateOverviewSelection(
    styled,
    summary.recent.map((day) => day.date),
  );
  return replaceDetailAndFooter(
    selected,
    desktopDetail(summary),
    desktopFooter(),
  );
}

function refineMobileSvg(svg, meta) {
  const summary = summarize(meta);
  const styled = injectStyles(updateHeader(svg, true), { mobile: true });
  const selected = updateOverviewSelection(
    styled,
    summary.recent.map((day) => day.date),
  );
  return replaceDetailAndFooter(selected, mobileDetail(summary), mobileFooter());
}

function updateMeta(meta) {
  const summary = summarize(meta);
  const { mergeDays: _mergeDays, ...existingMetrics } = meta?.metrics || {};
  return {
    ...meta,
    range: {
      ...(meta?.range || {}),
      focusStart: summary.recent[0]?.date || meta?.range?.focusStart || "",
      focusEnd: summary.recent.at(-1)?.date || meta?.range?.focusEnd || "",
    },
    metrics: {
      ...existingMetrics,
      focusDays: DISPLAY_DAYS,
      streak: summary.streak,
      activeDays: summary.activeDays,
      focusShare: summary.focusShare,
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
    `Refined contribution lens: ${refinedMeta.metrics.activeDays}/${DISPLAY_DAYS} active, ${refinedMeta.metrics.streak}-day streak.`,
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
