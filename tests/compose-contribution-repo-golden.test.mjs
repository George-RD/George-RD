import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateHiddenRepositories,
  composeSvg,
  layoutGoldenField,
  repositoriesForDay,
} from "../scripts/optimize-contribution-repo-golden.mjs";

function repositories(scores = [70, 45, 15, 12, 8], names = []) {
  const defaults = [
    "cairn",
    "hologlyph",
    "rive-rs-cli",
    "design-studio",
    "mag",
    "growth-arsenal",
    "george-rd",
    "cli-anything-meerk40t",
    "private",
    "openspine",
  ];
  const total = scores.reduce((sum, score) => sum + score, 0);
  return scores.map((score, index) => ({
    name: names[index] || defaults[index] || `repo-${index}`,
    score,
    share: score / total,
  }));
}

function overlaps(left, right, margin = 2.5) {
  return !(
    left.right + margin <= right.left ||
    right.right + margin <= left.left ||
    left.bottom + margin <= right.top ||
    right.bottom + margin <= left.top
  );
}

test("a single repository uses the interior instead of the top edge", () => {
  const normalized = repositoriesForDay({ repositories: repositories([100]) });
  const layout = layoutGoldenField(normalized, 112, false, 390);

  assert.equal(layout.entries.length, 1);
  const entry = layout.entries[0];
  assert.ok(entry.x > 8);
  assert.ok(entry.y > layout.fieldTop + layout.fieldHeight * 0.3);
  assert.ok(entry.y < layout.fieldTop + layout.fieldHeight * 0.82);
});

test("five normal repositories remain individually visible", () => {
  const normalized = repositoriesForDay({ repositories: repositories() });
  const layout = layoutGoldenField(normalized, 112, false, 390);

  assert.equal(layout.hiddenCount, 0);
  assert.equal(layout.visibleCount, 5);
  assert.equal(layout.entries.length, 5);
  assert.ok(layout.visibleShare > 0.999);
});

test("adaptive density exposes more than three repositories in a busy day", () => {
  const scores = [90, 58, 42, 31, 24, 18, 12, 9];
  const normalized = repositoriesForDay({ repositories: repositories(scores) });
  const layout = layoutGoldenField(normalized, 112, false, 390);

  assert.ok(layout.visibleCount >= 5, `only ${layout.visibleCount} visible`);
  assert.ok(layout.visibleShare >= 0.82, `coverage ${layout.visibleShare}`);
  assert.equal(
    layout.entries.some((entry) => entry.className === "repo-more"),
    layout.hiddenCount > 0,
  );
});

test("adaptive density uses space without overlap", () => {
  const scores = [90, 58, 42, 31, 24, 18, 12];
  const normalized = repositoriesForDay({ repositories: repositories(scores) });
  const layout = layoutGoldenField(normalized, 112, false, 390);

  assert.ok(new Set(layout.entries.map((entry) => Math.round(entry.x))).size >= 3);
  assert.ok(new Set(layout.entries.map((entry) => Math.round(entry.y))).size >= 3);

  for (let left = 0; left < layout.entries.length; left += 1) {
    for (let right = left + 1; right < layout.entries.length; right += 1) {
      assert.equal(
        overlaps(layout.entries[left].box, layout.entries[right].box),
        false,
        `${layout.entries[left].label} overlaps ${layout.entries[right].label}`,
      );
    }
  }
});

test("overflow is aggregated only after individual labels cannot be placed", () => {
  const raw = Array.from({ length: 14 }, (_, index) => ({
    name: `repository-${index}`,
    score: 100 - index * 4,
    share: 1 / 14,
  }));
  const normalized = repositoriesForDay({ repositories: raw });
  const layout = layoutGoldenField(normalized, 62, false, 390);
  const aggregate = layout.entries.find(
    (entry) => entry.className === "repo-more",
  );

  assert.ok(layout.hiddenCount > 0);
  assert.ok(layout.visibleCount >= 2);
  assert.ok(aggregate);
  assert.equal(aggregate.aggregateCount, layout.hiddenCount);
  assert.deepEqual(
    aggregateHiddenRepositories(normalized, layout.visibleCount),
    {
      count: layout.hiddenCount,
      score: aggregate.score,
      share: aggregate.share,
      relative: aggregate.relative,
    },
  );
});

function fixtureSvg() {
  return `<svg><style>.x{}</style>
  <text>TYPE SIZE = DAILY REPO SHARE</text>
  <text>TYPE SIZE = DAILY REPO SHARE · +N = OVERFLOW · RULE = ACTIVITY</text>
  <g class="recent-day" data-recent-day="2026-07-26"><title>day</title><g class="day-date-stack"><text class="day-stack-weekday">SUN</text><text class="day-stack-number">26</text><text class="day-stack-month">JUL</text></g><g class="repo-golden-field" data-layout="golden"><text class="dominant-repo">CAIRN</text></g><g class="model-band"><rect class="model-band-base" x="58" y="390" width="145" height="7"/></g></g>
  </g>
  <!-- profile-detail:end -->
</svg>`;
}

test("composeSvg replaces the conservative golden field", () => {
  const svg = composeSvg(fixtureSvg(), {
    focus: [
      {
        date: "2026-07-26",
        contributions: 100,
        repositories: repositories(),
      },
    ],
  });

  assert.match(svg, /class="repo-golden-field"/);
  assert.match(svg, /data-layout="golden-adaptive"/);
  assert.match(svg, /data-visible-repos="5"/);
  assert.doesNotMatch(svg, /data-layout="golden"/);
  assert.match(svg, /class="day-stack-weekday"[^>]*>SUN/);
  assert.match(svg, /\+N ONLY WHEN SPACE RUNS OUT/);
  assert.doesNotMatch(
    svg,
    /text-anchor="end"[^>]*class="(?:dominant-repo|secondary-repo|repo-more)"/,
  );
});

test("composeSvg is idempotent", () => {
  const meta = {
    focus: [
      {
        date: "2026-07-26",
        contributions: 100,
        repositories: repositories(),
      },
    ],
  };
  const once = composeSvg(fixtureSvg(), meta);
  const twice = composeSvg(once, meta);

  assert.equal((twice.match(/data-layout="golden-adaptive"/g) || []).length, 1);
  assert.equal(twice, once);
});
