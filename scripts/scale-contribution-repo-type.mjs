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

function fitInlineEntries(entries, maxWidth, mobile) {
  const separatorWidth = mobile ? 8 : 7;
  const gap = mobile ? 4 : 3;
  const fitted = entries.map((entry) => ({ ...entry }));

  const totalWidth = fitted.reduce(
    (sum, entry, index) =>
      sum +
      textWidth(entry.label, entry.fontSize) +
      (index > 0 ? separatorWidth + gap * 2 : 0),
    0,
  );
  if (totalWidth <= maxWidth || totalWidth <= 0) return fitted;

  const scale = maxWidth / totalWidth;
  for (const entry of fitted) {
    entry.fontSize =
      Math.round(Math.max(6.2, entry.fontSize * scale) * 10) / 10;
  }
  return fitted;
}

function repoEntry(repository, dominant, dominantSize, maxWidth, mobile) {
  const label = repoShortName(repository.name);
  const max = mobile
    ? Math.max(9, Math.min(17, dominantSize - 0.5))
    : Math.max(9.5, Math.min(20, dominantSize - 0.5));
  const min = mobile ? 7.5 : 8;
  return {
    label,
    score: repository.score,
    share: repository.share,
    relative:
      number(dominant.score) > 0
        ? repository.score / dominant.score
        : 0,
    fontSize: fontSizeForRelativeScore(
      label,
      repository.score,
      dominant.score,
      { min, max, maxWidth, widthFactor: 0.58 },
    ),
    className: "secondary-repo",
  };
}

function aggregateEntry(repositories, dominant, dominantSize, maxWidth, mobile) {
  const aggregate = aggregateHiddenRepositories(repositories);
  if (!aggregate.count) return null;
  const label = `+${aggregate.count} MORE`;
  const max = mobile
    ? Math.max(9, Math.min(17, dominantSize - 0.5))
    : Math.max(9.5, Math.min(20, dominantSize - 0.5));
  const min = mobile ? 7.5 : 8;
  return {
    label,
    score: aggregate.score,
    share: aggregate.share,
    relative: aggregate.relative,
    fontSize: fontSizeForRelativeScore(
      label,
      aggregate.score,
      dominant.score,
      { min, max, maxWidth, widthFactor: 0.58 },
    ),
    className: "repo-more",
    aggregateCount: aggregate.count,
  };
}

function textMarkup(entry, x, y) {
  const aggregate =
    entry.aggregateCount === undefined
      ? ""
      : ` data-aggregate-count="${entry.aggregateCount}"`;
  return `<text class="${entry.className}" x="${coordinate(x)}" y="${coordinate(y)}" data-score="${coordinate(entry.score)}" data-relative="${decimal(entry.relative)}" data-share="${decimal(entry.share)}"${aggregate} style="font-size:${coordinate(entry.fontSize)}px">${escapeXml(entry.label)}</text>`;
}

function dateStackMarkup(day, bandX, bandY, mobile) {
  const { weekday, day: dayNumber, month } = dateParts(day.date);
  const weekdayY = bandY - (mobile ? 36 : 57);
  const dayY = bandY - (mobile ? 21 : 39);
  const monthY = bandY - (mobile ? 7 : 23);
  return `<g class="day-date-stack" aria-label="${escapeXml(`${weekday} ${dayNumber} ${month}`)}"><text class="day-stack-weekday" x="${coordinate(bandX)}" y="${coordinate(weekdayY)}">${escapeXml(weekday)}</text><text class="day-stack-number" x="${coordinate(bandX)}" y="${coordinate(dayY)}">${escapeXml(dayNumber)}</text><text class="day-stack-month" x="${coordinate(bandX)}" y="${coordinate(monthY)}">${escapeXml(month)}</text></g>`;
}

