#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const GITHUB_GRAPHQL_URL = "https://api.github.com/graphql";
const TOKSCALE_BASE_URL = "https://tokscale.ai";
const OVERVIEW_WEEKS = 53;
const FOCUS_WEEKS = 4;
const DAYS_PER_WEEK = 7;
const FOCUS_DAYS = FOCUS_WEEKS * DAYS_PER_WEEK;

const COLORS = {
  paper: "#f1ede4",
  paperDeep: "#e4ded1",
  paperSoft: "#f7f4ed",
  ink: "#10231f",
  inkSoft: "#40534e",
  line: "#b9b2a5",
  rust: "#c9482b",
  blue: "#4b7fa0",
  gold: "#d5a72c",
  sage: "#8b9d83",
  intensity: ["#eee9de", "#d7d6c8", "#b7bea9", "#8d9e88", "#556e61", "#10231f"],
};

function parseArgs(argv) {
  const args = {
    username: process.env.PROFILE_USERNAME || "George-RD",
    out: "assets/contribution-lens.svg",
    mobileOut: "assets/contribution-lens-mobile.svg",
    meta: "assets/contribution-lens.json",
    githubFixture: "",
    tokscaleFixture: "",
    now: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--username") args.username = argv[++index];
    else if (value === "--out") args.out = argv[++index];
    else if (value === "--mobile-out") args.mobileOut = argv[++index];
    else if (value === "--meta") args.meta = argv[++index];
    else if (value === "--github-fixture") args.githubFixture = argv[++index];
    else if (value === "--tokscale-fixture") args.tokscaleFixture = argv[++index];
    else if (value === "--now") args.now = argv[++index];
    else throw new Error(`Unknown argument: ${value}`);
  }

  return args;
}

function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateKey(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value).slice(0, 10) : date.toISOString().slice(0, 10);
}

function utcDate(value) {
  const date = value instanceof Date ? new Date(value) : new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${value}`);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(value, days) {
  const date = utcDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

function startOfWeekMonday(value) {
  const date = utcDate(value);
  const weekday = date.getUTCDay();
  const offset = weekday === 0 ? -6 : 1 - weekday;
  return addDays(date, offset);
}

function startOfWeekSunday(value) {
  const date = utcDate(value);
  return addDays(date, -date.getUTCDay());
}

function endOfWeekSaturday(value) {
  return addDays(startOfWeekSunday(value), 6);
}

function rangeDates(start, count) {
  return Array.from({ length: count }, (_, index) => dateKey(addDays(start, index)));
}

function monthLabel(value, long = false) {
  const raw = String(value || "");
  const date = utcDate(raw.length === 10 ? `${raw}T00:00:00.000Z` : raw);
  return date
    .toLocaleDateString("en-GB", {
      month: long ? "long" : "short",
      timeZone: "UTC",
    })
    .toUpperCase();
}

function shortDay(value) {
  const raw = String(value || "");
  return utcDate(raw.length === 10 ? `${raw}T00:00:00.000Z` : raw)
    .toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" })
    .toUpperCase();
}

function isoDateTime(value, endOfDay = false) {
  const date = utcDate(value);
  if (endOfDay) date.setUTCHours(23, 59, 59, 999);
  return date.toISOString();
}

function compactNumber(value) {
  const n = number(value);
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(n >= 10e9 ? 1 : 2).replace(/\.0$/, "")}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(n >= 10e6 ? 1 : 2).replace(/\.0$/, "")}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(n >= 10e3 ? 1 : 2).replace(/\.0$/, "")}K`;
  return Math.round(n).toLocaleString("en-US");
}

function percentage(value) {
  return `${Math.round(number(value) * 100)}%`;
}

function githubQuery() {
  return `
    query ContributionLens($login: String!, $from: DateTime!, $to: DateTime!, $mergedQuery: String!) {
      user(login: $login) {
        contributionsCollection(from: $from, to: $to) {
          contributionCalendar {
            totalContributions
            weeks {
              firstDay
              contributionDays {
                contributionCount
                date
                weekday
              }
            }
          }
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
            }
          }
        }
      }
    }
  `;
}

