#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const STYLE_START = "/* repo-golden-field:start */";
const STYLE_END = "/* repo-golden-field:end */";
const PHI = (1 + Math.sqrt(5)) / 2;
const INV_PHI = 1 / PHI;
const INV_PHI_SQ = 1 - INV_PHI;

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
      .toLocaleDateString("en-GB", {
        weekday: "short",
        timeZone: "UTC",
      })
      .toUpperCase(),
    day: date
      .toLocaleDateString("en-GB", { day: "2-digit", timeZone: "UTC" })
      .toUpperCase(),
    month: date
      .toLocaleDateString("en-GB", {
        month: "short",
        timeZone: "UTC",
      })
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

function aggregateHiddenRepositories(repositories, visibleCount) {
  const hidden = repositories.slice(visibleCount);
  const score = hidden.reduce(
    (sum, repository) => sum + repository.score,
    0,
  );
  const share = hidden.reduce(
    (sum, repository) => sum + repository.share,
    0,
  );
  return {
    count: hidden.length,
    score,
    share,
    relative:
      hidden.length && repositories[0]?.score > 0
        ? score / repositories[0].score
        : 0,
  };
}

function widthConstrainedSize(
  label,
  desired,
  {
    min = 6,
    max = Infinity,
    maxWidth = Infinity,
    widthFactor = 0.69,
  },
) {
  const widthCap =
    maxWidth /
    (Math.max(1, String(label || "").length) * widthFactor);
  return Math.round(Math.max(min, Math.min(desired, max, widthCap)) * 10) / 10;
}

function fontSizeForShare(label, share, config) {
  const desired = config.min + (config.max - config.min) * clamp(share, 0, 1);
  return widthConstrainedSize(label, desired, config);
}

function fontSizeForRelativeScore(label, score, referenceScore, config) {
  const relative =
    referenceScore > 0 ? clamp(score / referenceScore, 0, 1) : 0;
  const exponent = config.exponent ?? 0.62;
  const desired = config.min + (config.max - config.min) * relative ** exponent;
  return widthConstrainedSize(label, desired, config);
}

function textWidth(label, fontSize, widthFactor = 0.69) {
  return Math.max(1, String(label || "").length) * fontSize * widthFactor;
}

function entryForRepository(repository, dominant, fieldWidth, mobile, order) {
  const label = repoShortName(repository.name);
  const dominantEntry = order === 0;
  const widthFactor = dominantEntry ? 0.72 : 0.69;
  const fontSize = dominantEntry
    ? fontSizeForShare(
        label,
        repository.share,
        mobile
          ? {
              min: 16,
              max: 23,
              maxWidth: fieldWidth,
              widthFactor,
            }
          : {
              min: 17,
              max: 25,
              maxWidth: fieldWidth,
              widthFactor,
            },
      )
    : fontSizeForRelativeScore(
        label,
        repository.score,
        dominant.score,
        mobile
          ? {
              min: 8,
              max: 17,
              maxWidth: fieldWidth,
              widthFactor,
            }
          : {
              min: 8.5,
              max: 19,
              maxWidth: fieldWidth,
              widthFactor,
            },
      );

  return {
    label,
    score: repository.score,
    share: repository.share,
    relative: dominant.score > 0 ? repository.score / dominant.score : 0,
    fontSize,
    width: textWidth(label, fontSize, widthFactor),
    height: fontSize * 1.05,
    className: dominantEntry ? "dominant-repo" : "secondary-repo",
    order,
  };
}

function entryForAggregate(
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
  const widthFactor = 0.69;
  const fontSize = fontSizeForRelativeScore(
    label,
    aggregate.score,
    dominant.score,
    mobile
      ? {
          min: 8,
          max: 17,
          maxWidth: fieldWidth,
          widthFactor,
        }
      : {
          min: 8.5,
          max: 19,
          maxWidth: fieldWidth,
          widthFactor,
        },
  );
  return {
    label,
    score: aggregate.score,
    share: aggregate.share,
    relative: aggregate.relative,
    fontSize,
    width: textWidth(label, fontSize, widthFactor),
    height: fontSize * 1.05,
    className: "repo-more",
    aggregateCount: aggregate.count,
    order,
  };
}

const GOLDEN_ANCHORS = [
  { x: 0.02, y: INV_PHI },
  { x: 0.8, y: 0.16 },
  { x: INV_PHI_SQ, y: 0.95 },
  { x: 0, y: 0.16 },
  { x: 0.8, y: 0.82 },
  { x: 0.54, y: 0.52 },
  { x: 0.02, y: 0.92 },
  { x: 0.88, y: 0.48 },
];

function anchorsForCount(count, mobile) {
  if (count <= 1) {
    return [{ x: INV_PHI_SQ, y: mobile ? 0.62 : 0.6 }];
  }
  if (count === 2) {
    return [
      { x: 0.02, y: 0.68 },
      { x: 0.8, y: 0.2 },
    ];
  }
  if (count === 3) {
    return [
      { x: 0.02, y: 0.62 },
      { x: 0.8, y: 0.16 },
      { x: INV_PHI_SQ, y: 0.94 },
    ];
  }
  return GOLDEN_ANCHORS;
}

