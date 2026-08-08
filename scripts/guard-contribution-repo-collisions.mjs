#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const LABEL_CLASSES = new Set([
  "dominant-repo",
  "secondary-repo",
  "repo-more",
]);
const MOBILE_MARGIN = 3.75;

function parseArgs(argv) {
  const args = {
    input: "assets/contribution-lens-mobile.svg",
    out: "assets/contribution-lens-mobile.svg",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--in") args.input = argv[++index];
    else if (value === "--out") args.out = argv[++index];
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

function attribute(markup, name) {
  const match = markup.match(new RegExp(`\\b${name}="([^"]*)"`));
  return match?.[1] ?? "";
}

function fontSize(markup) {
  const match = markup.match(/font-size:([0-9.]+)px/);
  return number(match?.[1]);
}

function dominantGlyphUnits(label) {
  let units = 0;
  for (const character of String(label || "").toUpperCase()) {
    if (character === "W" || character === "M") units += 1.04;
    else if (character === "I") units += 0.36;
    else if (character === "J" || character === "L") units += 0.5;
    else if (character === "T" || character === "F") units += 0.64;
    else if (character === " ") units += 0.36;
    else units += 0.76;
  }
  return Math.max(1, units);
}

function renderedWidth(label, size, className) {
  if (className === "dominant-repo") {
    return dominantGlyphUnits(label) * size * 1.08;
  }

  let units = 0;
  for (const character of String(label || "")) {
    units += character === " " ? 0.58 : 0.7;
  }
  return Math.max(1, units) * size * 1.08;
}

function renderedBox(entry) {
  return {
    left: entry.x,
    right: entry.x + entry.width,
    top: entry.y - entry.fontSize * 0.92,
    bottom: entry.y + entry.fontSize * 0.3,
  };
}

function boxesOverlap(left, right, margin = MOBILE_MARGIN) {
  return !(
    left.right + margin <= right.left ||
    right.right + margin <= left.left ||
    left.bottom + margin <= right.top ||
    right.bottom + margin <= left.top
  );
}

function parseEntries(groupBody) {
  const pattern = /<text class="([^"]+)"[^>]*>[^<]*<\/text>/g;
  const entries = [];

  for (const match of groupBody.matchAll(pattern)) {
    const className = match[1];
    if (!LABEL_CLASSES.has(className)) continue;
    const markup = match[0];
    const label = markup.match(/>([^<]*)<\/text>$/)?.[1] ?? "";
    const size = fontSize(markup);
    const entry = {
      index: entries.length,
      className,
      label,
      markup,
      x: number(attribute(markup, "x")),
      y: number(attribute(markup, "y")),
      fontSize: size,
      order: number(attribute(markup, "data-order")),
    };
    entry.width = renderedWidth(label, size, className);
    entry.box = renderedBox(entry);
    entries.push(entry);
  }

  return entries.sort((left, right) => left.order - right.order || left.index - right.index);
}

function fieldGeometry(daySegment) {
  const band = daySegment.match(
    /<rect class="model-band-(?:base|empty)" x="([^"]+)" y="([^"]+)" width="([^"]+)"/,
  );
  if (!band) return null;

  const bandX = number(band[1]);
  const bandY = number(band[2]);
  const bandWidth = number(band[3]);
  return {
    left: bandX + 38,
    right: bandX + bandWidth - 2,
    top: bandY - 50,
    bottom: bandY - 5,
  };
}

function withinField(entry, field) {
  const box = renderedBox(entry);
  return (
    box.left >= field.left - 0.1 &&
    box.right <= field.right + 0.1 &&
    box.top >= field.top - 0.1 &&
    box.bottom <= field.bottom + 0.1
  );
}

function layoutIsSafe(entries, field) {
  if (entries.some((entry) => !withinField(entry, field))) return false;
  for (let left = 0; left < entries.length; left += 1) {
    for (let right = left + 1; right < entries.length; right += 1) {
      if (boxesOverlap(entries[left].box, entries[right].box)) return false;
    }
  }
  return true;
}

function scaledEntry(entry, factor) {
  const minimum = entry.className === "dominant-repo" ? 12 : 5.8;
  const size = Math.round(Math.max(minimum, entry.fontSize * factor) * 10) / 10;
  const current = {
    ...entry,
    fontSize: size,
  };
  current.width = renderedWidth(current.label, size, current.className);
  return current;
}

function candidatePlacements(entry, field) {
  const candidates = [];
  const factors = [1, 0.97, 0.94, 0.91, 0.88, 0.84, 0.8, 0.76, 0.72];

  for (const factor of factors) {
    const current = scaledEntry(entry, factor);
    const minBaseline = field.top + current.fontSize * 0.92;
    const maxBaseline = field.bottom - current.fontSize * 0.3;
    const maxX = field.right - current.width;
    if (maxX < field.left || maxBaseline < minBaseline) continue;

    const rawPoints = [
      [entry.x, entry.y],
      [entry.x - 6, entry.y],
      [entry.x + 6, entry.y],
      [entry.x - 12, entry.y],
      [entry.x + 12, entry.y],
      [entry.x, entry.y - 4],
      [entry.x, entry.y + 4],
      [entry.x, entry.y - 8],
      [entry.x, entry.y + 8],
      [entry.x - 10, entry.y - 6],
      [entry.x + 10, entry.y + 6],
    ];

    for (const yRatio of [0, 0.22, 0.45, 0.68, 0.9, 1]) {
      for (const xRatio of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
        rawPoints.push([
          field.left + (maxX - field.left) * xRatio,
          minBaseline + (maxBaseline - minBaseline) * yRatio,
        ]);
      }
    }

    const unique = new Map();
    for (const [rawX, rawY] of rawPoints) {
      const x = clamp(rawX, field.left, maxX);
      const y = clamp(rawY, minBaseline, maxBaseline);
      const key = `${coordinate(x)}:${coordinate(y)}:${factor}`;
      if (unique.has(key)) continue;
      const placed = { ...current, x, y };
      placed.box = renderedBox(placed);
      const distance = Math.hypot(x - entry.x, y - entry.y);
      placed.cost = distance + (1 - factor) * (entry.order === 0 ? 180 : 110);
      unique.set(key, placed);
    }
    candidates.push(...unique.values());
  }

  return candidates.sort((left, right) => left.cost - right.cost).slice(0, 120);
}

