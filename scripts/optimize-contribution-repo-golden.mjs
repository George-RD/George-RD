#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const INV_PHI = 2 / (1 + Math.sqrt(5));
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
    return parts.map((part) => part[0]).join("").slice(0, 6).toUpperCase();
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
  const score = hidden.reduce((sum, repository) => sum + repository.score, 0);
  const share = hidden.reduce((sum, repository) => sum + repository.share, 0);
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

function textWidth(label, fontSize, widthFactor = 0.69) {
  return Math.max(1, String(label || "").length) * fontSize * widthFactor;
}

function constrainedSize(label, desired, min, max, maxWidth, widthFactor) {
  const cap = maxWidth / (Math.max(1, label.length) * widthFactor);
  return Math.round(Math.max(min, Math.min(desired, max, cap)) * 10) / 10;
}

function profiles(mobile, count) {
  return [
    {
      id: "open",
      dominant: mobile ? [16, 23] : [17, 25],
      secondary: mobile ? [8, 17] : [8.5, 19],
      floor: mobile ? 7 : 7.2,
    },
    {
      id: "balanced",
      dominant: mobile ? [15, 22] : [16, 23.5],
      secondary: mobile ? [7.2, 15.5] : [7.5, 17],
      floor: mobile ? 6.6 : 6.8,
    },
    {
      id: "dense",
      dominant: mobile ? [14.5, 21] : [15, 22],
      secondary: mobile ? [6.2, 13.2] : [6.3, 14],
      floor: mobile ? 5.9 : 6,
      crowded: count >= 6,
    },
  ];
}

function repositoryEntry(repository, dominant, fieldWidth, order, profile) {
  const label = repoShortName(repository.name);
  const main = order === 0;
  const widthFactor = main ? 0.72 : 0.69;
  const range = main ? profile.dominant : profile.secondary;
  const relative = dominant.score > 0 ? repository.score / dominant.score : 0;
  const value = main ? repository.share : clamp(relative, 0, 1) ** 0.62;
  const desired = range[0] + (range[1] - range[0]) * value;
  const fontSize = constrainedSize(
    label,
    desired,
    range[0],
    range[1],
    fieldWidth,
    widthFactor,
  );
  return {
    label,
    score: repository.score,
    share: repository.share,
    relative,
    fontSize,
    width: textWidth(label, fontSize, widthFactor),
    widthFactor,
    minRendered: profile.floor,
    className: main ? "dominant-repo" : "secondary-repo",
    order,
  };
}

function aggregateEntry(repositories, visibleCount, dominant, fieldWidth, order, profile) {
  const aggregate = aggregateHiddenRepositories(repositories, visibleCount);
  if (!aggregate.count) return null;
  const label = `+${aggregate.count} MORE`;
  const widthFactor = 0.69;
  const value = clamp(aggregate.relative, 0, 1) ** 0.62;
  const desired =
    profile.secondary[0] +
    (profile.secondary[1] - profile.secondary[0]) * value;
  const fontSize = constrainedSize(
    label,
    desired,
    profile.secondary[0],
    profile.secondary[1],
    fieldWidth,
    widthFactor,
  );
  return {
    label,
    score: aggregate.score,
    share: aggregate.share,
    relative: aggregate.relative,
    fontSize,
    width: textWidth(label, fontSize, widthFactor),
    widthFactor,
    minRendered: profile.floor,
    className: "repo-more",
    aggregateCount: aggregate.count,
    order,
  };
}

function box(entry, x, y) {
  return {
    left: x,
    right: x + entry.width,
    top: y - entry.fontSize * 0.82,
    bottom: y + entry.fontSize * 0.23,
  };
}

function overlaps(left, right, margin) {
  return !(
    left.right + margin <= right.left ||
    right.right + margin <= left.left ||
    left.bottom + margin <= right.top ||
    right.bottom + margin <= left.top
  );
}

function preferred(order, count, mobile) {
  if (count === 1) return { x: INV_PHI_SQ, y: mobile ? 0.58 : 0.56 };
  if (count === 2) {
    return order === 0 ? { x: 0.06, y: 0.66 } : { x: 0.68, y: 0.24 };
  }
  const radius = 0.12 + 0.34 * Math.sqrt(order / Math.max(1, count - 1));
  const angle = -Math.PI / 2 + order * GOLDEN_ANGLE;
  return {
    x: clamp(0.48 + Math.cos(angle) * radius, 0.02, 0.92),
    y: clamp(0.5 + Math.sin(angle) * radius * 0.9, 0.08, 0.92),
  };
}