function boundingBox(entry, x, baselineY) {
  return {
    left: x,
    right: x + entry.width,
    top: baselineY - entry.fontSize * 0.82,
    bottom: baselineY + entry.fontSize * 0.23,
  };
}

function boxesOverlap(left, right, margin) {
  return !(
    left.right + margin <= right.left ||
    right.right + margin <= left.left ||
    left.bottom + margin <= right.top ||
    right.bottom + margin <= left.top
  );
}

function candidatePositions(
  entry,
  order,
  count,
  fieldWidth,
  fieldTop,
  fieldHeight,
  mobile,
) {
  const anchors = anchorsForCount(count, mobile);
  const anchor =
    anchors[order % anchors.length] ||
    GOLDEN_ANCHORS[order % GOLDEN_ANCHORS.length];
  const offsets = [
    [0, 0],
    [-0.08, 0],
    [0.08, 0],
    [0, -0.12],
    [0, 0.12],
    [-0.06, -0.1],
    [0.06, 0.1],
    [0.12, -0.08],
    [-0.12, 0.08],
  ];
  return offsets.map(([dx, dy]) => {
    const xNorm = clamp(anchor.x + dx, 0, 1);
    const yNorm = clamp(anchor.y + dy, 0.08, 0.96);
    const x = Math.max(
      0,
      Math.min(
        fieldWidth - entry.width,
        xNorm * Math.max(0, fieldWidth - entry.width),
      ),
    );
    const baselineY = fieldTop + yNorm * fieldHeight;
    return { x, y: baselineY };
  });
}

function placeEntries(entries, { fieldWidth, fieldTop, fieldHeight, mobile }) {
  const placed = [];
  const margin = mobile ? 2.5 : 3;

  for (let order = 0; order < entries.length; order += 1) {
    let entry = { ...entries[order] };
    let placement = null;

    for (let shrink = 0; shrink < 4 && !placement; shrink += 1) {
      if (shrink > 0) {
        entry.fontSize =
          Math.round(Math.max(6.5, entry.fontSize * 0.91) * 10) / 10;
        entry.width = textWidth(
          entry.label,
          entry.fontSize,
          entry.order === 0 ? 0.72 : 0.69,
        );
        entry.height = entry.fontSize * 1.05;
      }
      for (const candidate of candidatePositions(
        entry,
        order,
        entries.length,
        fieldWidth,
        fieldTop,
        fieldHeight,
        mobile,
      )) {
        const box = boundingBox(entry, candidate.x, candidate.y);
        if (
          box.left < 0 ||
          box.right > fieldWidth + 0.1 ||
          box.top < fieldTop - 0.1 ||
          box.bottom > fieldTop + fieldHeight + 0.1
        ) {
          continue;
        }
        if (placed.some((item) => boxesOverlap(box, item.box, margin))) {
          continue;
        }
        placement = { ...entry, x: candidate.x, y: candidate.y, box };
        break;
      }
    }

    if (!placement) return null;
    placed.push(placement);
  }
  return placed;
}

function layoutGoldenField(repositories, fieldWidth, mobile, bandY) {
  if (!repositories.length) return { entries: [], hiddenCount: 0 };
  const dominant = repositories[0];
  const fieldTop = bandY - (mobile ? 46 : 67);
  const fieldHeight = mobile ? 40 : 62;

  for (
    let visibleCount = repositories.length;
    visibleCount >= 1;
    visibleCount -= 1
  ) {
    const visible = repositories
      .slice(0, visibleCount)
      .map((repository, index) =>
        entryForRepository(repository, dominant, fieldWidth, mobile, index),
      );
    const aggregate = entryForAggregate(
      repositories,
      visibleCount,
      dominant,
      fieldWidth,
      mobile,
      visibleCount,
    );
    const entries = aggregate ? [...visible, aggregate] : visible;
    const placed = placeEntries(entries, {
      fieldWidth,
      fieldTop,
      fieldHeight,
      mobile,
    });
    if (placed) {
      return {
        entries: placed,
        hiddenCount: aggregate?.aggregateCount || 0,
        fieldTop,
        fieldHeight,
      };
    }
  }

  const fallback =
    placeEntries(
      [entryForRepository(dominant, dominant, fieldWidth, mobile, 0)],
      {
        fieldWidth,
        fieldTop,
        fieldHeight,
        mobile,
      },
    ) || [];
  return {
    entries: fallback,
    hiddenCount: Math.max(0, repositories.length - 1),
    fieldTop,
    fieldHeight,
  };
}

