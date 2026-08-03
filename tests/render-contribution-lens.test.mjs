import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMeta,
  buildViewModel,
  normalizeGithub,
  normalizeTokscale,
  renderDesktopSvg,
  renderMobileSvg,
} from "../scripts/render-contribution-lens.mjs";

function addDays(value, days) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function fixture() {
  const end = "2026-08-03";
  const start = addDays(end, -370);
  const days = Array.from({ length: 371 }, (_, index) => {
    const date = addDays(start, index);
    const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
    const pulse = (index * 7 + weekday * 3) % 17;
    const count = weekday === 0 || weekday === 6 ? (pulse > 13 ? 2 : 0) : pulse > 12 ? 12 : pulse > 8 ? 7 : pulse > 3 ? 3 : 0;
    return { date, count };
  });

  const focusStart = "2026-07-13";
  const repos = ["openspine", "mag", "openspine", "rive-rs-cli"];
  const commits = [];
  const merges = [];
  const reviews = [];
  const contributions = [];

  for (let index = 0; index < 28; index += 1) {
    const date = addDays(focusStart, index);
    const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
    if (weekday !== 0 && weekday !== 6) {
      const repo = repos[Math.floor(index / 7) % repos.length];
      commits.push({ date, repo, count: 2 + (index % 5) });
      if (index % 4 === 0) merges.push({ date, repo });
      else if (index % 3 === 0) reviews.push({ date, repo });
      contributions.push({
        date,
        clients: [
          {
            models: {
              "gpt-5.6-sol": { tokens: 100 + index * 3 },
              "claude-opus-5": { tokens: index % 2 ? 80 : 35 },
              "gemini-3.6-flash": { tokens: index % 5 === 0 ? 30 : 0 },
            },
          },
        ],
      });
    }
  }

  return {
    github: { days, commits, merges, reviews, totalContributions: days.reduce((sum, day) => sum + day.count, 0) },
    tokscale: { contributions },
    now: new Date("2026-08-03T12:00:00.000Z"),
  };
}

test("renders one year overview and a 28-day lens without invalid values", () => {
  const data = fixture();
  const view = buildViewModel({
    github: normalizeGithub(data.github),
    tokscale: normalizeTokscale(data.tokscale),
    username: "George-RD",
    now: data.now,
  });
  const desktop = renderDesktopSvg(view);
  const mobile = renderMobileSvg(view);

  assert.equal((desktop.match(/class="overview-cell/g) || []).length, 371);
  assert.equal((desktop.match(/class="lens-cell/g) || []).length, 28);
  assert.equal((mobile.match(/class="overview-cell/g) || []).length, 371);
  assert.equal((mobile.match(/class="lens-cell/g) || []).length, 28);
  assert.ok(!/NaN|undefined|nullpx/.test(desktop));
  assert.ok(!/NaN|undefined|nullpx/.test(mobile));
  assert.match(desktop, /BUILD CADENCE/);
  assert.match(desktop, /OPEN/);
  assert.match(desktop, /family-claude/);
  assert.match(desktop, /family-gpt/);
});

test("meta retains grounded focus dates and summary values", () => {
  const data = fixture();
  const view = buildViewModel({
    github: normalizeGithub(data.github),
    tokscale: normalizeTokscale(data.tokscale),
    username: "George-RD",
    now: data.now,
  });
  const meta = buildMeta(view);

  assert.equal(meta.range.focusStart, "2026-07-13");
  assert.equal(meta.range.focusEnd, "2026-08-09");
  assert.equal(meta.focus.length, 28);
  assert.ok(meta.metrics.activeDays > 0);
  assert.ok(meta.metrics.mergeDays > 0);
  assert.ok(meta.metrics.focusShare > 0 && meta.metrics.focusShare <= 1);
});