async function fetchGithub(username, fromDate, toDate, token) {
  if (!token) throw new Error("GITHUB_TOKEN is required to render the contribution lens");
  const focusStart = dateKey(addDays(startOfWeekMonday(toDate), -(FOCUS_DAYS - 7)));
  const mergedQuery = `author:${username} is:pr is:merged merged:${focusStart}..${dateKey(toDate)}`;
  const response = await fetch(GITHUB_GRAPHQL_URL, {
    method: "POST",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "George-RD-profile-contribution-lens/1.0",
    },
    body: JSON.stringify({
      query: githubQuery(),
      variables: {
        login: username,
        from: isoDateTime(fromDate),
        to: isoDateTime(toDate, true),
        mergedQuery,
      },
    }),
  });

  const payload = await response.json();
  if (!response.ok || payload.errors) {
    throw new Error(`GitHub GraphQL failed: ${JSON.stringify(payload.errors || payload).slice(0, 600)}`);
  }
  if (!payload.data?.user) throw new Error(`GitHub user not found: ${username}`);
  return payload.data;
}

async function fetchTokscale(username) {
  const url = new URL(`/api/users/${encodeURIComponent(username)}`, TOKSCALE_BASE_URL);
  url.searchParams.set("period", "month");
  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "George-RD-profile-contribution-lens/1.0" },
  });
  if (!response.ok) throw new Error(`Tokscale request failed: ${response.status} ${response.statusText}`);
  const payload = await response.json();
  if (payload?.error) throw new Error(`Tokscale API error: ${payload.error}`);
  return payload;
}

async function loadJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function normalizeGithub(raw) {
  if (raw?.days && Array.isArray(raw.days)) {
    return {
      days: raw.days.map((entry) => ({ date: dateKey(entry.date), count: number(entry.count ?? entry.contributionCount) })),
      commits: (raw.commits || []).map((entry) => ({ date: dateKey(entry.date), repo: entry.repo, count: number(entry.count) })),
      merges: (raw.merges || []).map((entry) => ({ date: dateKey(entry.date), repo: entry.repo })),
      reviews: (raw.reviews || []).map((entry) => ({ date: dateKey(entry.date), repo: entry.repo })),
      totalContributions: number(raw.totalContributions),
    };
  }

  const collection = raw.user?.contributionsCollection;
  const calendar = collection?.contributionCalendar;
  const days = (calendar?.weeks || []).flatMap((week) =>
    (week.contributionDays || []).map((entry) => ({ date: dateKey(entry.date), count: number(entry.contributionCount) })),
  );
  const commits = [];
  for (const repoEntry of collection?.commitContributionsByRepository || []) {
    const repo = repoEntry.repository?.name || repoEntry.repository?.nameWithOwner || "repository";
    for (const contribution of repoEntry.contributions?.nodes || []) {
      commits.push({ date: dateKey(contribution.occurredAt), repo, count: number(contribution.commitCount) });
    }
  }
  const reviews = (collection?.pullRequestReviewContributions?.nodes || [])
    .filter((entry) => entry?.occurredAt)
    .map((entry) => ({
      date: dateKey(entry.occurredAt),
      repo: entry.pullRequest?.repository?.name || entry.pullRequest?.repository?.nameWithOwner || "repository",
    }));
  const merges = (raw.search?.nodes || [])
    .filter((entry) => entry?.mergedAt)
    .map((entry) => ({
      date: dateKey(entry.mergedAt),
      repo: entry.repository?.name || entry.repository?.nameWithOwner || "repository",
    }));

  return {
    days,
    commits,
    merges,
    reviews,
    totalContributions: number(calendar?.totalContributions),
  };
}