function placeEntries(entries, field) {
  let states = [{ entries: [], cost: 0 }];
  const beamWidth = 640;

  for (const entry of entries) {
    const next = [];
    for (const state of states) {
      for (const candidate of candidatePlacements(entry, field)) {
        if (
          state.entries.some((placed) =>
            boxesOverlap(candidate.box, placed.box),
          )
        ) {
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

  return states[0]?.entries ?? null;
}

function replaceAttribute(markup, name, value) {
  const replacement = `${name}="${value}"`;
  const pattern = new RegExp(`\\b${name}="[^"]*"`);
  if (pattern.test(markup)) return markup.replace(pattern, replacement);
  return markup.replace(/<text\b/, `<text ${replacement}`);
}

function replaceFontSize(markup, value) {
  if (/font-size:[0-9.]+px/.test(markup)) {
    return markup.replace(/font-size:[0-9.]+px/, `font-size:${value}px`);
  }
  if (/style="[^"]*"/.test(markup)) {
    return markup.replace(/style="([^"]*)"/, `style="$1;font-size:${value}px"`);
  }
  return markup.replace(/<text\b/, `<text style="font-size:${value}px"`);
}

function updateMarkup(markup, placement) {
  let updated = replaceAttribute(markup, "x", coordinate(placement.x));
  updated = replaceAttribute(updated, "y", coordinate(placement.y));
  updated = replaceFontSize(updated, coordinate(placement.fontSize));
  updated = replaceAttribute(
    updated,
    "data-guard-scale",
    coordinate(placement.fontSize / Math.max(0.1, fontSize(markup))),
  );
  return updated;
}

function markGroup(openingTag) {
  const cleaned = openingTag.replace(/\sdata-collision-guard="[^"]*"/, "");
  return cleaned.replace(/>$/, ' data-collision-guard="mobile-safe">');
}

function guardDay(daySegment) {
  const group = daySegment.match(
    /(<g class="repo-golden-field"[^>]*>)([\s\S]*?)(<\/g>)/,
  );
  const field = fieldGeometry(daySegment);
  if (!group || !field) return daySegment;

  const entries = parseEntries(group[2]);
  if (!entries.length) {
    return daySegment.replace(group[1], markGroup(group[1]));
  }

  const placement = layoutIsSafe(entries, field)
    ? entries
    : placeEntries(entries, field);
  if (!placement) {
    throw new Error("Could not resolve mobile repository label collision.");
  }

  const byMarkup = new Map(
    placement.map((entry) => [entry.markup, updateMarkup(entry.markup, entry)]),
  );
  let body = group[2];
  for (const entry of entries) {
    body = body.replace(entry.markup, byMarkup.get(entry.markup) || entry.markup);
  }

  const replacement = `${markGroup(group[1])}${body}${group[3]}`;
  return daySegment.replace(group[0], replacement);
}

function recentDayRanges(svg) {
  const starts = [
    ...svg.matchAll(/<g class="recent-day" data-recent-day="([^"]+)">/g),
  ];
  return starts.map((match, index) => ({
    start: match.index,
    end:
      index + 1 < starts.length
        ? starts[index + 1].index
        : svg.indexOf("  </g>\n  <!-- profile-detail:end -->", match.index),
  }));
}

function guardMobileSvg(svg) {
  let output = svg;
  const ranges = recentDayRanges(svg);
  for (let index = ranges.length - 1; index >= 0; index -= 1) {
    const { start, end } = ranges[index];
    if (end < 0) continue;
    output = `${output.slice(0, start)}${guardDay(output.slice(start, end))}${output.slice(end)}`;
  }

  const collisions = collisionsForSvg(output);
  if (collisions.length) {
    throw new Error(
      `Mobile repository collision guard left ${collisions.length} collision(s).`,
    );
  }
  return output;
}

function collisionsForSvg(svg) {
  const collisions = [];
  const groupPattern = /<g class="repo-golden-field"[^>]*>([\s\S]*?)<\/g>/g;
  for (const group of svg.matchAll(groupPattern)) {
    const entries = parseEntries(group[1]);
    for (let left = 0; left < entries.length; left += 1) {
      for (let right = left + 1; right < entries.length; right += 1) {
        if (!boxesOverlap(entries[left].box, entries[right].box)) continue;
        collisions.push({
          left: entries[left].label,
          right: entries[right].label,
        });
      }
    }
  }
  return collisions;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const source = await fs.readFile(args.input, "utf8");
  const guarded = guardMobileSvg(source);
  await fs.mkdir(path.dirname(args.out), { recursive: true });
  await fs.writeFile(args.out, guarded, "utf8");
  console.log("Verified and guarded mobile repository label spacing.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

export { collisionsForSvg, guardMobileSvg };
