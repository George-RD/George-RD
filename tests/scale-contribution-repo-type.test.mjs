import assert from "node:assert/strict";
import test from "node:test";

import {
  fontSizeForShare,
  scaleSvg,
} from "../scripts/scale-contribution-repo-type.mjs";

function fixtureSvg({ mobile = false, narrow = false } = {}) {
  const width = narrow ? 46 : mobile ? 322 : 145;
  const x = mobile ? 114 : 58;
  return `<svg viewBox="0 0 ${mobile ? 720 : 1200} ${mobile ? 900 : 610}"><style>.dominant-repo{font-size:19px}.secondary-repos{font-size:8px}</style>
  <text>REPOS RANKED BY GITHUB ACTIVITY</text>
  <text>TYPE WEIGHT = REPO RANK · RULE LENGTH = GITHUB ACTIVITY</text>
  <g class="recent-day" data-recent-day="2026-08-07"><title>day</title><text class="dominant-repo" x="${x}" y="350">CAIRN</text><text class="secondary-repos" x="${x}" y="372">MAG · RIVE</text><text class="repo-more" x="${x}" y="386">+1 MORE</text><g class="model-band" data-model-band="day"><rect class="model-band-base" x="${x}" y="390" width="${width}" height="7"/></g></g>
  </g>
  <!-- profile-detail:end -->
</svg>`;
}

function fixtureMeta() {
  return {
    focus: [
      {
        date: "2026-08-07",
        contributions: 100,
        repositories: [
          { name: "cairn", score: 70, share: 0.7 },
          { name: "mag", score: 20, share: 0.2 },
          { name: "rive-rs-cli", score: 8, share: 0.08 },
          { name: "design-studio", score: 2, share: 0.02 },
        ],
      },
    ],
  };
}

test("fontSizeForShare follows share while respecting the width cap", () => {
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

test("scaleSvg sizes each visible repository from its daily share", () => {
  const svg = scaleSvg(fixtureSvg(), fixtureMeta());

  assert.match(
    svg,
    /class="dominant-repo"[^>]*data-share="0.7"[^>]*font-size:21.6px[^>]*>CAIRN/,
  );
  assert.match(
    svg,
    /class="secondary-repo"[^>]*data-share="0.2"[^>]*font-size:8.5px[^>]*>MAG/,
  );
  assert.match(
    svg,
    /class="secondary-repo"[^>]*data-share="0.08"[^>]*font-size:7.9px[^>]*>RIVE/,
  );
  assert.match(svg, /class="secondary-separator"/);
  assert.match(svg, /\+1 MORE/);
  assert.doesNotMatch(svg, /class="secondary-repos"/);
  assert.match(svg, /REPO TYPE SIZE = SHARE OF THAT DAY/);
  assert.match(svg, /TYPE SIZE = DAILY REPO SHARE/);
});

test("scaleSvg constrains a dominant label to the available column width", () => {
  const meta = fixtureMeta();
  meta.focus[0].repositories[0] = {
    name: "george-rd",
    score: 98,
    share: 0.98,
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