function canonicalModelName(value) {
  let model = String(value || "").trim().toLowerCase();
  model = model.replace(/^(anthropic|openai|google)\//, "");
  model = model.replace(/^deepseek:/, "");
  return model;
}

function modelFamily(value) {
  const model = canonicalModelName(value);
  if (!model || model === "unknown" || model === "<synthetic>") return "";
  if (/(claude|sonnet|opus|haiku|anthropic)/.test(model)) return "claude";
  if (/(gpt|codex|openai|o[134]-)/.test(model)) return "gpt";
  if (/(gemini|google)/.test(model)) return "gemini";
  return "other";
}

function clientTokenTotal(client) {
  const tokens = client?.tokens || {};
  return (
    number(tokens.input) +
    number(tokens.output) +
    number(tokens.cacheRead) +
    number(tokens.cacheWrite) +
    number(tokens.reasoning)
  );
}

function normalizeTokscale(raw) {
  if (raw?.familiesByDate) return raw;
  const familiesByDate = {};
  for (const contribution of raw?.contributions || []) {
    const date = dateKey(contribution.date);
    if (!date) continue;
    const families = familiesByDate[date] || { claude: 0, gpt: 0, gemini: 0, other: 0 };
    for (const client of contribution.clients || []) {
      const models = Object.entries(client.models || {});
      if (models.length) {
        for (const [model, data] of models) {
          const family = modelFamily(model);
          if (family) families[family] += number(data?.tokens);
        }
      } else {
        const family = modelFamily(client.modelId);
        if (family) families[family] += clientTokenTotal(client);
      }
    }
    familiesByDate[date] = families;
  }
  return { familiesByDate };
}

function repoShortName(repo) {
  const clean = String(repo || "").split("/").at(-1) || "";
  const labels = {
    openspine: "OPEN",
    mag: "MAG",
    cairn: "CAIRN",
    "rive-rs-cli": "RIVE",
    "design-studio": "DESIGN",
    "growth-arsenal": "GROWTH",
    "george-rd": "PROFILE",
  };
  const normalized = clean.toLowerCase();
  if (labels[normalized]) return labels[normalized];
  const parts = clean.split(/[-_\s]+/).filter(Boolean);
  if (parts.length > 1) return parts.map((part) => part[0]).join("").slice(0, 6).toUpperCase();
  return clean.slice(0, 6).toUpperCase() || "—";
}

function quantile(values, q) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const base = Math.floor(position);
  const rest = position - base;
  return sorted[base + 1] === undefined
    ? sorted[base]
    : sorted[base] + rest * (sorted[base + 1] - sorted[base]);
}

function intensityScale(days) {
  const positive = days.map((day) => day.count).filter((value) => value > 0);
  const thresholds = [0, quantile(positive, 0.2), quantile(positive, 0.45), quantile(positive, 0.7), quantile(positive, 0.9)];
  return (value) => {
    if (value <= 0) return 0;
    if (value <= Math.max(1, thresholds[1])) return 1;
    if (value <= Math.max(thresholds[1] + 1, thresholds[2])) return 2;
    if (value <= Math.max(thresholds[2] + 1, thresholds[3])) return 3;
    if (value <= Math.max(thresholds[3] + 1, thresholds[4])) return 4;
    return 5;
  };
}

function addRepoScore(map, date, repo, value) {
  if (!date || !repo || value <= 0) return;
  const byRepo = map.get(date) || new Map();
  byRepo.set(repo, number(byRepo.get(repo)) + value);
  map.set(date, byRepo);
}

