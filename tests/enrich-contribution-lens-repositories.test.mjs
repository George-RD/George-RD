import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRepositoryActivityByDate,
  enrichMeta,
} from "../scripts/enrich-contribution-lens-repositories.mjs";

function addDays(value, days) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function githubFixture() {
  return {
    user: {
      contributionsCollection: {
        commitContributionsByRepository: [
          {
            repository: {
              name: "mag",
              nameWithOwner: "George-RD/mag",
              isPrivate: false,
            },
            contributions: {
              nodes: [
                { occurredAt: "2026-08-06T10:00:00Z", commitCount: 6 },
                { occurredAt: "2026-08-07T10:00:00Z", commitCount: 2 },
              ],
            },
          },
          {
            repository: {
              name: "secret-app",
              nameWithOwner: "George-RD/secret-app",
              isPrivate: true,
            },
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
                repository: {
                  name: "rive-rs-cli",
                  nameWithOwner: "George-RD/rive-rs-cli",
                  isPrivate: false,
                },
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
          repository: {
            name: "rive-rs-cli",
            nameWithOwner: "George-RD/rive-rs-cli",
            isPrivate: false,
          },
        },
      ],
    },
  };
}

test("buildRepositoryActivityByDate keeps the current weights and hides private names", () => {
  const activity = buildRepositoryActivityByDate(githubFixture());
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
  assert.equal(
    repositories.some((repository) => repository.name === "secret-app"),
    false,
  );
});

test("enrichMeta stores repo shares and recalculates the visible 14-day window", () => {
  const focus = Array.from({ length: 16 }, (_, index) => ({
    date: addDays("2026-07-23", index),
    contributions: index + 1,
    repository: null,
    modelFamilies: {},
  }));

  const meta = enrichMeta(
    {
      generatedAt: "2026-08-07T18:00:00Z",
      range: { focusStart: "2026-07-23", focusEnd: "2026-08-07" },
      metrics: { mergeDays: 2 },
      focus,
    },
    buildRepositoryActivityByDate(githubFixture()),
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
