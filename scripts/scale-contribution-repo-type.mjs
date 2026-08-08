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

function fitSecondaryEntries(entries, maxWidth, mobile) {
  const separatorWidth = mobile ? 8 : 7;
  const gap = mobile ? 4 : 3;
  const fitted = entries.map((entry) => ({ ...entry }));

  const totalWidth = () =>
    fitted.reduce(
      (sum, entry, index) =>
        sum +
        textWidth(entry.label, entry.fontSize) +
        (index > 0 ? separatorWidth + gap * 2 : 0),
      0,
    );

  const current = totalWidth();
  if (current <= maxWidth || current <= 0) return fitted;

  const scale = maxWidth / current;
  for (const entry of fitted) {
    entry.fontSize =
      Math.round(Math.max(6.2, entry.fontSize * scale) * 10) / 10;
  }
  return fitted;
}

function secondaryMarkup({
  repositories,
  dominantSize,
  x,
  y,
  maxWidth,
  mobile,
  moreY,
}) {
  const visible = repositories.slice(1, 3);
  const extra = Math.max(0, repositories.length - 3);
  const topScore = Math.max(1, number(repositories[0]?.score));
  const secondaryMax = mobile
    ? Math.max(8, Math.min(16, dominantSize - 1))
    : Math.max(8.5, Math.min(19.5, dominantSize - 1));
  const config = mobile
    ? { min: 7, max: secondaryMax, maxWidth }
    : { min: 7.5, max: secondaryMax, maxWidth };

  const entries = visible.map((repository) => {
    const label = repoShortName(repository.name);
    return {
      label,
      share: repository.share,
      score: repository.score,
      relative: repository.score / topScore,
      fontSize: fontSizeForRelativeScore(
        label,
        repository.score,
        topScore,
        config,
      ),
      className: "secondary-repo",
    };
  });

  if (mobile && extra > 0) {
    entries.push({
      label: `+${extra} MORE`,
      share: 0,
      score: 0,
      relative: 0,
      fontSize: 7,
      className: "repo-more",
    });
  }

  const fitted = fitSecondaryEntries(entries, maxWidth, mobile);
  let cursor = x;
  const separatorSize = mobile ? 7.5 : 7;
  const gap = mobile ? 4 : 3;
  const markup = [];

  fitted.forEach((entry, index) => {
    if (index > 0) {
      cursor += gap;
      markup.push(
        `<text class="secondary-separator" x="${coordinate(cursor)}" y="${coordinate(y)}" style="font-size:${coordinate(separatorSize)}px">·</text>`,
      );
      cursor += separatorSize * 0.62 + gap;
    }
    markup.push(
      `<text class="${entry.className}" x="${coordinate(cursor)}" y="${coordinate(y)}" data-score="${coordinate(entry.score)}" data-relative="${decimal(entry.relative)}" data-share="${decimal(entry.share)}" style="font-size:${coordinate(entry.fontSize)}px">${escapeXml(entry.label)}</text>`,
    );
    cursor += textWidth(entry.label, entry.fontSize);
  });

  if (!mobile && extra > 0) {
    markup.push(
      `<text class="repo-more" x="${coordinate(x)}" y="${coordinate(moreY)}" data-score="0" data-relative="0" data-share="0" style="font-size:7.5px">+${extra} MORE</text>`,
    );
  }

  return markup.join("");
}