function buildViewModel({ github, tokscale, username, now = new Date() }) {
  const endDate = utcDate(now);
  const overviewEnd = endOfWeekSaturday(endDate);
  const overviewStart = addDays(overviewEnd, -(OVERVIEW_WEEKS * DAYS_PER_WEEK - 1));
  const overviewDates = rangeDates(overviewStart, OVERVIEW_WEEKS * DAYS_PER_WEEK);
  const focusStart = addDays(startOfWeekMonday(endDate), -(FOCUS_WEEKS - 1) * DAYS_PER_WEEK);
  const focusDates = rangeDates(focusStart, FOCUS_DAYS);
  const todayKey = dateKey(endDate);

  const dayCount = new Map(github.days.map((entry) => [entry.date, entry.count]));
  const scale = intensityScale(github.days);
  const repoScores = new Map();
  for (const commit of github.commits) addRepoScore(repoScores, commit.date, commit.repo, Math.max(1, commit.count));
  for (const merge of github.merges) addRepoScore(repoScores, merge.date, merge.repo, 2);
  for (const review of github.reviews) addRepoScore(repoScores, review.date, review.repo, 0.5);

  const mergeDates = new Map();
  for (const merge of github.merges) {
    const repos = mergeDates.get(merge.date) || [];
    repos.push(merge.repo);
    mergeDates.set(merge.date, repos);
  }
  const reviewDates = new Map();
  for (const review of github.reviews) {
    const repos = reviewDates.get(review.date) || [];
    repos.push(review.repo);
    reviewDates.set(review.date, repos);
  }

  const overview = overviewDates.map((date) => {
    const count = date > todayKey ? 0 : number(dayCount.get(date));
    return { date, count, intensity: date > todayKey ? 0 : scale(count), future: date > todayKey };
  });

  const focus = focusDates.map((date) => {
    const count = date > todayKey ? 0 : number(dayCount.get(date));
    const scores = [...(repoScores.get(date) || new Map()).entries()].sort((a, b) => b[1] - a[1]);
    const future = date > todayKey;
    const repo = future ? "" : scores[0]?.[0] || "";
    const families = future
      ? { claude: 0, gpt: 0, gemini: 0, other: 0 }
      : { ...(tokscale.familiesByDate?.[date] || {}) };
    const familyTotal = Object.values(families).reduce((sum, value) => sum + number(value), 0);
    const event = future
      ? ""
      : mergeDates.has(date)
        ? "merge"
        : reviewDates.has(date)
          ? "review"
          : familyTotal > 0 && count === 0
            ? "explore"
            : "";
    return {
      date,
      count,
      intensity: future ? 0 : scale(count),
      future,
      repo,
      repoLabel: repoShortName(repo || (familyTotal > 0 ? "TOOLS" : "")),
      families,
      familyTotal,
      event,
    };
  });

  const activeDays = focus.filter((day) => day.count > 0).length;
  const mergeDays = new Set(focus.filter((day) => !day.future && mergeDates.has(day.date)).map((day) => day.date)).size;
  const focusRepoTotals = new Map();
  for (const day of focus) {
    if (day.future) continue;
    for (const [repo, score] of repoScores.get(day.date) || []) {
      focusRepoTotals.set(repo, number(focusRepoTotals.get(repo)) + number(score));
    }
  }
  const sortedRepos = [...focusRepoTotals.entries()].sort((a, b) => b[1] - a[1]);
  const repoTotal = sortedRepos.reduce((sum, [, value]) => sum + value, 0);
  const topTwo = sortedRepos.slice(0, 2).reduce((sum, [, value]) => sum + value, 0);
  const focusShare = repoTotal ? topTwo / repoTotal : 0;

  return {
    username,
    generatedAt: new Date().toISOString(),
    overviewStart: dateKey(overviewStart),
    overviewEnd: dateKey(overviewEnd),
    focusStart: dateKey(focusStart),
    focusEnd: dateKey(addDays(focusStart, FOCUS_DAYS - 1)),
    totalContributions: github.totalContributions || github.days.reduce((sum, day) => sum + day.count, 0),
    overview,
    focus,
    metrics: {
      activeDays,
      mergeDays,
      focusShare,
      topRepos: sortedRepos.slice(0, 2).map(([repo]) => repoShortName(repo)),
    },
  };
}

function styles() {
  return `
    .paper { fill:${COLORS.paper}; }
    .edge { fill:none; stroke:${COLORS.ink}; stroke-width:2; }
    .rule { stroke:${COLORS.line}; stroke-width:1; }
    .rule-strong { stroke:${COLORS.ink}; stroke-width:1.2; }
    .title { fill:${COLORS.ink}; font-family:"Arial Narrow","Avenir Next Condensed","Helvetica Neue",sans-serif; font-size:30px; font-weight:900; letter-spacing:1px; }
    .kicker,.label,.month,.day,.metric-label,.stamp { fill:${COLORS.inkSoft}; font-family:ui-monospace,"SFMono-Regular",Consolas,monospace; font-weight:700; letter-spacing:1px; }
    .kicker { font-size:12px; fill:${COLORS.rust}; }
    .label { font-size:11px; }
    .month,.day { font-size:10px; }
    .metric { fill:#10231f; font-family:"Arial Narrow","Avenir Next Condensed","Helvetica Neue",sans-serif; font-size:34px; font-weight:900; }
    .metric-label { font-size:10px; }
    .repo { fill:#10231f; font-family:ui-monospace,"SFMono-Regular",Consolas,monospace; font-size:11px; font-weight:800; letter-spacing:.5px; }
    .stamp { font-size:9px; }
    .overview-cell,.lens-cell { stroke:${COLORS.paper}; stroke-width:1; }
    .future { opacity:.3; }
    .selection { fill:none; stroke:#10231f; stroke-width:2; rx:8; }
    .connector { fill:none; stroke:#40534e; stroke-width:1; stroke-dasharray:5 5; opacity:.65; }
    .lens-panel { fill:${COLORS.paperSoft}; stroke:${COLORS.ink}; stroke-width:1.3; }
    .metric-panel { fill:${COLORS.paperSoft}; stroke:${COLORS.line}; stroke-width:1; }
    .event { fill:none; stroke:${COLORS.ink}; stroke-width:1.5; stroke-linecap:round; stroke-linejoin:round; }
    .event-dot { fill:${COLORS.rust}; }
    .family-claude { fill:${COLORS.rust}; }
    .family-gpt { fill:${COLORS.blue}; }
    .family-gemini { fill:${COLORS.gold}; }
    .family-other { fill:${COLORS.sage}; }
  `;
}

