#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const API_VERSION = "2022-11-28";
const DEFAULT_PER_PAGE = 100;

export function parseArgs(argv) {
  const args = {
    username: "George-RD",
    out: "assets/repository-stars.svg",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];

    if (flag === "--username" && value) {
      args.username = value;
      index += 1;
      continue;
    }

    if (flag === "--out" && value) {
      args.out = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown or incomplete argument: ${flag}`);
  }

  return args;
}

export async function fetchUserRepositories(
  username,
  { token = "", fetchImpl = fetch, perPage = DEFAULT_PER_PAGE } = {},
) {
  const repositories = [];
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": API_VERSION,
    "User-Agent": "George-RD-profile-stars",
  };

  if (token) headers.Authorization = `Bearer ${token}`;

  for (let page = 1; page <= 100; page += 1) {
    const url = new URL(
      `https://api.github.com/users/${encodeURIComponent(username)}/repos`,
    );
    url.searchParams.set("type", "owner");
    url.searchParams.set("sort", "full_name");
    url.searchParams.set("direction", "asc");
    url.searchParams.set("per_page", String(perPage));
    url.searchParams.set("page", String(page));

    const response = await fetchImpl(url, { headers });
    if (!response.ok) {
      const detail = (await response.text()).trim();
      throw new Error(
        `GitHub repositories request failed (${response.status})${detail ? `: ${detail}` : ""}`,
      );
    }

    const batch = await response.json();
    if (!Array.isArray(batch)) {
      throw new Error("GitHub repositories response was not an array.");
    }

    repositories.push(...batch);
    if (batch.length < perPage) return repositories;
  }

  throw new Error("GitHub repositories pagination exceeded 100 pages.");
}

export function summarizeRepositories(repositories, username) {
  const login = username.toLowerCase();
  const ownedPublicSources = repositories.filter((repository) => {
    const owner = String(repository?.owner?.login || "").toLowerCase();
    return owner === login && repository?.private !== true && repository?.fork !== true;
  });

  return {
    repositoryCount: ownedPublicSources.length,
    totalStars: ownedPublicSources.reduce((total, repository) => {
      const stars = Number(repository?.stargazers_count);
      return total + (Number.isFinite(stars) && stars > 0 ? stars : 0);
    }, 0),
  };
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-GB").format(value);
}

export function renderRepositoryStarsSvg({
  username,
  totalStars,
  repositoryCount,
}) {
  const stars = formatNumber(totalStars);
  const repos = formatNumber(repositoryCount);
  const title = `${stars} stars across ${repos} public non-fork repositories owned by ${username}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 286 34" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXml(title)}</title>
  <desc id="desc">Updated from the GitHub API. Forks and private repositories are excluded.</desc>
  <rect x="0.75" y="0.75" width="284.5" height="32.5" fill="#f1ede4" stroke="#10231f" stroke-width="1.5"/>
  <rect width="34" height="34" fill="#e9be48"/>
  <path d="M17 7.4l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3.1-5.8 3.1 1.1-6.5-4.7-4.6 6.5-.9z" fill="#10231f"/>
  <text x="48" y="21.5" fill="#10231f" font-family="ui-monospace, SFMono-Regular, Consolas, monospace" font-size="11.5" font-weight="750" letter-spacing="1.25">PUBLIC REPOS</text>
  <line x1="151" y1="8" x2="151" y2="26" stroke="#b9b2a5" stroke-width="1"/>
  <text x="166" y="21.5" fill="#10231f" font-family="ui-monospace, SFMono-Regular, Consolas, monospace" font-size="11.5" font-weight="750" letter-spacing="1.1">${escapeXml(stars)} STARS</text>
</svg>
`;
}

export async function renderRepositoryStars({
  username,
  out,
  token = "",
  fetchImpl = fetch,
}) {
  const repositories = await fetchUserRepositories(username, {
    token,
    fetchImpl,
  });
  const summary = summarizeRepositories(repositories, username);
  const svg = renderRepositoryStarsSvg({ username, ...summary });

  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, svg, "utf8");

  return summary;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const summary = await renderRepositoryStars({
    ...args,
    token: process.env.GITHUB_TOKEN || "",
  });

  console.log(
    `Rendered ${summary.totalStars} stars across ${summary.repositoryCount} public non-fork repositories for ${args.username}.`,
  );
}

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
