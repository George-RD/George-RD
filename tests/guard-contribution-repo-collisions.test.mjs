import assert from "node:assert/strict";
import test from "node:test";

import {
  collisionsForSvg,
  guardMobileSvg,
} from "../scripts/guard-contribution-repo-collisions.mjs";

function fixtureSvg({ overlapping = true } = {}) {
  const meerX = overlapping ? 184 : 226;
  return `<svg viewBox="0 0 720 900"><style>.x{}</style>
  <g class="recent-day" data-recent-day="2026-07-28"><title>day</title><g class="repo-golden-field" data-visible-repos="5" data-hidden-repos="0" data-layout="golden-adaptive"><text class="dominant-repo" data-order="0" x="96" y="101" data-score="90" data-share="0.45" style="font-size:22px">GROWTH</text><text class="secondary-repo" data-order="1" x="${meerX}" y="102" data-score="42" data-share="0.21" style="font-size:14px">MEER</text><text class="secondary-repo" data-order="2" x="126" y="122" data-score="30" data-share="0.15" style="font-size:12px">HOLO</text></g><g class="model-band" data-model-band="day"><rect class="model-band-base" x="58" y="130" width="296" height="7"/></g></g>
  </g>
  <!-- profile-detail:end -->
</svg>`;
}

test("guard resolves a mobile collision caused by rendered text being wider than the estimate", () => {
  const source = fixtureSvg();
  assert.equal(collisionsForSvg(source).length, 1);

  const guarded = guardMobileSvg(source);
  assert.equal(collisionsForSvg(guarded).length, 0);
  assert.match(guarded, /data-collision-guard="mobile-safe"/);
  assert.match(guarded, />GROWTH</);
  assert.match(guarded, />MEER</);
  assert.match(guarded, />HOLO</);
});

test("guard preserves an already safe mobile arrangement", () => {
  const source = fixtureSvg({ overlapping: false });
  const guarded = guardMobileSvg(source);

  assert.equal(collisionsForSvg(source).length, 0);
  assert.equal(collisionsForSvg(guarded).length, 0);
  assert.match(guarded, /class="dominant-repo"[^>]*x="96"[^>]*y="101"/);
  assert.match(guarded, /class="secondary-repo"[^>]*x="226"[^>]*y="102"/);
});

test("guard is idempotent", () => {
  const once = guardMobileSvg(fixtureSvg());
  const twice = guardMobileSvg(once);

  assert.equal(twice, once);
  assert.equal((twice.match(/data-collision-guard="mobile-safe"/g) || []).length, 1);
});