function eventGlyph(type, x, y, scale = 1) {
  if (type === "merge") {
    return `<g class="event" transform="translate(${x} ${y}) scale(${scale})"><circle cx="1" cy="1" r="1.8"/><circle cx="9" cy="1" r="1.8"/><circle cx="9" cy="9" r="1.8"/><path d="M1 3v3c0 2 2 3 4 3h2M9 3v4"/></g>`;
  }
  if (type === "review") {
    return `<g class="event" transform="translate(${x} ${y}) scale(${scale})"><rect x="0" y="1" width="11" height="8" rx="2"/><path d="M3 9v3l3-3"/></g>`;
  }
  if (type === "explore") {
    return `<g class="event" transform="translate(${x} ${y}) scale(${scale})"><circle cx="5" cy="5" r="4"/><path d="M8 8l4 4"/></g>`;
  }
  return "";
}

function familySegments(families, x, y, width, height) {
  const entries = [
    ["claude", number(families.claude)],
    ["gpt", number(families.gpt)],
    ["gemini", number(families.gemini)],
    ["other", number(families.other)],
  ].filter(([, value]) => value > 0);
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  if (!total) return "";
  let cursor = x;
  return entries
    .map(([family, value], index) => {
      const remaining = x + width - cursor;
      const segmentWidth = index === entries.length - 1 ? remaining : Math.max(2, (value / total) * width);
      const rect = `<rect class="family-${family}" x="${cursor.toFixed(1)}" y="${y}" width="${segmentWidth.toFixed(1)}" height="${height}"/>`;
      cursor += segmentWidth;
      return rect;
    })
    .join("");
}

function overviewGeometry(x, y, width, height) {
  const stepX = width / OVERVIEW_WEEKS;
  const stepY = height / DAYS_PER_WEEK;
  const cell = Math.max(3, Math.min(stepX - 2.2, stepY - 2.2));
  return { x, y, width, height, stepX, stepY, cell };
}

function renderOverview(view, geometry) {
  const { x, y, stepX, stepY, cell } = geometry;
  const cells = view.overview
    .map((day, index) => {
      const column = Math.floor(index / DAYS_PER_WEEK);
      const row = index % DAYS_PER_WEEK;
      const cellX = x + column * stepX;
      const cellY = y + row * stepY;
      const fill = COLORS.intensity[day.intensity];
      return `<rect class="overview-cell${day.future ? " future" : ""}" data-day="${day.date}" x="${cellX.toFixed(1)}" y="${cellY.toFixed(1)}" width="${cell.toFixed(1)}" height="${cell.toFixed(1)}" rx="1.4" fill="${fill}"><title>${escapeXml(day.date)} · ${day.count} contributions</title></rect>`;
    })
    .join("\n  ");

  const monthLabels = [];
  let priorMonth = "";
  for (let week = 0; week < OVERVIEW_WEEKS; week += 1) {
    const date = view.overview[week * DAYS_PER_WEEK]?.date;
    const month = date?.slice(0, 7) || "";
    if (month && month !== priorMonth) {
      monthLabels.push(`<text class="month" x="${(x + week * stepX).toFixed(1)}" y="${(y - 10).toFixed(1)}">${monthLabel(date)}</text>`);
      priorMonth = month;
    }
  }

  const dayLabels = ["", "M", "", "W", "", "F", ""]
    .map((label, row) => label ? `<text class="day" x="${(x - 18).toFixed(1)}" y="${(y + row * stepY + cell * 0.78).toFixed(1)}">${label}</text>` : "")
    .join("\n  ");

  const focusStartIndex = view.overview.findIndex((day) => day.date === view.focusStart);
  const focusStartColumn = focusStartIndex >= 0 ? Math.floor(focusStartIndex / DAYS_PER_WEEK) : OVERVIEW_WEEKS - FOCUS_WEEKS;
  const selectionX = x + focusStartColumn * stepX - 4;
  const selectionWidth = FOCUS_WEEKS * stepX + 6;
  const selection = `<rect class="selection" x="${selectionX.toFixed(1)}" y="${(y - 4).toFixed(1)}" width="${selectionWidth.toFixed(1)}" height="${(stepY * DAYS_PER_WEEK + 5).toFixed(1)}"/>`;

  return { cells, monthLabels: monthLabels.join("\n  "), dayLabels, selection, selectionX, selectionWidth };
}

