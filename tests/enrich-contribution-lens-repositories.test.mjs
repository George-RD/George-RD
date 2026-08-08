import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRepositoryActivityByDate,
  enrichMeta,
} from "../scripts/enrich-contribution-lens-repositories.mjs";

function fixture() {
  return {
    user: {
      contributionsCollection: {
        commitContributionsByRepository: [
          {
            repository: { name: "mag", nameWithOwner: "George-RD/mag", isPrivate: false },
            contributions: {
              nodes: [
                { occurredAt: "2026-08-06T10:00:00Z", commitCount: 6 },
                { occurredAt: "2026-08-07T10:00:00Z", commitCount: 2 },
              ],
            },
          },
          {
            repository: { name: "secret-app", nameWithOwner: "George-RD/secret-app", isPrivate: true },
            contributions: {
              nodes: [{ occurredAt: "2026-08-06T13:00:00Z", commitCount: 4 }],
            },
          },
        ],
        pullRequestReviewContributions: {
          nodes: [
            {
              occurredAt: "2026-08-06T14:00:00Z",
              pullRequest: {
                repository: { name: "rive-rs-cli", nameWithOwner: "George-RD/rive-rs-cli", isPrivate: false },
              },
            },
          ],
        },
      },
    },
    search: {
      nodes: [
        {
          mergedAt: "2026-08-06T15:00:00Z",
          repository: { name: "rive-rs-cli", nameWithOwner: "George-RD/rive-rs-cli", isPrivate: false },
        },
      ],
    },
  };
}

test("buildRepositoryActivityByDate applies the existing weights and hides private names", () => {
  const activity = buildRepositoryActivityByDate(fixture());
  const repositories = activity.get("2026-08-06");

  assert.deepEqual(
    repositories.map(({ name, score, commits, merges, reviews }) => ({
      name,
      score,
      commits,
      merges,
      reviews,
    })),
    [
      { name: "mag", score: 6, commits: 6, merges: 0, reviews: 0 },
      { name: "private", score: 4, commits: 4, merges: 0, reviews: 0 },
      { name: "rive-rs-cli", score: 2.5, commits: 0, merges: 1, reviews: 1 },
    ],
  );
  assert.equal(repositories[0].share, 6 / 12.5);
  assert.equal(repositories.some((repository) => repository.name === "secret-app"), false);
});

test("enrichMeta adds daily repository shares and recalculates the latest 14-day focus", () => {
  const focus = Array.from({ length: 16 }, (_, index) => ({
    date: `2026-07-${String(23 + index).padStart(2, "0")}`,
    contributions: index + 1,
    repository: null,
    modelFamilies: {},
  }));
  focus[9].date = "2026-08-01";
  focus[10].date = "2026-08-02";
  focus[11].date = "2026-08-03";
  focus[12].date = "2026-08-04";
  focus[13].date = "2026-08-05";
  focus[14].date = "2026-08-06";
  focus[15].date = "2026-08-07";

  const meta = enrichMeta(
    {
      generatedAt: "2026-08-07T18:00:00Z",
      range: { focusStart: "2026-07-23", focusEnd: "2026-08-07" },
      metrics: { mergeDays: 2 },
      focus,
    },
    buildRepositoryActivityByDate(fixture()),
  );

  const day = meta.focus.find((entry) => entry.date === "2026-08-06");
  assert.equal(day.repository, "mag");
  assert.equal(day.repositories.length, 3);
  assert.equal(meta.metrics.focusDays, 14);
  assert.equal(meta.metrics.activeDays, 14);
  assert.deepEqual(meta.metrics.topRepos, ["mag", "private"]);
  assert.equal("mergeDays" in meta.metrics, false);
  assert.equal(meta.range.focusStart, "2026-07-25");
  assert.equal(meta.range.focusEnd, "2026-08-07");
});
