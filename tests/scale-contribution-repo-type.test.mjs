import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateHiddenRepositories,
  fontSizeForRelativeScore,
  fontSizeForShare,
  layoutRepositoryFlow,
  repositoriesForDay,
  scaleSvg,
} from "../scripts/scale-contribution-repo-type.mjs";

function fixtureSvg({ mobile = false, width } = {}) {
  const resolvedWidth = width ?? (mobile ? 322 : 145);
  const x = mobile ? 32 : 58;
  return `<svg viewBox="0 0 ${mobile ? 720 : 1200} ${mobile ? 900 : 610}"><style>.dominant-repo{font-size:19px}.secondary-repos{font-size:8px}</style>
  <text>2×2 TYPE FIELD · +N = HIDDEN SHARE · RULE = ACTIVITY</text>
  <g class="recent-day" data-recent-day="2026-07-26"><title>day</title><text class="day-date" x="${x}" y="320">SUN 26 JUL</text><text class="day-contributions" x="${x + resolvedWidth}" y="320" text-anchor="end">100</text><g class="repo-type-field"><text class="dominant-repo" x="${x + 31}" y="350">CAIRN</text><text class="secondary-repo" x="${x + resolvedWidth}" y="330">HOLO</text><text class="repo-more" x="${x + resolvedWidth}" y="375">+2 MORE</text></g><g class="model-band" data-model-band="day"><rect class="model-band-base" x="${x}" y="390" width="${resolvedWidth}" height="7"/></g><line class="activity-track" x1="${x}" y1="405" x2="${x + resolvedWidth}" y2="405"/></g>
  </g>
  <!-- profile-detail:end -->
</svg>`;
}

function baseRepositories() {
  const scores = [70, 45, 15, 12, 8];
  const names = ["cairn", "hologlyph", "rive-rs-cli", "design-studio", "mag"];
  const total = scores.reduce((sum, score) => sum + score, 0);
  return scores.map((score, index) => ({
    name: names[index],
    score,
    share: score / total,
  }));
}

function fixtureMeta(repositories = baseRepositories()) {
  return {
    focus: [
      {
        date: "2026-07-26",
        contributions: 100,
        repositories,
      },
    ],
  };
}

test("font sizing keeps the within-day hierarchy", () => {
  const dominant = fontSizeForShare("CAIRN", 0.47, {
    min: 17,
    max: 24,
    maxWidth: 112,
    widthFactor: 0.61,
  });
  const second = fontSizeForRelativeScore("HOLO", 45, 70, {
    min: 8.5,
    max: 19.5,
    maxWidth: 112,
    widthFactor: 0.62,
  });
  const third = fontSizeForRelativeScore("RIVE", 15, 70, {
    min: 8.5,
    max: 19.5,
    maxWidth: 112,
    widthFactor: 0.62,
  });

  assert.ok(dominant > second);
  assert.ok(second > third);
});

test("aggregateHiddenRepositories can aggregate from any visible count", () => {
  const repositories = baseRepositories();
  assert.deepEqual(aggregateHiddenRepositories(repositories, 3), {
    count: 2,
    score: 20,
    share: 20 / 150,
    relative: 20 / 70,
  });
  assert.deepEqual(aggregateHiddenRepositories(repositories, 5), {
    count: 0,
    score: 0,
    share: 0,
    relative: 0,
  });
});

test("layoutRepositoryFlow shows every repository when the field has room", () => {
  const repositories = repositoriesForDay({ repositories: baseRepositories() });
  const layout = layoutRepositoryFlow(repositories, 112, false, 390);

  assert.equal(layout.hiddenCount, 0);
  assert.equal(layout.entries.length, 5);
  assert.deepEqual(layout.entries.map((entry) => entry.label), [
    "CAIRN",
    "HOLO",
    "RIVE",
    "DESIGN",
    "MAG",
  ]);
  assert.ok(layout.entries.every((entry) => entry.x >= 0));
});