function renderLensGrid(view, { x, y, cellWidth, cellHeight, gapX, gapY, labelWidth }) {
  const weekLabels = Array.from({ length: FOCUS_WEEKS }, (_, week) => {
    const date = view.focus[week * DAYS_PER_WEEK]?.date;
    const xx = x + labelWidth + week * (cellWidth + gapX);
    return `<text class="month" x="${(xx + 5).toFixed(1)}" y="${(y - 10).toFixed(1)}">${shortDay(date)}</text>`;
  }).join("\n  ");
  const dayLabels = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]
    .map((label, row) => `<text class="day" x="${x}" y="${(y + row * (cellHeight + gapY) + cellHeight * 0.62).toFixed(1)}">${label}</text>`)
    .join("\n  ");

  const cells = view.focus
    .map((day, index) => {
      const week = Math.floor(index / DAYS_PER_WEEK);
      const row = index % DAYS_PER_WEEK;
      const cellX = x + labelWidth + week * (cellWidth + gapX);
      const cellY = y + row * (cellHeight + gapY);
      const fill = COLORS.intensity[day.intensity];
      const textColor = day.intensity >= 4 ? COLORS.paperSoft : COLORS.ink;
      const repo = day.repoLabel || (day.future ? "" : "—");
      const event = eventGlyph(day.event, cellX + cellWidth - 18, cellY + 8, 0.75);
      const stripe = familySegments(day.families, cellX + 5, cellY + cellHeight - 6, cellWidth - 10, 3);
      const title = `${day.date} · ${day.count} contributions${day.repo ? ` · ${day.repo}` : ""}${day.event ? ` · ${day.event}` : ""}`;
      return `<g data-focus-day="${day.date}" class="${day.future ? "future" : ""}"><rect class="lens-cell" x="${cellX.toFixed(1)}" y="${cellY.toFixed(1)}" width="${cellWidth}" height="${cellHeight}" rx="4" fill="${fill}"><title>${escapeXml(title)}</title></rect>${repo ? `<text class="repo" x="${(cellX + 6).toFixed(1)}" y="${(cellY + 15).toFixed(1)}" fill="${textColor}" style="fill:${textColor}">${escapeXml(repo)}</text>` : ""}${event}${stripe}</g>`;
    })
    .join("\n  ");

  return { weekLabels, dayLabels, cells };
}

function metricBlockSvg(x, y, value, label, note = "") {
  return `<text class="metric" x="${x}" y="${y}">${escapeXml(value)}</text>
  <text class="metric-label" x="${x}" y="${y + 17}">${escapeXml(label)}</text>${note ? `\n  <text class="stamp" x="${x}" y="${y + 34}">${escapeXml(note)}</text>` : ""}`;
}

function legendSvg(x, y, compact = false) {
  const dot = compact ? 7 : 8;
  const gap = compact ? 105 : 130;
  const families = [
    ["CLAUDE", COLORS.rust],
    ["GPT", COLORS.blue],
    ["GEMINI", COLORS.gold],
    ["OTHER", COLORS.sage],
  ];
  return families
    .map(([label, fill], index) => `<circle cx="${x + index * gap}" cy="${y}" r="${dot / 2}" fill="${fill}"/><text class="stamp" x="${x + index * gap + dot + 5}" y="${y + 3}">${label}</text>`)
    .join("\n  ");
}

