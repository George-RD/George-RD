#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const GITHUB_GRAPHQL_URL = "https://api.github.com/graphql";
const DISPLAY_DAYS = 14;

function parseArgs(argv) {
  const args = {
    username: process.env.PROFILE_USERNAME || "George-RD",
    meta: "assets/contribution-lens.json",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--username") args.username = argv[++index];
    else if (value === "--meta") args.meta = argv[++index];
    else throw new Error(`Unknown argument: ${value}`);
  }

  return args;
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateKey(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value).slice(0, 10)
    : date.toISOString().slice(0, 10);
}

function isoDateTime(value, endOfDay = false) {
  const key = dateKey(value);
  if (!key) throw new Error(`Invalid date: ${value}`);
  return `${key}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`;
}

function repositoryName(repository) {
  if (!repository) return "";
  if (repository.isPrivate) return "private";
  return repository.name || repository.nameWithOwner || "repository";
}

function addActivity(byDate, date, repository, kind, amount, score) {
  const key = dateKey(date);
  const name = repositoryName(repository);
  if (!key || !name || score <= 0) return;

  const repositories = byDate.get(key) || new Map();
  const activity = repositories.get(name) || {
    name,
    score: 0,
    commits: 0,
    merges: 0,
    reviews: 0,
  };

  activity.score += score;
  activity[kind] += amount;
  repositories.set(name, activity);
  byDate.set(key, repositories);
}

function buildRepositoryActivityByDate(raw) {
  const byDate = new Map();
  const collection = raw?.user?.contributionsCollection;

  for (const repositoryEntry of
    collection?.commitContributionsByRepository || []) {
    for (const contribution of repositoryEntry.contributions?.nodes || []) {
      const commits = number(contribution.commitCount);
      addActivity(
        byDate,
        contribution.occurredAt,
        repositoryEntry.repository,
        "commits",
        commits,
        commits,
      );
    }
  }

  for (const contribution of
    collection?.pullRequestReviewContributions?.nodes || []) {
    addActivity(
      byDate,
      contribution.occurredAt,
      contribution.pullRequest?.repository,
      "reviews",
      1,
      0.5,
    );
  }

  for (const pullRequest of raw?.search?.nodes || []) {
    addActivity(
      byDate,
      pullRequest.mergedAt,
      pullRequest.repository,
      "merges",
      1,
      2,
    );
  }

  const normalized = new Map();
  for (const [date, repositories] of byDate) {
    const entries = [...repositories.values()].sort(
      (left, right) =>
        right.score - left.score || left.name.localeCompare(right.name),
    );
    const total = entries.reduce((sum, repository) => sum + repository.score, 0);
    normalized.set(
      date,
      entries.map((repository) => ({
        ...repository,
        share: total ? repository.score / total : 0,
      })),
    );
  }

  return normalized;
}

function githubQuery() {
  return `
    query ContributionRepoActivity($login: String!, $from: DateTime!, $to: DateTime!, $mergedQuery: String!) {
      user(login: $login) {
        contributionsCollection(from: $from, to: $to) {
          commitContributionsByRepository(maxRepositories: 100) {
            repository {
              name
              nameWithOwner
              isPrivate
            }
            contributions(first: 100) {
              nodes {
                occurredAt
                commitCount
              }
            }
          }
          pullRequestReviewContributions(first: 100) {
            nodes {
              occurredAt
              pullRequest {
                repository {
                  name
                  nameWithOwner
                  isPrivate
                }
              }
            }
          }
        }
      }
      search(query: $mergedQuery, type: ISSUE, first: 100) {
        nodes {
          ... on PullRequest {
            mergedAt
            repository {
              name
              nameWithOwner
              isPrivate
            }
          }
        }
      }
    }
  `;
}