test("layoutRepositoryFlow aggregates only the repositories that cannot fit", () => {
  const raw = [
    ...baseRepositories(),
    { name: "growth-arsenal", score: 7 },
    { name: "george-rd", score: 6 },
    { name: "cli-anything-meerk40t", score: 5 },
    { name: "private", score: 5 },
  ];
  const total = raw.reduce((sum, repository) => sum + repository.score, 0);
  const repositories = repositoriesForDay({
    repositories: raw.map((repository) => ({
      ...repository,
      share: repository.score / total,
    })),
  });
  const layout = layoutRepositoryFlow(repositories, 64, false, 390);
  const aggregate = layout.entries.find((entry) => entry.className === "repo-more");

  assert.ok(layout.hiddenCount > 0);
  assert.ok(aggregate);
  assert.equal(aggregate.aggregateCount, layout.hiddenCount);
  assert.equal(
    aggregate.score,
    repositories
      .slice(repositories.length - layout.hiddenCount)
      .reduce((sum, repository) => sum + repository.score, 0),
  );
});

test("scaleSvg uses one left-aligned flow and hides nothing when all names fit", () => {
  const svg = scaleSvg(fixtureSvg(), fixtureMeta());

  assert.match(svg, /class="day-stack-weekday"[^>]*>SUN</);
  assert.match(svg, /class="day-stack-number"[^>]*>26</);
  assert.match(svg, /class="day-stack-month"[^>]*>JUL</);
  assert.match(svg, /class="day-stack-count"[^>]*>100</);
  assert.match(svg, /class="repo-type-flow" data-visible-repos="5" data-hidden-repos="0"/);
  assert.match(svg, /class="dominant-repo" data-row="0" data-order="0"[^>]*>CAIRN/);
  assert.match(svg, /class="secondary-repo"[^>]*>HOLO/);
  assert.match(svg, /class="secondary-repo"[^>]*>RIVE/);
  assert.match(svg, /class="secondary-repo"[^>]*>DESIGN/);
  assert.match(svg, /class="secondary-repo"[^>]*>MAG/);
  assert.doesNotMatch(svg, /class="repo-more"/);
  assert.doesNotMatch(svg, /text-anchor="end"[^>]*>(?:HOLO|RIVE|DESIGN|MAG)/);
  assert.doesNotMatch(svg, /class="repo-type-field"/);
  assert.match(svg, /LEFT FLOW · \+N ONLY WHEN SPACE RUNS OUT/);
});

test("scaleSvg creates a scored +N label only when names overflow", () => {
  const extra = [
    { name: "growth-arsenal", score: 7 },
    { name: "george-rd", score: 6 },
    { name: "cli-anything-meerk40t", score: 5 },
    { name: "private", score: 5 },
  ];
  const raw = [...baseRepositories(), ...extra];
  const total = raw.reduce((sum, repository) => sum + repository.score, 0);
  const repositories = raw.map((repository) => ({
    ...repository,
    share: repository.score / total,
  }));
  const svg = scaleSvg(fixtureSvg({ width: 95 }), fixtureMeta(repositories));
  const flow = svg.match(
    /class="repo-type-flow" data-visible-repos="([0-9]+)" data-hidden-repos="([0-9]+)"/,
  );
  const aggregate = svg.match(
    /class="repo-more"[^>]*data-score="([0-9.]+)"[^>]*data-aggregate-count="([0-9]+)"/,
  );

  assert.ok(flow);
  assert.ok(Number(flow[2]) > 0);
  assert.ok(aggregate);
  assert.equal(Number(aggregate[2]), Number(flow[2]));
});

test("scaleSvg remains idempotent", () => {
  const once = scaleSvg(fixtureSvg(), fixtureMeta());
  const twice = scaleSvg(once, fixtureMeta());

  assert.equal((twice.match(/repo-type-scale:start/g) || []).length, 1);
  assert.equal(twice, once);
});