function repositoryBlockMarkup(day, bandX, bandY, bandWidth, mobile) {
  const repositories = repositoriesForDay(day);
  const railWidth = mobile ? 42 : 28;
  const x = bandX + railWidth;
  const maxWidth = Math.max(36, bandWidth - railWidth - 2);

  if (!repositories.length) {
    return `<g class="repo-type-block"><text class="repo-empty" x="${coordinate(x)}" y="${coordinate(bandY - (mobile ? 20 : 36))}">NO REPO ACTIVITY</text></g>`;
  }

  const dominant = repositories[0];
  const dominantLabel = repoShortName(dominant.name);
  const dominantSize = fontSizeForShare(
    dominantLabel,
    dominant.share,
    mobile
      ? { min: 15, max: 21, maxWidth, widthFactor: 0.55 }
      : { min: 16, max: 24, maxWidth, widthFactor: 0.55 },
  );
  const dominantY = bandY - (mobile ? 27 : 50);
  const dominantMarkup = `<text class="dominant-repo" x="${coordinate(x)}" y="${coordinate(dominantY)}" data-score="${coordinate(dominant.score)}" data-relative="1" data-share="${decimal(dominant.share)}" style="font-size:${coordinate(dominantSize)}px">${escapeXml(dominantLabel)}</text>`;

  if (mobile) {
    const entries = repositories
      .slice(1, 3)
      .map((repository) =>
        repoEntry(repository, dominant, dominantSize, maxWidth, true),
      );
    const aggregate = aggregateEntry(
      repositories,
      dominant,
      dominantSize,
      maxWidth,
      true,
    );
    if (aggregate) entries.push(aggregate);
    const fitted = fitInlineEntries(entries, maxWidth, true);
    const secondaryY = bandY - 7;
    let cursor = x;
    const markup = [dominantMarkup];
    fitted.forEach((entry, index) => {
      if (index > 0) {
        cursor += 4;
        markup.push(
          `<text class="secondary-separator" x="${coordinate(cursor)}" y="${coordinate(secondaryY)}" style="font-size:7.5px">·</text>`,
        );
        cursor += 7.5 * 0.62 + 4;
      }
      markup.push(textMarkup(entry, cursor, secondaryY));
      cursor += textWidth(entry.label, entry.fontSize);
    });
    return `<g class="repo-type-block">${markup.join("")}</g>`;
  }

  const markup = [dominantMarkup];
  const visible = repositories.slice(1, 3);
  const lines = [bandY - 31, bandY - 15];
  visible.forEach((repository, index) => {
    const entry = repoEntry(
      repository,
      dominant,
      dominantSize,
      maxWidth,
      false,
    );
    markup.push(textMarkup(entry, x, lines[index]));
  });
  const aggregate = aggregateEntry(
    repositories,
    dominant,
    dominantSize,
    maxWidth,
    false,
  );
  if (aggregate) {
    markup.push(textMarkup(aggregate, x, bandY - 3));
  }
  return `<g class="repo-type-block">${markup.join("")}</g>`;
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
    .replace(/<g class="repo-type-block"[\s\S]*?<\/g>/g, "")
    .replace(/<text class="day-date"[^>]*>[^<]*<\/text>/g, "")
    .replace(/<text class="dominant-repo"[^>]*>[^<]*<\/text>/g, "")
    .replace(/<text class="secondary-repos"[^>]*>[^<]*<\/text>/g, "")
    .replace(/<text class="secondary-repo"[^>]*>[^<]*<\/text>/g, "")
    .replace(/<text class="secondary-separator"[^>]*>[^<]*<\/text>/g, "")
    .replace(/<text class="repo-more"[^>]*>[^<]*<\/text>/g, "")
    .replace(/<text class="repo-empty"[^>]*>[^<]*<\/text>/g, "");

  const markup = `${dateStackMarkup(day, bandX, bandY, mobile)}${repositoryBlockMarkup(day, bandX, bandY, bandWidth, mobile)}`;
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
    .day-date-stack text,.secondary-repo,.secondary-separator,.repo-more{font-family:ui-monospace,"SFMono-Regular",Consolas,monospace;font-weight:800;letter-spacing:.3px}
    .day-stack-weekday,.day-stack-month{fill:#40534e;font-size:7.5px}.day-stack-number{fill:#10231f;font-size:13px;font-weight:900}
    .secondary-repo,.repo-more{fill:#40534e}.secondary-separator{fill:#b9b2a5;font-weight:700}
    .repo-empty{fill:#40534e;font-family:ui-monospace,"SFMono-Regular",Consolas,monospace;font-size:8px;font-weight:750;letter-spacing:.4px}
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
      "DATE STACK · REPO TYPE = SHARE WITHIN DAY",
    )
    .replaceAll(
      "REPO TYPE SIZE = SHARE WITHIN EACH DAY",
      "DATE STACK · REPO TYPE = SHARE WITHIN DAY",
    )
    .replaceAll(
      "TYPE SIZE = REPO SHARE WITHIN DAY · RULE LENGTH = GITHUB ACTIVITY",
      "TYPE SIZE = REPO SHARE WITHIN DAY · +N = HIDDEN SHARE · RULE = GITHUB ACTIVITY",
    )
    .replaceAll(
      "TYPE SIZE = REPO SHARE WITHIN DAY · RULE = GITHUB ACTIVITY",
      "TYPE SIZE = REPO SHARE WITHIN DAY · +N = HIDDEN SHARE · RULE = GITHUB ACTIVITY",
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
  console.log("Stacked dates vertically and scaled repository type within each day.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

export {
  aggregateHiddenRepositories,
  fontSizeForRelativeScore,
  fontSizeForShare,
  repositoriesForDay,
  scaleSvg,
};
