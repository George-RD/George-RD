import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateHiddenRepositories,
  fontSizeForRelativeScore,
  fontSizeForShare,
  scaleSvg,
  slotSplit,
} from "../scripts/scale-contribution-repo-type.mjs";

function fixtureSvg({ mobile = false, narrow = false } = {}) {
  const width = narrow ? 58 : mobile ? 322 : 145;
  const x = mobile ? 32 : 58;
  return `<svg viewBox="0 0 ${mobile ? 720 : 1200} ${mobile ? 900 : 610}"><style>.dominant-repo{font-size:19px}.secondary-repos{font-size:8px}</style>
  <text>DATE STACK · REPO TYPE = SHARE WITHIN DAY</text>
  <text>TYPE SIZE = SHARE · +N = HIDDEN SHARE · RULE = ACTIVITY</text>
  <g class="recent-day" data-recent-day="2026-07-26"><title>day</title><text class="day-date" x="${x}" y="320">SUN 26 JUL</text><text class="day-contributions" x="${x + width}" y="320" text-anchor="end">100</text><text class="dominant-repo" x="${x}" y="350">CAIRN</text><text class="secondary-repos" x="${x}" y="372">MAG · RIVE</text><text class="repo-more" x="${x}" y="386">+2 MORE</text><g class="model-band" data-model-band="day"><rect class="model-band-base" x="${x}" y="390" width="${width}" height="7"/></g><line class="activity-track" x1="${x}" y1="405" x2="${x + width}" y2="405"/></g>
  </g>
  <!-- profile-detail:end -->
</svg>`;
}

function fixtureMeta() {
  return {
    focus: [
      {
        date: "2026-07-26",
        contributions: 100,
        repositories: [
          { name: "cairn", score: 70, share: 70 / 150 },
          { name: "hologlyph", score: 45, share: 45 / 150 },
          { name: "rive-rs-cli", score: 15, share: 15 / 150 },
          { name: "design-studio", score: 12, share: 12 / 150 },
          { name: "mag", score: 8, share: 8 / 150 },
        ],
      },
    ],
  };
}

test("slotSplit allocates both sides while keeping the field stable", () => {
  assert.equal(slotSplit(70, 45, { min: 0.56, max: 0.72 }), 70 / 115);
  assert.equal(slotSplit(100, 1, { min: 0.56, max: 0.72 }), 0.72);
  assert.equal(slotSplit(70, 0), 1);
});

test("font sizing follows share and relative score within width constraints", () => {
  const dominant = fontSizeForShare("CAIRN", 0.7, {
    min: 17,
    max: 25,
    maxWidth: 100,
    widthFactor: 0.55,
  });
  const second = fontSizeForRelativeScore("HOLO", 45, 70, {
    min: 8.5,
    max: 20.5,
    maxWidth: 80,
    widthFactor: 0.57,
  });
  const third = fontSizeForRelativeScore("RIVE", 15, 70, {
    min: 8.5,
    max: 20.5,
    maxWidth: 80,
    widthFactor: 0.57,
  });

  assert.ok(dominant > second);
  assert.ok(second > third);
});

test("aggregate hidden repositories keeps their combined score and share", () => {
  const repositories = fixtureMeta().focus[0].repositories;
  const aggregate = aggregateHiddenRepositories(repositories);

  assert.deepEqual(aggregate, {
    count: 2,
    score: 20,
    share: 20 / 150,
    relative: 20 / 70,
  });
});

test("scaleSvg uses a vertical date rail and a bounded 2x2 repository field", () => {
  const svg = scaleSvg(fixtureSvg(), fixtureMeta());

  assert.match(svg, /class="day-stack-weekday"[^>]*>SUN</);
  assert.match(svg, /class="day-stack-number"[^>]*>26</);
  assert.match(svg, /class="day-stack-month"[^>]*>JUL</);
  assert.match(svg, /class="day-stack-count"[^>]*>100</);
  assert.doesNotMatch(svg, /class="day-contributions"/);

  assert.match(svg, /class="dominant-repo" data-slot="top-left"[^>]*>CAIRN/);
  assert.match(
    svg,
    /class="secondary-repo" data-slot="top-right"[^>]*text-anchor="end"[^>]*>HOLO/,
  );
  assert.match(svg, /class="secondary-repo" data-slot="bottom-left"[^>]*>RIVE/);
  assert.match(
    svg,
    /class="repo-more" data-slot="bottom-right"[^>]*text-anchor="end"[^>]*data-score="20"[^>]*data-aggregate-count="2"[^>]*>\+2 MORE/,
  );
  assert.match(svg, /DATE RAIL · TYPE SIZE = SHARE WITHIN DAY/);
  assert.match(svg, /2×2 TYPE FIELD/);
});

test("aggregate type can be larger than a named third repository", () => {
  const svg = scaleSvg(fixtureSvg(), fixtureMeta());
  const third = svg.match(
    /class="secondary-repo" data-slot="bottom-left"[^>]*font-size:([0-9.]+)px[^>]*>RIVE/,
  );
  const aggregate = svg.match(
    /class="repo-more" data-slot="bottom-right"[^>]*font-size:([0-9.]+)px[^>]*>\+2 MORE/,
  );

  assert.ok(third);
  assert.ok(aggregate);
  assert.ok(Number(aggregate[1]) > Number(third[1]));
});

test("scaleSvg keeps long labels inside a narrow field", () => {
  const meta = fixtureMeta();
  meta.focus[0].repositories[0] = {
    name: "george-rd",
    score: 120,
    share: 0.8,
  };
  const svg = scaleSvg(fixtureSvg({ narrow: true }), meta);
  const match = svg.match(
    /class="dominant-repo" data-slot="top-left"[^>]*font-size:([0-9.]+)px[^>]*>PROFILE/,
  );

  assert.ok(match);
  assert.ok(Number(match[1]) < 12);
});

test("scaleSvg is idempotent", () => {
  const once = scaleSvg(fixtureSvg(), fixtureMeta());
  const twice = scaleSvg(once, fixtureMeta());

  assert.equal((twice.match(/repo-type-scale:start/g) || []).length, 1);
  assert.equal(twice, once);
});