function renderDesktopSvg(view) {
  const width = 1200;
  const height = 610;
  const overview = overviewGeometry(64, 116, 1072, 112);
  const overviewParts = renderOverview(view, overview);
  const lensX = 64;
  const lensY = 314;
  const lensWidth = 780;
  const lensHeight = 225;
  const lensGrid = renderLensGrid(view, {
    x: lensX + 18,
    y: lensY + 42,
    labelWidth: 38,
    cellWidth: 158,
    cellHeight: 20,
    gapX: 8,
    gapY: 4,
  });
  const connectorStartX = overviewParts.selectionX + overviewParts.selectionWidth / 2;
  const connectorEndX = lensX + lensWidth - 80;
  const topRepos = view.metrics.topRepos.length ? view.metrics.topRepos.join(" + ") : "—";

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
  <title id="title">Contribution lens for ${escapeXml(view.username)}</title>
  <desc id="desc">A year of GitHub contributions with the latest four weeks enlarged to show repository focus, model-family mix and merge activity.</desc>
  <style>${styles()}</style>
  <rect class="paper" width="${width}" height="${height}"/>
  <rect class="edge" x="1" y="1" width="${width - 2}" height="${height - 2}"/>
  <text class="kicker" x="58" y="34">GITHUB / CONTRIBUTION LENS</text>
  <text class="title" x="58" y="67">BUILD CADENCE</text>
  <text class="label" x="1142" y="36" text-anchor="end">365 DAYS / LATEST 4 WEEKS</text>
  <text class="stamp" x="1142" y="53" text-anchor="end">GITHUB + TOKSCALE</text>
  <line class="rule-strong" x1="58" y1="82" x2="1142" y2="82"/>
  ${overviewParts.monthLabels}
  ${overviewParts.dayLabels}
  ${overviewParts.cells}
  ${overviewParts.selection}
  <path class="connector" d="M${connectorStartX.toFixed(1)} 237 C${connectorStartX.toFixed(1)} 272 ${connectorEndX.toFixed(1)} 270 ${connectorEndX.toFixed(1)} 302"/>
  <rect class="lens-panel" x="${lensX}" y="${lensY}" width="${lensWidth}" height="${lensHeight}" rx="12"/>
  <text class="label" x="${lensX + 18}" y="${lensY + 24}">LATEST 4 WEEKS</text>
  ${lensGrid.weekLabels}
  ${lensGrid.dayLabels}
  ${lensGrid.cells}
  <rect class="metric-panel" x="876" y="314" width="260" height="225" rx="12"/>
  ${metricBlockSvg(904, 365, String(view.metrics.activeDays), "ACTIVE DAYS")}
  <line class="rule" x1="904" y1="390" x2="1108" y2="390"/>
  ${metricBlockSvg(904, 433, String(view.metrics.mergeDays), "MERGE DAYS")}
  <line class="rule" x1="904" y1="458" x2="1108" y2="458"/>
  ${metricBlockSvg(904, 501, percentage(view.metrics.focusShare), "TOP 2 REPOS", topRepos)}
  <line class="rule-strong" x1="58" y1="560" x2="1142" y2="560"/>
  <text class="stamp" x="58" y="584">ACTIVITY</text>
  ${COLORS.intensity.slice(1).map((fill, index) => `<rect x="${126 + index * 18}" y="574" width="12" height="12" rx="1.5" fill="${fill}"/>`).join("\n  ")}
  ${legendSvg(270, 580)}
  <g transform="translate(820 574)">${eventGlyph("merge", 0, 0, 0.8)}<text class="stamp" x="18" y="9">MERGE</text>${eventGlyph("review", 88, 0, 0.8)}<text class="stamp" x="106" y="9">REVIEW</text>${eventGlyph("explore", 190, 0, 0.8)}<text class="stamp" x="208" y="9">EXPLORE</text></g>
</svg>\n`;
}

function renderMobileSvg(view) {
  const width = 720;
  const height = 900;
  const overview = overviewGeometry(44, 126, 638, 92);
  const overviewParts = renderOverview(view, overview);
  const lensX = 32;
  const lensY = 288;
  const lensWidth = 656;
  const lensHeight = 390;
  const lensGrid = renderLensGrid(view, {
    x: lensX + 18,
    y: lensY + 52,
    labelWidth: 46,
    cellWidth: 132,
    cellHeight: 39,
    gapX: 7,
    gapY: 6,
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
  <title id="title">Contribution lens for ${escapeXml(view.username)}</title>
  <desc id="desc">A mobile contribution lens showing a year overview, the latest four weeks and three focus metrics.</desc>
  <style>${styles()}
    .title{font-size:40px}.kicker{font-size:15px}.label{font-size:14px}.month,.day{font-size:12px}.repo{font-size:14px}.metric{font-size:42px}.metric-label{font-size:13px}.stamp{font-size:11px}
  </style>
  <rect class="paper" width="${width}" height="${height}"/>
  <rect class="edge" x="1" y="1" width="${width - 2}" height="${height - 2}"/>
  <text class="kicker" x="32" y="38">GITHUB / CONTRIBUTION LENS</text>
  <text class="title" x="32" y="84">BUILD CADENCE</text>
  <line class="rule-strong" x1="32" y1="100" x2="688" y2="100"/>
  ${overviewParts.monthLabels}
  ${overviewParts.cells}
  ${overviewParts.selection}
  <path class="connector" d="M${(overviewParts.selectionX + overviewParts.selectionWidth / 2).toFixed(1)} 228 C${(overviewParts.selectionX + overviewParts.selectionWidth / 2).toFixed(1)} 255 580 250 580 278"/>
  <rect class="lens-panel" x="${lensX}" y="${lensY}" width="${lensWidth}" height="${lensHeight}" rx="14"/>
  <text class="label" x="${lensX + 18}" y="${lensY + 28}">LATEST 4 WEEKS</text>
  ${lensGrid.weekLabels}
  ${lensGrid.dayLabels}
  ${lensGrid.cells}
  <line class="rule-strong" x1="32" y1="708" x2="688" y2="708"/>
  ${metricBlockSvg(50, 770, String(view.metrics.activeDays), "ACTIVE DAYS")}
  ${metricBlockSvg(260, 770, String(view.metrics.mergeDays), "MERGE DAYS")}
  ${metricBlockSvg(470, 770, percentage(view.metrics.focusShare), "TOP 2 REPOS", view.metrics.topRepos.join(" + "))}
  <line class="rule" x1="32" y1="818" x2="688" y2="818"/>
  ${legendSvg(48, 850, true)}
  <text class="stamp" x="688" y="884" text-anchor="end">GITHUB + TOKSCALE</text>
</svg>\n`;
}

