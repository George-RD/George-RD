#!/usr/bin/env node

const DEFAULT_BASE = "https://tokscale.ai";

function parseArgs(argv) {
  const args = {
    username: process.env.TOKSCALE_USERNAME || "George-RD",
    out: "assets/tokscale-dossier.svg",
    meta: "assets/tokscale-dossier.json",
    base: process.env.TOKSCALE_API_BASE || DEFAULT_BASE,
    fixture: "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--username") args.username = argv[++index];
    else if (value === "--out") args.out = argv[++index];
    else if (value === "--meta") args.meta = argv[++index];
    else if (value === "--base") args.base = argv[++index];
    else if (value === "--fixture") args.fixture = argv[++index];
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

function compactNumber(value, suffix = "") {
  const abs = Math.abs(value);
  const units = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];
  for (const [scale, label] of units) {
    if (abs >= scale) {
      const scaled = value / scale;
      const digits = Math.abs(scaled) >= 100 ? 0 : Math.abs(scaled) >= 10 ? 1 : 2;
      return `${scaled.toFixed(digits).replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1")}${label}${suffix}`;
    }
  }
  return `${Math.round(value).toLocaleString("en-US")}${suffix}`;
}

function compactTokens(value) {
  return compactNumber(number(value));
}

function compactCost(value) {
  const cost = number(value);
  const abs = Math.abs(cost);
  if (abs >= 1e6) return `$${compactNumber(cost).replace(/\.0+/, "")}`;
  if (abs >= 1e3) return `$${compactNumber(cost).replace(/\.0+/, "")}`;
  return `$${cost.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function percent(value, total) {
  if (!total) return "0%";
  return `${((number(value) / total) * 100).toFixed(1).replace(/\.0$/, "")}%`;
}

function formatDate(value) {
  if (!value) return "unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

function clientLabel(value) {
  const labels = {
    codex: "Codex CLI",
    claude: "Claude Code",
    opencode: "OpenCode",
    openclaw: "OpenClaw",
    pi: "Pi",
    gemini: "Gemini",
    cursor: "Cursor",
    amp: "Amp",
    droid: "Droid",
    hermes: "Hermes",
    copilot: "Copilot CLI",
    synthetic: "Synthetic",
  };
  return labels[value] || String(value || "Unknown");
}

async function fetchProfile(base, username, period) {
  const url = new URL(`/api/users/${encodeURIComponent(username)}`, base);
  if (period && period !== "all") url.searchParams.set("period", period);
  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "George-RD-profile-dossier/1.0" },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Tokscale request failed ${response.status} ${response.statusText}: ${body.slice(0, 200)}`);
  }
  const data = await response.json();
  if (data && data.error) throw new Error(`Tokscale API error: ${data.error}`);
  return data;
}

async function loadProfiles(args) {
  if (!args.fixture) {
    return {
      all: await fetchProfile(args.base, args.username, "all"),
      month: await fetchProfile(args.base, args.username, "month"),
    };
  }
  const fs = await import("node:fs/promises");
  const payload = JSON.parse(await fs.readFile(args.fixture, "utf8"));
  return { all: payload.all || payload, month: payload.month || payload };
}

function latestContributions(profile, count) {
  return [...(profile.contributions || [])]
    .filter((entry) => entry && entry.date)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .slice(-count);
}

function topModels(profile, count) {
  return [...(profile.modelUsage || [])]
    .filter((entry) => number(entry.tokens) > 0 || number(entry.cost) > 0)
    .sort((a, b) => number(b.cost) - number(a.cost) || number(b.tokens) - number(a.tokens))
    .slice(0, count);
}

function buildBars(contributions) {
  const startX = 642;
  const bottom = 203;
  const gap = 5.5;
  const width = 7.5;
  const maxTokens = Math.max(...contributions.map((entry) => number(entry.totals?.tokens)), 1);
  return contributions.map((entry, index) => {
    const tokens = number(entry.totals?.tokens);
    const height = tokens <= 0 ? 2 : Math.max(4, Math.round((tokens / maxTokens) * 72));
    const x = startX + index * (width + gap);
    const y = bottom - height;
    const intensity = Math.max(0, Math.min(4, Number(entry.intensity || 0)));
    const klass = ["bar", `i${intensity}`].join(" ");
    return `<rect class="${klass}" x="${x.toFixed(1)}" y="${y}" width="${width}" height="${height}" rx="2" style="--delay:${(index * 22).toFixed(0)}ms"><title>${escapeXml(entry.date)} · ${compactTokens(tokens)} tokens</title></rect>`;
  }).join("\n    ");
}