function points(order, count, mobile) {
  const target = preferred(order, count, mobile);
  const candidates = [target];
  for (const y of [0.16, INV_PHI_SQ, INV_PHI, 0.84]) {
    for (const x of [0, INV_PHI_SQ, INV_PHI, 1]) candidates.push({ x, y });
  }
  const samples = Math.max(30, count * 7);
  for (let index = 0; index < samples; index += 1) {
    const radius = Math.sqrt((index + 0.5) / samples);
    const angle = (index + order * INV_PHI) * GOLDEN_ANGLE;
    candidates.push({
      x: clamp(0.5 + Math.cos(angle) * 0.49 * radius, 0, 1),
      y: clamp(0.5 + Math.sin(angle) * 0.47 * radius, 0.04, 0.96),
    });
  }
  const unique = new Map();
  for (const point of candidates) {
    unique.set(`${Math.round(point.x * 1000)}:${Math.round(point.y * 1000)}`, point);
  }
  return [...unique.values()].sort((left, right) => {
    const a = (left.x - target.x) ** 2 + (left.y - target.y) ** 2;
    const b = (right.x - target.x) ** 2 + (right.y - target.y) ** 2;
    return a - b;
  });
}

function scaledEntry(entry, factor) {
  const fontSize =
    Math.round(Math.max(entry.minRendered, entry.fontSize * factor) * 10) / 10;
  return {
    ...entry,
    fontSize,
    width: textWidth(entry.label, fontSize, entry.widthFactor),
    scaleFactor: factor,
  };
}

function placements(entry, order, count, geometry) {
  const target = preferred(order, count, geometry.mobile);
  const result = [];
  for (const factor of [1, 0.94, 0.88, 0.82, 0.76]) {
    const current = scaledEntry(entry, factor);
    if (current.width > geometry.fieldWidth) continue;
    for (const point of points(order, count, geometry.mobile)) {
      const available = geometry.fieldWidth - current.width;
      const x = clamp(point.x * available, 0, available);
      const y =
        geometry.fieldTop + clamp(point.y, 0.06, 0.94) * geometry.fieldHeight;
      const bounds = box(current, x, y);
      if (
        bounds.top < geometry.fieldTop - 0.1 ||
        bounds.bottom > geometry.fieldTop + geometry.fieldHeight + 0.1
      ) {
        continue;
      }
      const distance =
        (point.x - target.x) ** 2 + (point.y - target.y) ** 2;
      result.push({
        ...current,
        x,
        y,
        box: bounds,
        cost: distance * 14 + (1 - factor) * (order === 0 ? 34 : 18),
      });
    }
  }
  return result
    .sort((left, right) => left.cost - right.cost)
    .slice(0, geometry.mobile ? 56 : 72);
}

function place(entries, geometry) {
  const margin = geometry.mobile ? 1.8 : 2.3;
  const beamWidth = geometry.mobile ? 256 : 768;
  let states = [{ entries: [], cost: 0 }];
  for (let order = 0; order < entries.length; order += 1) {
    const next = [];
    for (const state of states) {
      for (const candidate of placements(entries[order], order, entries.length, geometry)) {
        if (state.entries.some((entry) => overlaps(candidate.box, entry.box, margin))) {
          continue;
        }
        next.push({
          entries: [...state.entries, candidate],
          cost: state.cost + candidate.cost,
        });
      }
    }
    if (!next.length) return null;
    next.sort((left, right) => left.cost - right.cost);
    states = next.slice(0, beamWidth);
  }
  return states[0]?.entries || null;
}

