import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateHiddenRepositories,
  composeSvg,
  layoutGoldenField,
  repositoriesForDay,
} from "../scripts/compose-contribution-repo-golden.mjs";

function repositories(scores = [70, 45, 15, 12, 8]) {
  const names = [
    "cairn",
    "hologlyph",
    "rive-rs-cli",
    "design-studio",
    "mag",
  ];
  const total = scores.reduce((sum, score) => sum + score, 0);
  return scores.map((score, index) => ({
    name: names[index] || `repo-${index}`,
    score,
    share: score / total,
  }));
}

function overlaps(left, right, margin = 3) {
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
  assert.ok(entry.y > layout.fieldTop + layout.fieldHeight * 0.35);
  assert.ok(entry.y < layout.fieldTop + layout.fieldHeight * 0.8);
});

test("multiple repositories occupy varied golden-section anchors without overlap", () => {
  const normalized = repositoriesForDay({ repositories: repositories() });
  const layout = layoutGoldenField(normalized, 112, false, 390);

  assert.equal(layout.hiddenCount, 0);
  assert.equal(layout.entries.length, 5);
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
  const raw = Array.from({ length: 12 }, (_, index) => ({
    name: `repo-${index}`,
    score: 100 - index * 4,
    share: 1 / 12,
  }));
  const normalized = repositoriesForDay({ repositories: raw });
  const layout = layoutGoldenField(normalized, 62, false, 390);
  const aggregate = layout.entries.find(
    (entry) => entry.className === "repo-more",
  );

  assert.ok(layout.hiddenCount > 0);
  assert.ok(aggregate);
  assert.equal(aggregate.aggregateCount, layout.hiddenCount);
  assert.deepEqual(
    aggregateHiddenRepositories(
      normalized,
      normalized.length - layout.hiddenCount,
    ),
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
  <text>DATE RAIL · TYPE SIZE = SHARE WITHIN DAY</text>
  <text>LEFT FLOW · +N ONLY WHEN SPACE RUNS OUT · RULE = ACTIVITY</text>
  <g class="recent-day" data-recent-day="2026-07-26"><title>day</title><g class="day-date-stack"><text class="day-stack-weekday">SUN</text><text class="day-stack-count">100</text><text class="day-stack-number">26</text><text class="day-stack-month">JUL</text></g><g class="repo-type-flow"><text class="dominant-repo">CAIRN</text></g><g class="model-band"><rect class="model-band-base" x="58" y="390" width="145" height="7"/></g></g>
  </g>
  <!-- profile-detail:end -->
</svg>`;
}

test("composeSvg removes the visible count and replaces the row flow", () => {
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
  assert.match(svg, /data-layout="golden"/);
  assert.doesNotMatch(svg, /class="repo-type-flow"/);
  assert.doesNotMatch(svg, /class="day-stack-count"/);
  assert.match(svg, /class="day-stack-weekday"[^>]*>SUN/);
  assert.match(svg, /TYPE SIZE = DAILY REPO SHARE/);
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

  assert.equal((twice.match(/repo-golden-field:start/g) || []).length, 1);
  assert.equal(twice, once);
});