function buildTrace(contributions) {
  const startX = 646;
  const bottom = 199;
  const step = 13;
  const maxTokens = Math.max(...contributions.map((entry) => number(entry.totals?.tokens)), 1);
  const points = contributions.map((entry, index) => {
    const tokens = number(entry.totals?.tokens);
    const y = bottom - (tokens <= 0 ? 2 : Math.max(5, (tokens / maxTokens) * 74));
    return `${index === 0 ? "M" : "L"}${(startX + index * step).toFixed(1)} ${y.toFixed(1)}`;
  });
  return points.length ? points.join(" ") : "M646 199L1023 199";
}

function buildMixSegments(stats) {
  const total = number(stats.inputTokens) + number(stats.outputTokens) + number(stats.cacheReadTokens) + number(stats.cacheWriteTokens) + number(stats.reasoningTokens);
  const segments = [
    ["input", number(stats.inputTokens), "mix-input"],
    ["output", number(stats.outputTokens), "mix-output"],
    ["cache", number(stats.cacheReadTokens) + number(stats.cacheWriteTokens), "mix-cache"],
    ["reasoning", number(stats.reasoningTokens), "mix-reasoning"],
  ];
  let cursor = 58;
  return segments.map(([label, value, klass]) => {
    const width = total ? Math.max(value > 0 ? 3 : 0, (value / total) * 478) : 0;
    const rect = `<rect class="${klass}" x="${cursor.toFixed(1)}" y="260" width="${width.toFixed(1)}" height="12" />`;
    cursor += width;
    return `${rect}<title>${escapeXml(label)} · ${percent(value, total)}</title>`;
  }).join("\n    ");
}

function metricBlock(x, y, label, value, note = "") {
  return `<text class="metric-label" x="${x}" y="${y}">${escapeXml(label)}</text>
  <text class="metric-value" x="${x}" y="${y + 34}">${escapeXml(value)}</text>${note ? `\n  <text class="metric-note" x="${x}" y="${y + 57}">${escapeXml(note)}</text>` : ""}`;
}