async function fetchGithubRepoActivity({
  username,
  from,
  to,
  token,
  fetchImpl = fetch,
}) {
  if (!token) {
    throw new Error("GITHUB_TOKEN is required to enrich repository activity");
  }

  const response = await fetchImpl(GITHUB_GRAPHQL_URL, {
    method: "POST",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "George-RD-profile-repository-activity/1.0",
    },
    body: JSON.stringify({
      query: githubQuery(),
      variables: {
        login: username,
        from: isoDateTime(from),
        to: isoDateTime(to, true),
        mergedQuery: `author:${username} is:pr is:merged merged:${dateKey(from)}..${dateKey(to)}`,
      },
    }),
  });

  const payload = await response.json();
  if (!response.ok || payload.errors) {
    throw new Error(
      `GitHub repository activity query failed: ${JSON.stringify(payload.errors || payload).slice(0, 600)}`,
    );
  }
  if (!payload.data?.user) throw new Error(`GitHub user not found: ${username}`);
  return payload.data;
}

function enrichMeta(meta, activityByDate) {
  const generatedDate = dateKey(meta?.generatedAt) || dateKey(new Date());
  const focus = [...(meta?.focus || [])].sort((left, right) =>
    String(left.date).localeCompare(String(right.date)),
  );

  const enrichedFocus = focus.map((day) => {
    const repositories = activityByDate.get(dateKey(day.date)) || [];
    return {
      ...day,
      repository: repositories[0]?.name || day.repository || null,
      repositories,
    };
  });

  const elapsed = enrichedFocus.filter(
    (day) => dateKey(day.date) <= generatedDate,
  );
  const recent = elapsed.slice(-DISPLAY_DAYS);
  const repoTotals = new Map();

  for (const day of recent) {
    for (const repository of day.repositories || []) {
      repoTotals.set(
        repository.name,
        number(repoTotals.get(repository.name)) + number(repository.score),
      );
    }
  }

  const sortedRepos = [...repoTotals.entries()].sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
  );
  const repoTotal = sortedRepos.reduce((sum, [, score]) => sum + score, 0);
  const topTwoTotal = sortedRepos
    .slice(0, 2)
    .reduce((sum, [, score]) => sum + score, 0);
  const { mergeDays: _mergeDays, ...existingMetrics } = meta?.metrics || {};

  return {
    ...meta,
    range: {
      ...(meta?.range || {}),
      focusStart: recent[0]?.date || meta?.range?.focusStart || "",
      focusEnd: recent.at(-1)?.date || meta?.range?.focusEnd || "",
    },
    metrics: {
      ...existingMetrics,
      focusDays: DISPLAY_DAYS,
      activeDays: recent.filter((day) => number(day.contributions) > 0).length,
      focusShare: repoTotal ? topTwoTotal / repoTotal : 0,
      topRepos: sortedRepos.slice(0, 2).map(([name]) => name),
    },
    focus: enrichedFocus,
  };
}

async function ensureParent(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const meta = JSON.parse(await fs.readFile(args.meta, "utf8"));
  const sortedFocus = [...(meta.focus || [])].sort((left, right) =>
    String(left.date).localeCompare(String(right.date)),
  );
  const generatedDate = dateKey(meta.generatedAt) || dateKey(new Date());
  const from = sortedFocus[0]?.date || meta?.range?.focusStart;
  const to = generatedDate || sortedFocus.at(-1)?.date || meta?.range?.focusEnd;
  if (!from || !to) throw new Error("Contribution lens metadata has no focus range");

  const raw = await fetchGithubRepoActivity({
    username: args.username,
    from,
    to,
    token: process.env.GITHUB_TOKEN || "",
  });
  const enriched = enrichMeta(meta, buildRepositoryActivityByDate(raw));

  await ensureParent(args.meta);
  await fs.writeFile(args.meta, `${JSON.stringify(enriched, null, 2)}\n`, "utf8");
  console.log(
    `Enriched ${enriched.metrics.focusDays}-day contribution lens with daily repository shares.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

export {
  buildRepositoryActivityByDate,
  enrichMeta,
  fetchGithubRepoActivity,
};
