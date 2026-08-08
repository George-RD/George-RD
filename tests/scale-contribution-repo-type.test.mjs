import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateHiddenRepositories,
  fontSizeForRelativeScore,
  fontSizeForShare,
  scaleSvg,
} from "../scripts/scale-contribution-repo-type.mjs";

function fixtureSvg({ mobile = false, narrow = false } = {}) {
  const width = narrow ? 46 : mobile ? 322 : 145;
  const x = mobile ? 32 : 58;
  return `<svg viewBox="0 0 ${mobile ? 720 : 1200} ${mobile ? 900 : 610}"><style>.dominant-repo{font-size:19px}.secondary-repos{font-size:8px}</style>
  <text>REPOS RANKED BY GITHUB ACTIVITY</text>
  <text>TYPE SIZE = REPO SHARE WITHIN DAY · RULE = GITHUB ACTIVITY</text>
  <g class="recent-day" data-recent-day="2026-07-26"><title>day</title><text class="day-date" x="${x}" y="313">SUN 26 JUL</text><text class="day-contributions" x="${x + width}" y="313">100</text><text class="dominant-repo" x="${x}" y="350">CAIRN</text><text class="secondary-repos" x="${x}" y="372">MAG · RIVE</text><text class="repo-more" x="${x}" y="386">+2 MORE</text><g class="model-band" data-model-band="day"><rect class="model-band-base" x="${x}" y="390" width="${width}" height="7"/></g></g>
  </g>
  <!-- profile-detail:end -->
</svg>`;
}

function fixtureMeta() {
  const scores = [70, 35, 14, 10, 6];
  const total = scores.reduce((sum, score) => sum + score, 0);
  return {
    focus: [
      {
        date: "2026-07-26",
        contributions: 100,
        repositories: [
          { name: "cairn", score: 70, share: 70 / total },
          { name: "mag", score: 35, share: 35 / total },
          { name: "rive-rs-cli", score: 14, share: 14 / total },
          { name: "design-studio", score: 10, share: 10 / total },
          { name: "growth-arsenal", score: 6, share: 6 / total },
        ],
      },
    ],
  };
}

function fontSize(svg, label) {
  const match = svg.match(
    new RegExp(`(?:dominant-repo|secondary-repo|repo-more)"[^>]*font-size:([0-9.]+)px[^>]*>${label}<`),
  );
  assert.ok(match, `missing font size for ${label}`);
  return Number(match[1]);
}

test("fontSizeForShare follows absolute daily share while respecting width", () => {
  const small = fontSizeForShare("CAIRN", 0.2, {
    min: 16,
    max: 24,
    maxWidth: 200,
    widthFactor: 0.55,
  });
  const large = fontSizeForShare("CAIRN", 0.8, {
    min: 16,
    max: 24,
    maxWidth: 200,
    widthFactor: 0.55,
  });
  const constrained = fontSizeForShare("PROFILE", 1, {
    min: 16,
    max: 24,
    maxWidth: 46,
    widthFactor: 0.55,
  });

  assert.ok(large > small);
  assert.ok(constrained < 12);
});

test("fontSizeForRelativeScore differentiates repositories within one day", () => {
  const second = fontSizeForRelativeScore("MAG", 35, 70, {
    min: 8,
    max: 20,
    maxWidth: 100,
  });
  const third = fontSizeForRelativeScore("RIVE", 14, 70, {
    min: 8,
    max: 20,
    maxWidth: 100,
  });

  assert.ok(second > third);
});

test("aggregateHiddenRepositories combines all hidden repository activity", () => {
  const repositories = fixtureMeta().focus[0].repositories;
  const aggregate = aggregateHiddenRepositories(repositories);

  assert.equal(aggregate.count, 2);
  assert.equal(aggregate.score, 16);
  assert.equal(aggregate.relative, 16 / 70);
  assert.equal(aggregate.share, 16 / 135);
});

test("scaleSvg stacks the date and gives repository names separate proportional lines", () => {
  const svg = scaleSvg(fixtureSvg(), fixtureMeta());

  assert.match(svg, /class="day-date-stack"/);
  assert.match(svg, /class="day-stack-weekday"[^>]*>SUN</);
  assert.match(svg, /class="day-stack-number"[^>]*>26</);
  assert.match(svg, /class="day-stack-month"[^>]*>JUL</);
  assert.doesNotMatch(svg, />SUN 26 JUL</);

  assert.match(svg, /class="dominant-repo" x="86"/);
  assert.match(svg, /class="secondary-repo"[^>]*data-score="35"[^>]*>MAG</);
  assert.match(svg, /class="secondary-repo"[^>]*data-score="14"[^>]*>RIVE</);
  assert.match(
    svg,
    /class="repo-more"[^>]*data-score="16"[^>]*data-relative="0.2286"[^>]*data-aggregate-count="2"[^>]*>\+2 MORE</,
  );
  assert.ok(fontSize(svg, "MAG") > fontSize(svg, "RIVE"));
  assert.ok(fontSize(svg, "\\+2 MORE") > fontSize(svg, "RIVE"));
  assert.match(svg, /DATE STACK · REPO TYPE = SHARE WITHIN DAY/);
  assert.match(svg, /\+N = HIDDEN SHARE/);
});

test("mobile keeps the date rail while fitting secondary and aggregate labels inline", () => {
  const svg = scaleSvg(fixtureSvg({ mobile: true }), fixtureMeta(), {
    mobile: true,
  });

  assert.match(svg, /class="day-date-stack"/);
  assert.match(svg, /class="dominant-repo" x="74"/);
  assert.match(svg, /class="secondary-separator"/);
  assert.match(svg, /data-aggregate-count="2"/);
});

test("scaleSvg constrains a dominant label to the available repository area", () => {
  const meta = fixtureMeta();
  meta.focus[0].repositories[0] = {
    name: "george-rd",
    score: 120,
    share: 0.8,
  };
  const svg = scaleSvg(fixtureSvg({ narrow: true }), meta);
  const match = svg.match(
    /class="dominant-repo"[^>]*font-size:([0-9.]+)px[^>]*>PROFILE/,
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