function renderSvg({ all, month, username, base }) {
  const stats = all.stats || {};
  const monthStats = month.stats || {};
  const user = all.user || {};
  const monthContribs = latestContributions(month, 30);
  const contributions = monthContribs.length ? monthContribs : latestContributions(all, 30);
  const bars = buildBars(contributions);
  const trace = buildTrace(contributions);
  const models = topModels(month, 3).length ? topModels(month, 3) : topModels(all, 3);
  const modelRows = models.map((model, index) => {
    const y = 245 + index * 21;
    return `<text class="model-name" x="642" y="${y}">${escapeXml(model.model || "model")}</text><text class="model-value" x="1098" y="${y}" text-anchor="end">${escapeXml(compactTokens(model.tokens))}</text>`;
  }).join("\n  ") || `<text class="model-name" x="642" y="245">${escapeXml((all.clients || []).map(clientLabel).slice(0, 4).join(" / ") || "Tokscale profile")}</text>`;

  const rank = user.rank ? `#${Number(user.rank).toLocaleString("en-US")}` : "not ranked";
  const dateLine = all.dateRange?.end ? `DATA THROUGH ${String(all.dateRange.end).toUpperCase()}` : `UPDATED ${formatDate(all.updatedAt).toUpperCase()}`;
  const generated = new Date().toISOString();
  const totalTokens = number(stats.totalTokens);
  const title = `${username} Tokscale activity trace`;
  const desc = `${compactTokens(totalTokens)} all-time tokens, ${compactCost(stats.totalCost)} estimated all-time cost, ${monthStats.activeDays || 0} active days in the current 30-day window.`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 320" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXml(title)}</title>
  <desc id="desc">${escapeXml(desc)}</desc>
  <!-- Generated from ${escapeXml(new URL(`/api/users/${encodeURIComponent(username)}`, base).href)} at ${generated} -->
  <style>
    :root {
      --paper: #f1ede4;
      --paper-deep: #e4ded1;
      --ink: #10231f;
      --ink-soft: #304943;
      --rust: #c9482b;
      --rust-dark: #9f341f;
      --tide: #173e50;
      --field: #445d50;
      --signal: #e9be48;
      --line: #b9b2a5;
      --display: "Arial Narrow", "Avenir Next Condensed", "Helvetica Neue", sans-serif;
      --body: "Avenir Next", "Segoe UI", "Helvetica Neue", sans-serif;
      --mono: ui-monospace, "SFMono-Regular", Consolas, monospace;
      --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
    }
    .paper { fill: #f1ede4; }
    .edge, .rule, .grid { fill: none; stroke: #b9b2a5; }
    .edge { stroke: #10231f; stroke-width: 2; }
    .rule { stroke-width: 1; }
    .grid { stroke-width: 1; opacity: 0.55; }
    .kicker { fill: #c9482b; font-family: ui-monospace, "SFMono-Regular", Consolas, monospace; font-size: 14px; font-weight: 700; letter-spacing: 2px; }
    .meta, .metric-label, .model-label { fill: #304943; font-family: ui-monospace, "SFMono-Regular", Consolas, monospace; font-size: 11px; font-weight: 700; letter-spacing: 1px; }
    .metric-value { fill: #10231f; font-family: "Arial Narrow", "Avenir Next Condensed", "Helvetica Neue", sans-serif; font-size: 36px; font-weight: 800; letter-spacing: -0.5px; }
    .metric-note { fill: #304943; font-family: "Avenir Next", "Segoe UI", "Helvetica Neue", sans-serif; font-size: 12px; font-weight: 600; }
    .chart-title { fill: #10231f; font-family: "Arial Narrow", "Avenir Next Condensed", "Helvetica Neue", sans-serif; font-size: 21px; font-weight: 800; letter-spacing: 0.3px; }
    .chart-note, .model-name { fill: #304943; font-family: "Avenir Next", "Segoe UI", "Helvetica Neue", sans-serif; font-size: 13px; font-weight: 600; }
    .model-value { fill: #10231f; font-family: ui-monospace, "SFMono-Regular", Consolas, monospace; font-size: 12px; font-weight: 700; letter-spacing: 0.7px; }
    .trace { fill: none; stroke: #c9482b; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 1; stroke-dashoffset: 1; animation: draw 1600ms var(--ease-out) forwards; }
    .bar { transform-box: fill-box; transform-origin: bottom; animation: rise 820ms var(--ease-out) both; animation-delay: var(--delay); }
    .i0 { fill: #e4ded1; stroke: #b9b2a5; stroke-width: 0.6; }
    .i1 { fill: #c9b99a; }
    .i2 { fill: #445d50; }
    .i3 { fill: #173e50; }
    .i4 { fill: #c9482b; }
    .mix-input { fill: #c9482b; }
    .mix-output { fill: #e9be48; }
    .mix-cache { fill: #173e50; }
    .mix-reasoning { fill: #445d50; }
    .stamp { fill: #304943; font-family: ui-monospace, "SFMono-Regular", Consolas, monospace; font-size: 10px; font-weight: 600; letter-spacing: 0.75px; }
    @keyframes draw { to { stroke-dashoffset: 0; } }
    @keyframes rise { from { transform: scaleY(0.08); opacity: 0.35; } to { transform: scaleY(1); opacity: 1; } }
    @media (prefers-reduced-motion: reduce) {
      .trace, .bar { animation: none; }
      .trace { stroke-dashoffset: 0; }
    }
  </style>

  <rect class="paper" width="1200" height="320" />
  <rect class="edge" x="1" y="1" width="1198" height="318" />
  <line class="rule" x1="58" y1="58" x2="1142" y2="58" />
  <text class="kicker" x="58" y="39">TOKSCALE / AI ACTIVITY TRACE</text>
  <text class="meta" x="1142" y="39" text-anchor="end">PUBLIC PROFILE / SCHEDULED REFRESH</text>

  ${metricBlock(58, 96, "ALL TIME TOKENS", compactTokens(stats.totalTokens), `${compactCost(stats.totalCost)} ESTIMATED COST`)}
  ${metricBlock(314, 96, "30 DAY TOKENS", compactTokens(monthStats.totalTokens), `${monthStats.activeDays || 0} ACTIVE DAYS`)}
  ${metricBlock(58, 180, "GLOBAL RANK", rank, `TOKENS SORT / ${user.username || username}`)}
  ${metricBlock(314, 180, "SUBMISSIONS", compactNumber(number(stats.submissionCount)), `${compactNumber(number(stats.sessionCount))} SESSIONS`)}

  <text class="model-label" x="58" y="249">TOKEN MIX</text>
  <rect x="58" y="260" width="478" height="12" fill="#e4ded1" />
  ${buildMixSegments(stats)}
  <text class="stamp" x="58" y="294">INPUT ${percent(stats.inputTokens, totalTokens)} / OUTPUT ${percent(stats.outputTokens, totalTokens)} / CACHE ${percent(number(stats.cacheReadTokens) + number(stats.cacheWriteTokens), totalTokens)} / REASONING ${percent(stats.reasoningTokens, totalTokens)}</text>

  <text class="chart-title" x="642" y="96">30 DAY ACTIVITY FIELD</text>
  <text class="chart-note" x="642" y="119">${escapeXml(dateLine)} / HIGHEST DAY ${escapeXml(compactTokens(Math.max(...contributions.map((entry) => number(entry.totals?.tokens)), 0)))}</text>
  <line class="grid" x1="642" y1="132" x2="1098" y2="132" />
  <line class="grid" x1="642" y1="168" x2="1098" y2="168" />
  <line class="grid" x1="642" y1="204" x2="1098" y2="204" />
  <g aria-label="Daily activity bars">
    ${bars}
  </g>
  <path class="trace" pathLength="1" d="${trace}" />

  <text class="model-label" x="642" y="225">TOP MODELS IN WINDOW</text>
  ${modelRows}
  <text class="stamp" x="642" y="294">SOURCE tokScale.ai/u/${escapeXml(username)} / GENERATED ${escapeXml(formatDate(generated).toUpperCase())}</text>
</svg>
`;
}

function buildMeta({ all, month, username, base }) {
  return {
    source: new URL(`/api/users/${encodeURIComponent(username)}`, base).href,
    profile: new URL(`/u/${encodeURIComponent(username)}`, base).href,
    generatedAt: new Date().toISOString(),
    username,
    allTime: {
      rank: all.user?.rank ?? null,
      totalTokens: number(all.stats?.totalTokens),
      totalCost: number(all.stats?.totalCost),
      activeDays: number(all.stats?.activeDays),
      submissions: number(all.stats?.submissionCount),
      sessions: number(all.stats?.sessionCount),
    },
    month: {
      totalTokens: number(month.stats?.totalTokens),
      totalCost: number(month.stats?.totalCost),
      activeDays: number(month.stats?.activeDays),
      contributions: (month.contributions || []).length,
    },
    clients: all.clients || [],
    models: all.models || [],
    topModels: topModels(month, 5).map((model) => ({ model: model.model, tokens: number(model.tokens), cost: number(model.cost) })),
    updatedAt: all.updatedAt || null,
  };
}

const args = parseArgs(process.argv.slice(2));
const fs = await import("node:fs/promises");
const path = await import("node:path");
const profiles = await loadProfiles(args);
const svg = renderSvg({ all: profiles.all, month: profiles.month, username: args.username, base: args.base });
const meta = buildMeta({ all: profiles.all, month: profiles.month, username: args.username, base: args.base });

await fs.mkdir(path.dirname(args.out), { recursive: true });
await fs.writeFile(args.out, svg, "utf8");
if (args.meta) {
  await fs.mkdir(path.dirname(args.meta), { recursive: true });
  await fs.writeFile(args.meta, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
}
console.log(`Rendered Tokscale dossier for ${args.username} to ${args.out}`);