function textMarkup(entry, fieldX) {
  const aggregate =
    entry.aggregateCount === undefined
      ? ""
      : ` data-aggregate-count="${entry.aggregateCount}"`;
  return `<text class="${entry.className}" data-order="${entry.order}" x="${coordinate(fieldX + entry.x)}" y="${coordinate(entry.y)}" data-score="${coordinate(entry.score)}" data-relative="${decimal(entry.relative)}" data-share="${decimal(entry.share)}"${aggregate} style="font-size:${coordinate(entry.fontSize)}px">${escapeXml(entry.label)}</text>`;
}

function dateRailMarkup(day, bandX, bandY, mobile) {
  const { weekday, day: dayNumber, month } = dateParts(day.date);
  const weekdayY = bandY - (mobile ? 38 : 61);
  const dayY = bandY - (mobile ? 23 : 42);
  const monthY = bandY - (mobile ? 8 : 25);
  return `<g class="day-date-stack" aria-label="${escapeXml(`${weekday} ${dayNumber} ${month}`)}"><text class="day-stack-weekday" x="${coordinate(bandX)}" y="${coordinate(weekdayY)}">${escapeXml(weekday)}</text><text class="day-stack-number" x="${coordinate(bandX)}" y="${coordinate(dayY)}">${escapeXml(dayNumber)}</text><text class="day-stack-month" x="${coordinate(bandX)}" y="${coordinate(monthY)}">${escapeXml(month)}</text></g>`;
}

function goldenFieldMarkup(day, bandX, bandY, bandWidth, mobile) {
  const repositories = repositoriesForDay(day);
  const railWidth = mobile ? 38 : 25;
  const fieldX = bandX + railWidth;
  const fieldWidth = Math.max(40, bandWidth - railWidth - 2);
  if (!repositories.length) {
    return `<g class="repo-golden-field"><text class="repo-empty" x="${coordinate(fieldX + fieldWidth * INV_PHI_SQ)}" y="${coordinate(bandY - (mobile ? 21 : 31))}">NO REPO ACTIVITY</text></g>`;
  }
  const layout = layoutGoldenField(repositories, fieldWidth, mobile, bandY);
  return `<g class="repo-golden-field" data-visible-repos="${repositories.length - layout.hiddenCount}" data-hidden-repos="${layout.hiddenCount}" data-layout="golden">${layout.entries.map((entry) => textMarkup(entry, fieldX)).join("")}</g>`;
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
    .day-stack-weekday,.day-stack-month{fill:#40534e;font-size:7.5px}.day-stack-number{fill:#10231f;font-size:13px;font-weight:900}
    .secondary-repo,.repo-more{fill:#40534e}.repo-more{font-weight:850}.repo-empty{fill:#40534e;font-family:ui-monospace,"SFMono-Regular",Consolas,monospace;font-size:8px;font-weight:750;letter-spacing:.4px}
    ${STYLE_END}
  `;
  return `${cleaned.slice(0, closing)}${styles}${cleaned.slice(closing)}`;
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

  const cleaned = segment
    .replace(/<g class="day-date-stack"[\s\S]*?<\/g>/g, "")
    .replace(/<g class="repo-golden-field"[\s\S]*?<\/g>/g, "")
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

  const markup = `${dateRailMarkup(day, bandX, bandY, mobile)}${goldenFieldMarkup(day, bandX, bandY, bandWidth, mobile)}`;
  const modelBandIndex = cleaned.indexOf('<g class="model-band"');
  if (modelBandIndex < 0) return cleaned;
  return `${cleaned.slice(0, modelBandIndex)}${markup}${cleaned.slice(modelBandIndex)}`;
}

function composeSvg(svg, meta, { mobile = false } = {}) {
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
    const day = daysByDate.get(dateKey(starts[index][1]));
    if (!day) continue;
    output = `${output.slice(0, start)}${scaleDaySegment(output.slice(start, end), day, mobile)}${output.slice(end)}`;
  }
  return injectStyles(output)
    .replaceAll(
      "DATE RAIL · TYPE SIZE = SHARE WITHIN DAY",
      "TYPE SIZE = DAILY REPO SHARE",
    )
    .replaceAll(
      "LEFT FLOW · +N ONLY WHEN SPACE RUNS OUT · RULE = ACTIVITY",
      "TYPE SIZE = DAILY REPO SHARE · +N = OVERFLOW · RULE = ACTIVITY",
    )
    .replaceAll(
      "2×2 TYPE FIELD · +N = HIDDEN SHARE · RULE = ACTIVITY",
      "TYPE SIZE = DAILY REPO SHARE · +N = OVERFLOW · RULE = ACTIVITY",
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
  const desktop = composeSvg(desktopSource, meta);
  const mobile = composeSvg(mobileSource, meta, { mobile: true });

  await ensureParent(args.out);
  await fs.writeFile(args.out, desktop, "utf8");
  await ensureParent(args.mobileOut);
  await fs.writeFile(args.mobileOut, mobile, "utf8");
  console.log(
    "Composed repository labels on a collision-safe golden-section field.",
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

export {
  aggregateHiddenRepositories,
  layoutGoldenField,
  repositoriesForDay,
  composeSvg,
};
