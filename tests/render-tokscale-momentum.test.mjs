import assert from "node:assert/strict";
import test from "node:test";

import {
  buildModelMomentum,
  latestModelActivityDate,
  renderMomentumSvg,
  serializeMomentum,
} from "../scripts/render-tokscale-momentum.mjs";

function profileFixture() {
  return {
    updatedAt: "2026-07-30T19:28:31.460Z",
    dateRange: { start: "2026-07-09", end: "2026-08-07" },
    contributions: [
      {
        date: "2026-07-17",
        clients: [
          {
            models: {
              "gpt-5.6-sol": { tokens: 100 },
              "grok-4.5": { tokens: 5 },
            },
          },
        ],
      },
      {
        date: "2026-07-24",
        clients: [
          {
            models: {
              "gpt-5.6-sol": { tokens: 200 },
              "claude-opus-5": { tokens: 50 },
            },
          },
        ],
      },
      {
        date: "2026-07-30",
        clients: [
          {
            models: {
              "gpt-5.6-sol": { tokens: 300 },
              "claude-opus-5": { tokens: 100 },
            },
          },
        ],
      },
      { date: "2026-08-01", clients: [] },
      { date: "2026-08-07", clients: [] },
    ],
  };
}

test("anchors the comparison window to the latest day with model data", () => {
  const profile = profileFixture();
  const momentum = buildModelMomentum(profile, 5);

  assert.equal(latestModelActivityDate(profile), "2026-07-30");
  assert.equal(momentum.dataThrough, "2026-07-30");
  assert.equal(momentum.dates.at(-1), "2026-07-30");
  assert.equal(momentum.dates[momentum.recentStart], "2026-07-24");
  assert.equal(momentum.totalRecent, 650);
  assert.equal(momentum.leading?.model, "gpt-5.6-sol");
  assert.notEqual(momentum.leading?.model, "grok-4.5");
  assert.ok(momentum.rows.every((row) => row.recentTokens > 0));
});

test("renders honest data-through dates instead of a zero-filled current week", () => {
  const momentum = buildModelMomentum(profileFixture(), 5);
  const svg = renderMomentumSvg({
    momentum,
    username: "George-RD",
    generatedAt: new Date("2026-08-07T05:01:47.000Z"),
  });
  const meta = serializeMomentum(momentum, new Date("2026-08-07T05:01:47.000Z"));

  assert.match(svg, /DATA THROUGH 30 JUL \/ GENERATED 07 AUG/);
  assert.match(svg, /24 JUL — 30 JUL/);
  assert.match(svg, /gpt-5\.6-sol/);
  assert.doesNotMatch(svg, />grok-4\.5<\/text>\s*<\/g>/);
  assert.equal(meta.latestWindow.end, "2026-07-30");
  assert.equal(meta.leadingModel, "gpt-5.6-sol");
});
