#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const STYLE_START = "/* repo-type-scale:start */";
const STYLE_END = "/* repo-type-scale:end */";

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

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function coordinate(value) {
  const rounded = Math.round(number(value) * 100) / 100;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

function decimal(value, places = 4) {
  const factor = 10 ** places;
  const rounded = Math.round(number(value) * factor) / factor;
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
  if (!key) return { weekday: "—", day: "—", month: "—" };
  const date = new Date(`${key}T00:00:00.000Z`);
  return {
    weekday: date
      .toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" })
      .toUpperCase(),
    day: date
      .toLocaleDateString("en-GB", { day: "2-digit", timeZone: "UTC" })
      .toUpperCase(),
    month: date
      .toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" })
      .toUpperCase(),
  };
}

function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
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

function repositoriesForDay(day) {
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

  if (!repositories.length && day?.repository) {
    repositories.push({
      name: day.repository,
      score: Math.max(1, number(day.contributions)),
      share: 1,
    });
  }

  const total = repositories.reduce(
    (sum, repository) => sum + repository.score,
    0,
  );
  return repositories.map((repository) => ({
    ...repository,
    share:
      repository.share > 0
        ? repository.share
        : total > 0
          ? repository.score / total
          : 0,
  }));
}

function aggregateHiddenRepositories(repositories, visibleCount = 3) {
  const hidden = repositories.slice(visibleCount);
  const score = hidden.reduce(
    (sum, repository) => sum + number(repository.score),
    0,
  );
  const share = hidden.reduce(
    (sum, repository) => sum + number(repository.share),
    0,
  );
  return {
    count: hidden.length,
    score,
    share,
    relative:
      hidden.length && number(repositories[0]?.score) > 0
        ? score / number(repositories[0].score)
        : 0,
  };
}

function widthConstrainedSize(
  label,
  desired,
  { min = 6, max = Infinity, maxWidth = Infinity, widthFactor = 0.6 },
) {
  const estimatedUnits = Math.max(1, String(label || "").length) * widthFactor;
  const widthCap = maxWidth / estimatedUnits;
  return (
    Math.round(Math.max(min, Math.min(desired, max, widthCap)) * 10) / 10
  );
}

function fontSizeForShare(
  label,
  share,
  { min, max, maxWidth = Infinity, widthFactor = 0.6 },
) {
  const desired = min + (max - min) * clamp(number(share), 0, 1);
  return widthConstrainedSize(label, desired, {
    min: 6,
    max,
    maxWidth,
    widthFactor,
  });
}

function fontSizeForRelativeScore(
  label,
  score,
  referenceScore,
  {
    min,
    max,
    maxWidth = Infinity,
    widthFactor = 0.6,
    exponent = 0.65,
  },
) {
  const relative =
    number(referenceScore) > 0
      ? clamp(number(score) / number(referenceScore), 0, 1)
      : 0;
  const desired = min + (max - min) * relative ** exponent;
  return widthConstrainedSize(label, desired, {
    min: 6,
    max,
    maxWidth,
    widthFactor,
  });
}

function textWidth(label, fontSize, widthFactor = 0.62) {
  return Math.max(1, String(label || "").length) * fontSize * widthFactor;
}

function repositoryEntry(repository, dominant, fieldWidth, mobile, order) {
  const label = repoShortName(repository.name);
  const dominantEntry = order === 0;
  const widthFactor = dominantEntry ? 0.76 : 0.72;
  const fontSize = dominantEntry
    ? fontSizeForShare(
        label,
        repository.share,
        mobile
          ? { min: 16, max: 23, maxWidth: fieldWidth, widthFactor }
          : { min: 17, max: 24, maxWidth: fieldWidth, widthFactor },
      )
    : fontSizeForRelativeScore(
        label,
        repository.score,
        dominant.score,
        mobile
          ? { min: 8, max: 18, maxWidth: fieldWidth, widthFactor }
          : { min: 8.5, max: 19.5, maxWidth: fieldWidth, widthFactor },
      );

  return {
    label,
    score: repository.score,
    share: repository.share,
    relative:
      number(dominant.score) > 0
        ? repository.score / dominant.score
        : 0,
    fontSize,
    width: textWidth(label, fontSize, widthFactor),
    className: dominantEntry ? "dominant-repo" : "secondary-repo",
    order,
  };
}

function aggregateEntry(
  repositories,
  visibleCount,
  dominant,
  fieldWidth,
  mobile,
  order,
) {
  const aggregate = aggregateHiddenRepositories(repositories, visibleCount);
  if (!aggregate.count) return null;
  const label = `+${aggregate.count} MORE`;
  const widthFactor = 0.72;
  const fontSize = fontSizeForRelativeScore(
    label,
    aggregate.score,
    dominant.score,
    mobile
      ? { min: 8, max: 18, maxWidth: fieldWidth, widthFactor }
      : { min: 8.5, max: 19.5, maxWidth: fieldWidth, widthFactor },
  );
  return {
    label,
    score: aggregate.score,
    share: aggregate.share,
    relative: aggregate.relative,
    fontSize,
    width: textWidth(label, fontSize, widthFactor),
    className: "repo-more",
    aggregateCount: aggregate.count,
    order,
  };
}

function packEntries(entries, { fieldWidth, rowBaselines, gap }) {
  const positions = [];
  let row = 0;
  let cursor = 0;

  for (const entry of entries) {
    const itemWidth = Math.min(fieldWidth, entry.width);
    const nextX = cursor > 0 ? cursor + gap : 0;
    if (cursor > 0 && nextX + itemWidth > fieldWidth) {
      row += 1;
      cursor = 0;
    }
    if (row >= rowBaselines.length) return null;

    const x = cursor > 0 ? cursor + gap : 0;
    positions.push({ ...entry, row, x, y: rowBaselines[row] });
    cursor = x + itemWidth;
  }

  return positions;
}

function layoutRepositoryFlow(repositories, fieldWidth, mobile, bandY) {
  if (!repositories.length) return { entries: [], hiddenCount: 0 };
  const dominant = repositories[0];
  const rowBaselines = mobile
    ? [bandY - 28, bandY - 7]
    : [bandY - 51, bandY - 29, bandY - 8];
  const gap = mobile ? 14 : 12;

  for (let visibleCount = repositories.length; visibleCount >= 1; visibleCount -= 1) {
    const visible = repositories
      .slice(0, visibleCount)
      .map((repository, index) =>
        repositoryEntry(repository, dominant, fieldWidth, mobile, index),
      );
    const aggregate = aggregateEntry(
      repositories,
      visibleCount,
      dominant,
      fieldWidth,
      mobile,
      visibleCount,
    );
    const entries = aggregate ? [...visible, aggregate] : visible;
    const packed = packEntries(entries, { fieldWidth, rowBaselines, gap });
    if (packed) {
      return {
        entries: packed,
        hiddenCount: aggregate?.aggregateCount || 0,
      };
    }
  }

  return {
    entries: packEntries(
      [repositoryEntry(dominant, dominant, fieldWidth, mobile, 0)],
      { fieldWidth, rowBaselines, gap },
    ) || [],
    hiddenCount: Math.max(0, repositories.length - 1),
  };
}

function textMarkup(entry, fieldX) {
  const aggregate =
    entry.aggregateCount === undefined
      ? ""
      : ` data-aggregate-count="${entry.aggregateCount}"`;
  return `<text class="${entry.className}" data-row="${entry.row}" data-order="${entry.order}" x="${coordinate(fieldX + entry.x)}" y="${coordinate(entry.y)}" data-score="${coordinate(entry.score)}" data-relative="${decimal(entry.relative)}" data-share="${decimal(entry.share)}"${aggregate} style="font-size:${coordinate(entry.fontSize)}px">${escapeXml(entry.label)}</text>`;
}

function dateRailMarkup(day, contributions, bandX, bandY, railWidth, mobile) {
  const { weekday, day: dayNumber, month } = dateParts(day.date);
  const weekdayY = bandY - (mobile ? 38 : 61);
  const dayY = bandY - (mobile ? 23 : 42);
  const monthY = bandY - (mobile ? 8 : 25);
  const countX = bandX + railWidth - (mobile ? 3 : 2);
  return `<g class="day-date-stack" aria-label="${escapeXml(`${weekday} ${dayNumber} ${month}; ${number(contributions)} contributions`)}"><text class="day-stack-weekday" x="${coordinate(bandX)}" y="${coordinate(weekdayY)}">${escapeXml(weekday)}</text><text class="day-stack-count" x="${coordinate(countX)}" y="${coordinate(weekdayY)}" text-anchor="end">${number(contributions)}</text><text class="day-stack-number" x="${coordinate(bandX)}" y="${coordinate(dayY)}">${escapeXml(dayNumber)}</text><text class="day-stack-month" x="${coordinate(bandX)}" y="${coordinate(monthY)}">${escapeXml(month)}</text></g>`;
}

function repositoryFlowMarkup(day, bandX, bandY, bandWidth, mobile) {
  const repositories = repositoriesForDay(day);
  const railWidth = mobile ? 46 : 31;
  const fieldX = bandX + railWidth;
  const fieldWidth = Math.max(40, bandWidth - railWidth - 2);

  if (!repositories.length) {
    return `<g class="repo-type-flow"><text class="repo-empty" x="${coordinate(fieldX)}" y="${coordinate(bandY - (mobile ? 20 : 36))}">NO REPO ACTIVITY</text></g>`;
  }

  const layout = layoutRepositoryFlow(repositories, fieldWidth, mobile, bandY);
  return `<g class="repo-type-flow" data-visible-repos="${repositories.length - layout.hiddenCount}" data-hidden-repos="${layout.hiddenCount}">${layout.entries.map((entry) => textMarkup(entry, fieldX)).join("")}</g>`;
}

function scaleDaySegment(segment, day, mobile) {
  const bandMatch = segment.match(
    /<rect class="model-band-(?:base|empty)" x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/,
  );
  if (!bandMatch) return segment;

  const [, bandXRaw, bandYRaw, bandWidthRaw] = bandMatch;
  const bandX = number(bandXRaw);
  const bandY = number(bandYRaw);
  const bandWidth = number(bandWidthRaw);
  const contributionMatch = segment.match(
    /<text class="day-contributions"[^>]*>([^<]*)<\/text>/,
  );
  const contributions = contributionMatch
    ? number(contributionMatch[1])
    : number(day.contributions);

  const cleaned = segment
    .replace(/<g class="day-date-stack"[\s\S]*?<\/g>/g, "")
    .replace(/<g class="repo-type-flow"[\s\S]*?<\/g>/g, "")
    .replace(/<g class="repo-type-field"[\s\S]*?<\/g>/g, "")
    .replace(/<g class="repo-type-block"[\s\S]*?<\/g>/g, "")
    .replace(/<text class="day-date"[^>]*>[^<]*<\/text>/g, "")
    .replace(/<text class="day-contributions"[^>]*>[^<]*<\/text>/g, "")
    .replace(/<text class="dominant-repo"[^>]*>[^<]*<\/text>/g, "")
    .replace(/<text class="secondary-repos"[^>]*>[^<]*<\/text>/g, "")
    .replace(/<text class="secondary-repo"[^>]*>[^<]*<\/text>/g, "")
    .replace(/<text class="secondary-separator"[^>]*>[^<]*<\/text>/g, "")
    .replace(/<text class="repo-more"[^>]*>[^<]*<\/text>/g, "")
    .replace(/<text class="repo-empty"[^>]*>[^<]*<\/text>/g, "");

  const markup = `${dateRailMarkup(day, contributions, bandX, bandY, mobile ? 46 : 31, mobile)}${repositoryFlowMarkup(day, bandX, bandY, bandWidth, mobile)}`;
  const modelBandIndex = cleaned.indexOf('<g class="model-band"');
  if (modelBandIndex < 0) return cleaned;
  return `${cleaned.slice(0, modelBandIndex)}${markup}${cleaned.slice(modelBandIndex)}`;
}

function injectStyles(svg) {
  const escapedStart = STYLE_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedEnd = STYLE_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const cleaned = svg.replace(
    new RegExp(`\\s*${escapedStart}[\\s\\S]*?${escapedEnd}\\s*`, "g"),
    "",
  );
  const closing = cleaned.lastIndexOf("</style>");
  if (closing < 0) throw new Error("Contribution lens SVG has no style block");
  const styles = `
    ${STYLE_START}
    .day-date-stack text,.secondary-repo,.repo-more{font-family:ui-monospace,"SFMono-Regular",Consolas,monospace;font-weight:850;letter-spacing:.25px}
    .day-stack-weekday,.day-stack-month,.day-stack-count{fill:#40534e}.day-stack-weekday,.day-stack-month{font-size:7.5px}.day-stack-count{font-size:7px;font-weight:750}.day-stack-number{fill:#10231f;font-size:13px;font-weight:900}
    .secondary-repo,.repo-more{fill:#40534e}.repo-more{font-weight:850}.repo-empty{fill:#40534e;font-family:ui-monospace,"SFMono-Regular",Consolas,monospace;font-size:8px;font-weight:750;letter-spacing:.4px}
    ${STYLE_END}
  `;
  return `${cleaned.slice(0, closing)}${styles}${cleaned.slice(closing)}`;
}

function scaleSvg(svg, meta, { mobile = false } = {}) {
  const daysByDate = new Map(
    (meta?.focus || []).map((day) => [dateKey(day.date), day]),
  );
  const starts = [
    ...svg.matchAll(/<g class="recent-day" data-recent-day="([^"]+)">/g),
  ];
  let output = svg;

  for (let index = starts.length - 1; index >= 0; index -= 1) {
    const start = starts[index].index;
    const end =
      index + 1 < starts.length
        ? starts[index + 1].index
        : output.indexOf("  </g>\n  <!-- profile-detail:end -->", start);
    if (end < 0) continue;
    const date = dateKey(starts[index][1]);
    const day = daysByDate.get(date);
    if (!day) continue;
    const segment = output.slice(start, end);
    const scaled = scaleDaySegment(segment, day, mobile);
    output = `${output.slice(0, start)}${scaled}${output.slice(end)}`;
  }

  return injectStyles(output)
    .replaceAll(
      "REPOS RANKED BY GITHUB ACTIVITY",
      "DATE RAIL · TYPE SIZE = SHARE WITHIN DAY",
    )
    .replaceAll(
      "REPO TYPE SIZE = SHARE WITHIN EACH DAY",
      "DATE RAIL · TYPE SIZE = SHARE WITHIN DAY",
    )
    .replaceAll(
      "DATE STACK · REPO TYPE = SHARE WITHIN DAY",
      "DATE RAIL · TYPE SIZE = SHARE WITHIN DAY",
    )
    .replaceAll(
      "TYPE WEIGHT = REPO RANK · RULE LENGTH = GITHUB ACTIVITY",
      "LEFT FLOW · +N ONLY WHEN SPACE RUNS OUT · RULE = ACTIVITY",
    )
    .replaceAll(
      "TYPE = REPO RANK · RULE LENGTH = GITHUB ACTIVITY",
      "LEFT FLOW · +N ONLY WHEN SPACE RUNS OUT · RULE = ACTIVITY",
    )
    .replaceAll(
      "TYPE SIZE = REPO SHARE WITHIN DAY · RULE LENGTH = GITHUB ACTIVITY",
      "LEFT FLOW · +N ONLY WHEN SPACE RUNS OUT · RULE = ACTIVITY",
    )
    .replaceAll(
      "TYPE SIZE = REPO SHARE WITHIN DAY · RULE = GITHUB ACTIVITY",
      "LEFT FLOW · +N ONLY WHEN SPACE RUNS OUT · RULE = ACTIVITY",
    )
    .replaceAll(
      "TYPE SIZE = SHARE · +N = HIDDEN SHARE · RULE = ACTIVITY",
      "LEFT FLOW · +N ONLY WHEN SPACE RUNS OUT · RULE = ACTIVITY",
    )
    .replaceAll(
      "2×2 TYPE FIELD · +N = HIDDEN SHARE · RULE = ACTIVITY",
      "LEFT FLOW · +N ONLY WHEN SPACE RUNS OUT · RULE = ACTIVITY",
    );
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
  const desktop = scaleSvg(desktopSource, meta);
  const mobile = scaleSvg(mobileSource, meta, { mobile: true });

  await ensureParent(args.out);
  await fs.writeFile(args.out, desktop, "utf8");
  await ensureParent(args.mobileOut);
  await fs.writeFile(args.mobileOut, mobile, "utf8");
  console.log("Flowed repository type left-to-right and only aggregated overflow.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

export {
  aggregateHiddenRepositories,
  fontSizeForRelativeScore,
  fontSizeForShare,
  layoutRepositoryFlow,
  repositoriesForDay,
  scaleSvg,
};