function scaleDaySegment(segment, day, mobile) {
  const repositories = repositoriesForDay(day);
  if (!repositories.length) return segment;

  const secondaryPosition = segment.match(
    /<text class="(?:secondary-repos|secondary-repo)" x="([^"]+)" y="([^"]+)"[^>]*>[^<]*<\/text>/,
  );
  const morePosition = segment.match(
    /<text class="repo-more" x="([^"]+)" y="([^"]+)"[^>]*>[^<]*<\/text>/,
  );
  const cleaned = segment
    .replace(/<text class="secondary-repos"[^>]*>[^<]*<\/text>/g, "")
    .replace(/<text class="secondary-repo"[^>]*>[^<]*<\/text>/g, "")
    .replace(/<text class="secondary-separator"[^>]*>[^<]*<\/text>/g, "")
    .replace(/<text class="repo-more"[^>]*>[^<]*<\/text>/g, "");

  const dominantMatch = cleaned.match(
    /<text class="dominant-repo" x="([^"]+)" y="([^"]+)"[^>]*>[^<]*<\/text>/,
  );
  if (!dominantMatch) return segment;

  const bandMatch = cleaned.match(
    /<rect class="model-band-(?:base|empty)" x="([^"]+)" y="[^"]+" width="([^"]+)"/,
  );

  const dominantX = number(dominantMatch[1]);
  const dominantY = number(dominantMatch[2]);
  const bandX = bandMatch ? number(bandMatch[1]) : dominantX;
  const bandWidth = bandMatch ? number(bandMatch[2]) : mobile ? 240 : 140;
  const availableWidth = Math.max(36, bandX + bandWidth - dominantX - 2);
  const dominant = repositories[0];
  const dominantLabel = repoShortName(dominant.name);
  const dominantConfig = mobile
    ? {
        min: 15,
        max: 21,
        maxWidth: availableWidth,
        widthFactor: 0.55,
      }
    : {
        min: 16,
        max: 24,
        maxWidth: availableWidth,
        widthFactor: 0.55,
      };
  const dominantSize = fontSizeForShare(
    dominantLabel,
    dominant.share,
    dominantConfig,
  );
  const dominantMarkup = `<text class="dominant-repo" x="${coordinate(dominantX)}" y="${coordinate(dominantY)}" data-score="${coordinate(dominant.score)}" data-relative="1" data-share="${decimal(dominant.share)}" style="font-size:${coordinate(dominantSize)}px">${escapeXml(dominantLabel)}</text>`;

  const secondaryX = secondaryPosition
    ? number(secondaryPosition[1])
    : dominantX;
  const secondaryY = secondaryPosition
    ? number(secondaryPosition[2])
    : dominantY + (mobile ? 17 : 22);
  const moreY = morePosition
    ? number(morePosition[2])
    : secondaryY + (mobile ? 10 : 14);
  const secondary = secondaryMarkup({
    repositories,
    dominantSize,
    x: secondaryX,
    y: secondaryY,
    maxWidth: Math.max(28, bandX + bandWidth - secondaryX - 2),
    mobile,
    moreY,
  });

  return cleaned.replace(
    dominantMatch[0],
    `${dominantMarkup}${secondary}`,
  );
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
    .secondary-repo,.secondary-separator{font-family:ui-monospace,"SFMono-Regular",Consolas,monospace;font-weight:850;letter-spacing:.3px}
    .secondary-repo{fill:#40534e}.secondary-separator{fill:#b9b2a5;font-weight:700}.repo-more{fill:#40534e}
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
      "REPO TYPE SIZE = SHARE WITHIN EACH DAY",
    )
    .replaceAll(
      "REPO TYPE SIZE = SHARE OF THAT DAY",
      "REPO TYPE SIZE = SHARE WITHIN EACH DAY",
    )
    .replaceAll(
      "TYPE WEIGHT = REPO RANK · RULE LENGTH = GITHUB ACTIVITY",
      "TYPE SIZE = REPO SHARE WITHIN DAY · RULE LENGTH = GITHUB ACTIVITY",
    )
    .replaceAll(
      "TYPE SIZE = DAILY REPO SHARE · RULE LENGTH = GITHUB ACTIVITY",
      "TYPE SIZE = REPO SHARE WITHIN DAY · RULE LENGTH = GITHUB ACTIVITY",
    )
    .replaceAll(
      "TYPE = REPO RANK · RULE LENGTH = GITHUB ACTIVITY",
      "TYPE SIZE = REPO SHARE WITHIN DAY · RULE = GITHUB ACTIVITY",
    )
    .replaceAll(
      "TYPE SIZE = DAILY REPO SHARE · RULE = GITHUB ACTIVITY",
      "TYPE SIZE = REPO SHARE WITHIN DAY · RULE = GITHUB ACTIVITY",
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
  console.log("Scaled every repository label relative to peers within its day.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

export {
  fontSizeForRelativeScore,
  fontSizeForShare,
  repositoriesForDay,
  scaleSvg,
};