function layoutGoldenField(repositories, fieldWidth, mobile, bandY) {
  if (!repositories.length) return { entries: [], visibleCount: 0, hiddenCount: 0 };
  const dominant = repositories[0];
  const geometry = {
    fieldWidth,
    fieldTop: bandY - (mobile ? 50 : 74),
    fieldHeight: mobile ? 45 : 69,
    mobile,
  };

  for (let visibleCount = repositories.length; visibleCount >= 1; visibleCount -= 1) {
    const hiddenCount = repositories.length - visibleCount;
    for (const profile of profiles(mobile, visibleCount + (hiddenCount ? 1 : 0))) {
      const visible = repositories
        .slice(0, visibleCount)
        .map((repository, index) =>
          repositoryEntry(repository, dominant, fieldWidth, index, profile),
        );
      const aggregate = aggregateEntry(
        repositories,
        visibleCount,
        dominant,
        fieldWidth,
        visibleCount,
        profile,
      );
      const entries = aggregate ? [...visible, aggregate] : visible;
      const placed = place(entries, geometry);
      if (!placed) continue;
      return {
        entries: placed,
        visibleCount,
        hiddenCount,
        visibleShare: repositories
          .slice(0, visibleCount)
          .reduce((sum, repository) => sum + repository.share, 0),
        density: profile.id,
        fieldTop: geometry.fieldTop,
        fieldHeight: geometry.fieldHeight,
      };
    }
  }

  return {
    entries: [],
    visibleCount: 0,
    hiddenCount: repositories.length,
    visibleShare: 0,
    density: "dense",
    fieldTop: geometry.fieldTop,
    fieldHeight: geometry.fieldHeight,
  };
}

function textMarkup(entry, fieldX) {
  const aggregate =
    entry.aggregateCount === undefined
      ? ""
      : ` data-aggregate-count="${entry.aggregateCount}"`;
  return `<text class="${entry.className}" data-order="${entry.order}" x="${coordinate(fieldX + entry.x)}" y="${coordinate(entry.y)}" data-score="${coordinate(entry.score)}" data-relative="${decimal(entry.relative)}" data-share="${decimal(entry.share)}" data-scale="${decimal(entry.scaleFactor || 1)}"${aggregate} style="font-size:${coordinate(entry.fontSize)}px">${escapeXml(entry.label)}</text>`;
}

function fieldMarkup(day, bandX, bandY, bandWidth, mobile) {
  const repositories = repositoriesForDay(day);
  const railWidth = mobile ? 38 : 25;
  const fieldX = bandX + railWidth;
  const fieldWidth = Math.max(40, bandWidth - railWidth - 2);
  const layout = layoutGoldenField(repositories, fieldWidth, mobile, bandY);
  return `<g class="repo-golden-field" data-visible-repos="${layout.visibleCount}" data-hidden-repos="${layout.hiddenCount}" data-visible-share="${decimal(layout.visibleShare)}" data-density="${layout.density}" data-layout="golden-adaptive">${layout.entries.map((entry) => textMarkup(entry, fieldX)).join("")}</g>`;
}

function optimizeDay(segment, day, mobile) {
  const band = segment.match(
    /<rect class="model-band-(?:base|empty)" x="([^"]+)" y="([^"]+)" width="([^"]+)"/,
  );
  if (!band) return segment;
  const bandX = number(band[1]);
  const bandY = number(band[2]);
  const bandWidth = number(band[3]);
  const cleaned = segment.replace(
    /<g class="repo-golden-field"[\s\S]*?<\/g>/g,
    "",
  );
  const index = cleaned.indexOf('<g class="model-band"');
  if (index < 0) return cleaned;
  return `${cleaned.slice(0, index)}${fieldMarkup(day, bandX, bandY, bandWidth, mobile)}${cleaned.slice(index)}`;
}

function composeSvg(svg, meta, { mobile = false } = {}) {
  const days = new Map(
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
    const day = days.get(dateKey(starts[index][1]));
    if (end < 0 || !day) continue;
    output = `${output.slice(0, start)}${optimizeDay(output.slice(start, end), day, mobile)}${output.slice(end)}`;
  }
  return output
    .replaceAll('data-layout="golden"', 'data-layout="golden-adaptive"')
    .replaceAll(
      "TYPE SIZE = DAILY REPO SHARE · +N = OVERFLOW · RULE = ACTIVITY",
      "TYPE SIZE = DAILY REPO SHARE · +N ONLY WHEN SPACE RUNS OUT",
    )
    .replaceAll(
      "ADAPTIVE GOLDEN FIELD · +N ONLY FOR TRUE OVERFLOW",
      "TYPE SIZE = DAILY REPO SHARE · +N ONLY WHEN SPACE RUNS OUT",
    );
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
  await fs.mkdir(path.dirname(args.out), { recursive: true });
  await fs.writeFile(args.out, desktop, "utf8");
  await fs.mkdir(path.dirname(args.mobileOut), { recursive: true });
  await fs.writeFile(args.mobileOut, mobile, "utf8");
  console.log("Expanded golden-field repository visibility adaptively.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

export {
  aggregateHiddenRepositories,
  composeSvg,
  layoutGoldenField,
  repositoriesForDay,
};
