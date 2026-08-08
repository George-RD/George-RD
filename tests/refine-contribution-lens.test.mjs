import assert from "node:assert/strict";
import test from "node:test";

import {
  refineDesktopSvg,
  refineMobileSvg,
  repoShortName,
  summarize,
  updateMeta,
} from "../scripts/refine-contribution-lens.mjs";

function addDays(value, days) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function metaFixture() {
  const focus = Array.from({ length: 28 }, (_, index) => {
    const date = addDays("2026-07-12", index);
    const future = index === 27;
    const primary = index % 2 ? "openspine" : "cairn";
    const secondary = index % 2 ? "rive-rs-cli" : "mag";
    const primaryScore = index % 2 ? 6 : 8;
    const secondaryScore = index % 2 ? 4 : 2;

    return {
      date,
      contributions: future || index === 12 ? 0 : 20 + index,
      repository: future ? null : primary,
      repositories: future
        ? []
        : [
            {
              name: primary,
              score: primaryScore,
              share: primaryScore / 10,
              commits: primaryScore,
              merges: 0,
              reviews: 0,
            },
            {
              name: secondary,
              score: secondaryScore,
              share: secondaryScore / 10,
              commits: secondaryScore,
              merges: 0,
              reviews: 0,
            },
          ],
      event: future ? null : index % 4 === 0 ? "merge" : null,
      modelFamilies: future
        ? { claude: 0, gpt: 0, gemini: 0, other: 0 }
        : {
            claude: 30,
            gpt: 60,
            gemini: index % 3 === 0 ? 10 : 0,
            other: 5,
          },
    };
  });

  return {
    generatedAt: "2026-08-07T05:01:54.386Z",
    range: {
      focusStart: "2026-07-12",
      focusEnd: "2026-08-08",
    },
    metrics: {
      activeDays: 26,
      mergeDays: 8,
      focusShare: 0.4339,
      topRepos: ["cairn", "openspine"],
    },
    focus,
  };
}

function overviewCells() {
  const dates = Array.from({ length: 21 }, (_, index) =>
    addDays("2026-07-19", index),
  );
  return dates
    .map((date, index) => {
      const week = Math.floor(index / 7);
      const row = index % 7;
      return `<rect class="overview-cell" data-day="${date}" x="${100 + week * 20}" y="${120 + row * 16}" width="14" height="14" rx="1.4" fill="#d7d6c8"/>`;
    })
    .join("\n");
}

function desktopSkeleton() {
  return `<svg viewBox="0 0 1200 610"><style>.repo{font-size:11px}</style>
  <text>365 DAYS / LATEST 4 WEEKS</text>
  ${overviewCells()}
  <rect class="selection" x="100" y="116" width="60" height="118"/>
  <path class="connector" d="M1 1"/>
  <rect class="lens-panel"/>
  <rect class="metric-panel"/>
  <line class="rule-strong" x1="58" y1="560" x2="1142" y2="560"/>
</svg>`;
}

function mobileSkeleton() {
  return `<svg viewBox="0 0 720 900"><style>.repo{font-size:14px}</style>
  <text>latest four weeks and three focus metrics</text>
  ${overviewCells()}
  <rect class="selection" x="100" y="116" width="60" height="118"/>
  <path class="connector" d="M1 1"/>
  <rect class="lens-panel"/>
  <rect class="metric-panel"/>
  <line class="rule" x1="32" y1="818" x2="688" y2="818"/>
</svg>`;
}

test("summarize chooses a 14-day display while keeping the true current streak", () => {
  const summary = summarize(metaFixture());

  assert.equal(summary.recent.length, 14);
  assert.equal(summary.recent[0].date, "2026-07-25");
  assert.equal(summary.recent.at(-1).date, "2026-08-07");
  assert.equal(summary.activeDays, 14);
  assert.equal(summary.streak, 14);
  assert.deepEqual(summary.topRepos, ["CAIRN", "SPINE"]);
  assert.equal(summary.focusShare, 0.7);
  assert.equal(repoShortName("openspine"), "SPINE");
});

test("renders fourteen large day cards with repo tiles and a full-width daily model band", () => {
  const desktop = refineDesktopSvg(desktopSkeleton(), metaFixture());
  const mobile = refineMobileSvg(mobileSkeleton(), metaFixture());

  for (const svg of [desktop, mobile]) {
    assert.equal((svg.match(/data-recent-day=/g) || []).length, 14);
    assert.match(svg, /LATEST 14 DAYS/);
    assert.match(svg, /REPO SHADE = SHARE OF THAT DAY/);
    assert.match(svg, /LOWER BAND = TOKSCALE MODEL MIX/);
    assert.match(svg, /class="repo-tile"/);
    assert.match(svg, />SPINE</);
    assert.match(svg, />RIVE</);
    assert.match(svg, /data-model-band="day"/);
    assert.match(svg, /class="family-gpt"/);
    assert.match(svg, /REPO SHARE/);
    assert.doesNotMatch(svg, /LATEST 4 WEEKS/);
    assert.doesNotMatch(svg, /DAY STREAK/);
    assert.doesNotMatch(svg, /class="lens-panel"/);
    assert.doesNotMatch(svg, /class="metric-panel"/);
  }

  assert.match(
    desktop,
    /data-recent-day="2026-07-25"[^]*?<rect class="recent-card" x="58" y="303" width="148" height="104"/,
  );
  assert.match(
    desktop,
    /data-recent-day="2026-08-01"[^]*?<rect class="recent-card" x="58" y="419" width="148" height="104"/,
  );
  assert.match(
    mobile,
    /data-recent-day="2026-07-25"[^]*?<rect class="recent-card" x="32" y="292" width="322" height="66"/,
  );
  assert.match(
    mobile,
    /data-recent-day="2026-07-26"[^]*?<rect class="recent-card" x="366" y="292" width="322" height="66"/,
  );
});

test("replaces the four-week overview selection with exact recent-day segments", () => {
  const svg = refineDesktopSvg(desktopSkeleton(), metaFixture());

  assert.match(svg, /class="recent-selection"/);
  assert.match(svg, /class="selection-segment"/);
  assert.doesNotMatch(svg, /<rect class="selection"/);
});

test("refinement remains idempotent for scheduled reruns", () => {
  const once = refineDesktopSvg(desktopSkeleton(), metaFixture());
  const twice = refineDesktopSvg(once, metaFixture());

  assert.equal((twice.match(/profile-detail:start/g) || []).length, 1);
  assert.equal((twice.match(/profile-refinement:start/g) || []).length, 1);
  assert.equal(twice, once);
});

test("writes 14-day metrics and removes obsolete merge-day metadata", () => {
  const meta = updateMeta(metaFixture());

  assert.equal(meta.metrics.focusDays, 14);
  assert.equal(meta.metrics.streak, 14);
  assert.equal(meta.metrics.activeDays, 14);
  assert.deepEqual(meta.metrics.topRepos, ["CAIRN", "SPINE"]);
  assert.equal(meta.metrics.focusShare, 0.7);
  assert.equal(meta.range.focusStart, "2026-07-25");
  assert.equal(meta.range.focusEnd, "2026-08-07");
  assert.equal("mergeDays" in meta.metrics, false);
});
