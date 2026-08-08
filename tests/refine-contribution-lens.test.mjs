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
    const date = addDays("2026-07-13", index);
    const future = index > 25;
    return {
      date,
      contributions: future || index === 7 ? 0 : 10 + index,
      repository: future ? null : index % 2 ? "openspine" : "cairn",
      event: future ? null : index % 4 === 0 ? "merge" : null,
      modelFamilies: future
        ? { claude: 0, gpt: 0, gemini: 0, other: 0 }
        : { claude: 30, gpt: 60, gemini: index % 3 === 0 ? 10 : 0, other: 5 },
    };
  });
  return {
    generatedAt: "2026-08-07T05:01:54.386Z",
    metrics: {
      activeDays: 25,
      mergeDays: 8,
      focusShare: 0.4339,
      topRepos: ["CAIRN", "OPEN"],
    },
    focus,
  };
}

function desktopSkeleton() {
  return `<svg><style>.repo{font-size:11px}</style>
  <path class="connector" d="M1 1"/>
  <rect class="lens-panel"/>
  <rect class="metric-panel"/>
  <text>OPEN</text>
  <line class="rule-strong" x1="58" y1="560" x2="1142" y2="560"/>
</svg>`;
}

function mobileSkeleton() {
  return `<svg><style>.repo{font-size:14px}</style>
  <path class="connector" d="M1 1"/>
  <rect class="lens-panel"/>
  <rect class="metric-panel"/>
  <line class="rule" x1="32" y1="818" x2="688" y2="818"/>
</svg>`;
}

test("uses a real current streak while retaining active-day context", () => {
  const summary = summarize(metaFixture());

  assert.equal(summary.activeDays, 25);
  assert.equal(summary.streak, 18);
  assert.deepEqual(summary.topRepos, ["CAIRN", "SPINE"]);
  assert.equal(repoShortName("openspine"), "SPINE");
});

test("removes weak summary copy and keeps two clear metric blocks", () => {
  const desktop = refineDesktopSvg(desktopSkeleton(), metaFixture());
  const mobile = refineMobileSvg(mobileSkeleton(), metaFixture());

  for (const svg of [desktop, mobile]) {
    assert.doesNotMatch(svg, /class="lens-panel"/);
    assert.doesNotMatch(svg, /class="metric-panel"/);
    assert.match(svg, /DAY STREAK/);
    assert.match(svg, /25 \/ 28 ACTIVE/);
    assert.match(svg, /CAIRN \+ SPINE/);
    assert.match(svg, /OF 4-WEEK ACTIVITY/);
    assert.doesNotMatch(svg, /CURRENT STREAK/);
    assert.doesNotMatch(svg, /MERGE DAYS/);
    assert.doesNotMatch(svg, /TOP 2 REPOS/);
    assert.doesNotMatch(svg, />OPEN</);
  }
});

test("clips a flush, exact lower-third model band into every rounded cell", () => {
  const desktop = refineDesktopSvg(desktopSkeleton(), metaFixture());
  const mobile = refineMobileSvg(mobileSkeleton(), metaFixture());

  for (const svg of [desktop, mobile]) {
    assert.match(
      svg,
      /<clipPath id="focus-cell-2026-07-13" clipPathUnits="userSpaceOnUse">/,
    );
    assert.match(
      svg,
      /<g class="family-band" data-family-band="true" clip-path="url\(#focus-cell-2026-07-13\)">/,
    );
    assert.match(svg, /class="lens-cell-outline"/);
  }

  assert.match(
    desktop,
    /<rect class="family-claude" x="106" y="330" width="[^"]+" height="8"\/>/,
  );
  assert.match(
    mobile,
    /<rect class="family-claude" x="80" y="342" width="[^"]+" height="13"\/>/,
  );
});

test("refinement is idempotent for scheduled and local reruns", () => {
  const once = refineDesktopSvg(desktopSkeleton(), metaFixture());
  const twice = refineDesktopSvg(once, metaFixture());

  assert.equal((twice.match(/profile-detail:start/g) || []).length, 1);
  assert.equal((twice.match(/profile-refinement:start/g) || []).length, 1);
  assert.equal(twice, once);
});

test("writes clarified metrics and drops merge-day metadata", () => {
  const meta = updateMeta(metaFixture());

  assert.equal(meta.metrics.streak, 18);
  assert.equal(meta.metrics.activeDays, 25);
  assert.deepEqual(meta.metrics.topRepos, ["CAIRN", "SPINE"]);
  assert.equal("mergeDays" in meta.metrics, false);
});