function buildMeta(view) {
  return {
    generatedAt: view.generatedAt,
    username: view.username,
    sources: {
      github: `https://github.com/${view.username}`,
      tokscale: `https://tokscale.ai/u/${view.username}`,
    },
    range: {
      overviewStart: view.overviewStart,
      overviewEnd: view.overviewEnd,
      focusStart: view.focusStart,
      focusEnd: view.focusEnd,
    },
    totalContributions: view.totalContributions,
    metrics: view.metrics,
    focus: view.focus.map((day) => ({
      date: day.date,
      contributions: day.count,
      repository: day.repo || null,
      event: day.event || null,
      modelFamilies: day.families,
    })),
  };
}

async function ensureParent(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const now = args.now ? utcDate(args.now) : utcDate(new Date());
  const overviewEnd = endOfWeekSaturday(now);
  const overviewStart = addDays(overviewEnd, -(OVERVIEW_WEEKS * DAYS_PER_WEEK - 1));

  const githubRaw = args.githubFixture
    ? await loadJson(args.githubFixture)
    : await fetchGithub(args.username, overviewStart, now, process.env.GITHUB_TOKEN);
  let tokscaleRaw = { contributions: [] };
  try {
    tokscaleRaw = args.tokscaleFixture ? await loadJson(args.tokscaleFixture) : await fetchTokscale(args.username);
  } catch (error) {
    console.warn(`Tokscale data unavailable; rendering GitHub-only lens: ${error.message}`);
  }

  const view = buildViewModel({
    github: normalizeGithub(githubRaw),
    tokscale: normalizeTokscale(tokscaleRaw),
    username: args.username,
    now,
  });
  const desktop = renderDesktopSvg(view);
  const mobile = renderMobileSvg(view);
  const meta = buildMeta(view);

  await ensureParent(args.out);
  await fs.writeFile(args.out, desktop, "utf8");
  await ensureParent(args.mobileOut);
  await fs.writeFile(args.mobileOut, mobile, "utf8");
  if (args.meta) {
    await ensureParent(args.meta);
    await fs.writeFile(args.meta, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  }

  console.log(`Rendered contribution lens for ${args.username}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

export {
  buildMeta,
  buildViewModel,
  normalizeGithub,
  normalizeTokscale,
  renderDesktopSvg,
  renderMobileSvg,
};
