#!/usr/bin/env node

const DEFAULT_BASE = "https://tokscale.ai";
const TREND_DAYS = 30;
const COMPARISON_DAYS = 7;

function parseArgs(argv) {
  const args = {
    username: process.env.TOKSCALE_USERNAME || "George-RD",
    out: "assets/tokscale-dossier.svg",
    trendsOut: "assets/tokscale-model-momentum.svg",
    meta: "assets/tokscale-dossier.json",
    base: process.env.TOKSCALE_API_BASE || DEFAULT_BASE,
    fixture: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--username") args.username = argv[++index];
    else if (value === "--out") args.out = argv[++index];
    else if (value === "--trends-out") args.trendsOut = argv[++index];
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
      return `${scaled
        .toFixed(digits)
        .replace(/\.0+$/, "")
        .replace(/(\.\d*[1-9])0+$/, "$1")}${label}${suffix}`;
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
  return `$${cost.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function percent(value, total) {
  if (!total) return "0%";
  return `${((number(value) / total) * 100)
    .toFixed(1)
    .replace(/\.0$/, "")}%`;
}

function signedPercentagePoints(value) {
  const rounded = Math.abs(value) < 0.05 ? 0 : value;
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded.toFixed(1)} PP`;
}

function formatDate(value) {
  if (!value) return "unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatShortDate(value) {
  if (!value) return "UNKNOWN";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return String(value).toUpperCase();
  return date
    .toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      timeZone: "UTC",
    })
    .toUpperCase();
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

function canonicalModelName(value) {
  let model = String(value || "").trim();
  if (!model || model === "unknown" || model === "<synthetic>") return "";
  model = model.replace(/^(?:anthropic|openai|google)\//, "");
  model = model.replace(/^deepseek:(?=deepseek-)/, "");
  return model;
}

async function fetchProfile(base, username, period) {
  const url = new URL(`/api/users/${encodeURIComponent(username)}`, base);
  if (period && period !== "all") url.searchParams.set("period", period);
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "George-RD-profile-dossier/2.0",
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Tokscale request failed ${response.status} ${response.statusText}: ${body.slice(0, 200)}`,
    );
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
  return {
    all: payload.all || payload,
    month: payload.month || payload,
  };
}

function latestContributions(profile, count) {
  return [...(profile.contributions || [])]
    .filter((entry) => entry && entry.date)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .slice(-count);
}

function topModels(profile, count) {
  const aggregated = new Map();

  for (const entry of profile.modelUsage || []) {
    const model = canonicalModelName(entry.model);
    if (!model) continue;
    const current = aggregated.get(model) || { model, tokens: 0, cost: 0 };
    current.tokens += number(entry.tokens);
    current.cost += number(entry.cost);
    aggregated.set(model, current);
  }

  return [...aggregated.values()]
    .filter((entry) => entry.tokens > 0 || entry.cost > 0)
    .sort((a, b) => b.cost - a.cost || b.tokens - a.tokens)
    .slice(0, count);
}

function buildBars(contributions) {
  const startX = 642;
  const bottom = 203;
  const gap = 5.5;
  const width = 7.5;
  const maxTokens = Math.max(
    ...contributions.map((entry) => number(entry.totals?.tokens)),
    1,
  );

  return contributions
    .map((entry, index) => {
      const tokens = number(entry.totals?.tokens);
      const height = tokens <= 0 ? 2 : Math.max(4, Math.round((tokens / maxTokens) * 72));
      const x = startX + index * (width + gap);
      const y = bottom - height;
      const intensity = Math.max(0, Math.min(4, Number(entry.intensity || 0)));
      const klass = ["bar", `i${intensity}`].join(" ");
      return `<rect class="${klass}" x="${x.toFixed(1)}" y="${y}" width="${width}" height="${height}" rx="2" style="--delay:${(
        index * 22
      ).toFixed(0)}ms"><title>${escapeXml(entry.date)} · ${compactTokens(tokens)} tokens</title></rect>`;
    })
    .join("\n    ");
}

function buildTrace(contributions) {
  const startX = 646;
  const bottom = 199;
  const step = 13;
  const maxTokens = Math.max(
    ...contributions.map((entry) => number(entry.totals?.tokens)),
    1,
  );
  const points = contributions.map((entry, index) => {
    const tokens = number(entry.totals?.tokens);
    const y = bottom - (tokens <= 0 ? 2 : Math.max(5, (tokens / maxTokens) * 74));
    return `${index === 0 ? "M" : "L"}${(startX + index * step).toFixed(1)} ${y.toFixed(1)}`;
  });
  return points.length ? points.join(" ") : "M646 199L1023 199";
}

function buildMixSegments(stats) {
  const total =
    number(stats.inputTokens) +
    number(stats.outputTokens) +
    number(stats.cacheReadTokens) +
    number(stats.cacheWriteTokens) +
    number(stats.reasoningTokens);
  const segments = [
    ["input", number(stats.inputTokens), "mix-input"],
    ["output", number(stats.outputTokens), "mix-output"],
    [
      "cache",
      number(stats.cacheReadTokens) + number(stats.cacheWriteTokens),
      "mix-cache",
    ],
    ["reasoning", number(stats.reasoningTokens), "mix-reasoning"],
  ];
  let cursor = 58;

  return segments
    .map(([label, value, klass]) => {
      const width = total
        ? Math.max(value > 0 ? 3 : 0, (value / total) * 478)
        : 0;
      const rect = `<rect class="${klass}" x="${cursor.toFixed(1)}" y="260" width="${width.toFixed(1)}" height="12"><title>${escapeXml(label)} · ${percent(value, total)}</title></rect>`;
      cursor += width;
      return rect;
    })
    .join("\n    ");
}

function metricBlock(x, y, label, value, note = "") {
  return `<text class="metric-label" x="${x}" y="${y}">${escapeXml(label)}</text>
  <text class="metric-value" x="${x}" y="${y + 34}">${escapeXml(value)}</text>${
    note
      ? `\n  <text class="metric-note" x="${x}" y="${y + 57}">${escapeXml(note)}</text>`
      : ""
  }`;
}

function sumClientTokens(client) {
  if (!client || typeof client !== "object") return 0;
  if (typeof client.totalTokens === "number") return number(client.totalTokens);
  const tokens = client.tokens || {};
  return (
    number(tokens.input) +
    number(tokens.output) +
    number(tokens.cacheRead) +
    number(tokens.cacheWrite) +
    number(tokens.reasoning)
  );
}

function modelTotalsForContribution(contribution) {
  const totals = new Map();

  for (const client of contribution.clients || []) {
    const entries = Object.entries(client.models || {});
    if (entries.length > 0) {
      for (const [rawModel, data] of entries) {
        const model = canonicalModelName(rawModel);
        if (!model) continue;
        totals.set(model, number(totals.get(model)) + number(data?.tokens));
      }
      continue;
    }

    const model = canonicalModelName(client.modelId);
    if (model) totals.set(model, number(totals.get(model)) + sumClientTokens(client));
  }

  return totals;
}

function dateRange(endDate, count) {
  const end = new Date(`${endDate}T00:00:00.000Z`);
  if (Number.isNaN(end.getTime())) return [];
  const dates = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const date = new Date(end);
    date.setUTCDate(end.getUTCDate() - offset);
    dates.push(date.toISOString().slice(0, 10));
  }
  return dates;
}

function buildModelMomentum(profile, count = 5) {
  const contributions = [...(profile.contributions || [])]
    .filter((entry) => entry && entry.date)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const endDate =
    profile.dateRange?.end || contributions.at(-1)?.date || new Date().toISOString().slice(0, 10);
  const dates = dateRange(endDate, TREND_DAYS);
  const indexByDate = new Map(dates.map((date, index) => [date, index]));
  const seriesByModel = new Map();

  for (const contribution of contributions) {
    const index = indexByDate.get(String(contribution.date));
    if (index === undefined) continue;
    for (const [model, tokens] of modelTotalsForContribution(contribution)) {
      const series = seriesByModel.get(model) || Array(TREND_DAYS).fill(0);
      series[index] += tokens;
      seriesByModel.set(model, series);
    }
  }

  const recentStart = Math.max(0, TREND_DAYS - COMPARISON_DAYS);
  const priorStart = Math.max(0, recentStart - COMPARISON_DAYS);
  const priorEnd = recentStart;
  const allSeries = [...seriesByModel.entries()];
  const totalRecent = allSeries.reduce(
    (total, [, series]) => total + series.slice(recentStart).reduce((sum, value) => sum + value, 0),
    0,
  );
  const totalPrior = allSeries.reduce(
    (total, [, series]) =>
      total + series.slice(priorStart, priorEnd).reduce((sum, value) => sum + value, 0),
    0,
  );

  const metrics = allSeries
    .map(([model, series]) => {
      const recentTokens = series.slice(recentStart).reduce((sum, value) => sum + value, 0);
      const priorTokens = series
        .slice(priorStart, priorEnd)
        .reduce((sum, value) => sum + value, 0);
      const recentShare = totalRecent ? recentTokens / totalRecent : 0;
      const priorShare = totalPrior ? priorTokens / totalPrior : 0;
      const deltaPercentagePoints = (recentShare - priorShare) * 100;
      const direction =
        deltaPercentagePoints > 0.5
          ? "up"
          : deltaPercentagePoints < -0.5
            ? "down"
            : "flat";
      return {
        model,
        series,
        recentTokens,
        priorTokens,
        recentShare,
        priorShare,
        deltaPercentagePoints,
        direction,
      };
    })
    .filter((entry) => entry.recentTokens > 0 || entry.priorTokens > 0)
    .sort((a, b) => b.recentTokens - a.recentTokens || b.deltaPercentagePoints - a.deltaPercentagePoints);

  const selected = metrics.slice(0, count);
  const minimumRiserVolume = Math.max(totalRecent * 0.005, 1_000_000);
  const fastestRiser = [...metrics]
    .filter((entry) => entry.recentTokens >= minimumRiserVolume)
    .sort(
      (a, b) =>
        b.deltaPercentagePoints - a.deltaPercentagePoints || b.recentTokens - a.recentTokens,
    )[0];

  if (
    fastestRiser &&
    !selected.some((entry) => entry.model === fastestRiser.model) &&
    selected.length > 0
  ) {
    selected[selected.length - 1] = fastestRiser;
    selected.sort(
      (a, b) => b.recentTokens - a.recentTokens || b.deltaPercentagePoints - a.deltaPercentagePoints,
    );
  }

  return {
    dates,
    recentStart,
    priorStart,
    priorEnd,
    totalRecent,
    totalPrior,
    rows: selected,
    leading: metrics[0] || null,
    fastestRiser: fastestRiser || null,
  };
}

function sparkGeometry(series, x, y, width, height) {
  const maxValue = Math.max(...series, 1);
  const step = series.length > 1 ? width / (series.length - 1) : width;
  const points = series.map((value, index) => ({
    x: x + index * step,
    y: y + height - (number(value) / maxValue) * height,
  }));
  const line = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(" ");
  const area = points.length
    ? `M${points[0].x.toFixed(1)} ${(y + height).toFixed(1)} ${points
        .map((point) => `L${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
        .join(" ")} L${points.at(-1).x.toFixed(1)} ${(y + height).toFixed(1)} Z`
    : `M${x} ${y + height}L${x + width} ${y + height}Z`;
  return { line, area, last: points.at(-1) || { x, y: y + height } };
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
  const modelRows =
    models
      .map((model, index) => {
        const y = 245 + index * 24;
        return `<text class="model-name" x="642" y="${y}">${escapeXml(model.model || "model")}</text><text class="model-value" x="1098" y="${y}" text-anchor="end">${escapeXml(compactTokens(model.tokens))}</text>`;
      })
      .join("\n  ") ||
    `<text class="model-name" x="642" y="245">${escapeXml(
      (all.clients || []).map(clientLabel).slice(0, 4).join(" / ") || "Tokscale profile",
    )}</text>`;

  const rank = user.rank ? `#${Number(user.rank).toLocaleString("en-US")}` : "not ranked";
  const dateLine = all.dateRange?.end
    ? `DATA THROUGH ${String(all.dateRange.end).toUpperCase()}`
    : `UPDATED ${formatDate(all.updatedAt).toUpperCase()}`;
  const generated = new Date().toISOString();
  const totalTokens = number(stats.totalTokens);
  const title = `${username} Tokscale activity trace`;
  const desc = `${compactTokens(totalTokens)} all-time tokens, ${compactCost(
    stats.totalCost,
  )} estimated all-time cost, ${monthStats.activeDays || 0} active days in the current 30-day window.`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 350" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXml(title)}</title>
  <desc id="desc">${escapeXml(desc)}</desc>
  <!-- Generated from ${escapeXml(
    new URL(`/api/users/${encodeURIComponent(username)}`, base).href,
  )} at ${generated} -->
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

  <rect class="paper" width="1200" height="350" />
  <rect class="edge" x="1" y="1" width="1198" height="348" />
  <line class="rule" x1="58" y1="58" x2="1142" y2="58" />
  <text class="kicker" x="58" y="39">TOKSCALE / AI ACTIVITY TRACE</text>
  <text class="meta" x="1142" y="39" text-anchor="end">PUBLIC PROFILE / SCHEDULED REFRESH</text>

  ${metricBlock(
    58,
    96,
    "ALL TIME TOKENS",
    compactTokens(stats.totalTokens),
    `${compactCost(stats.totalCost)} ESTIMATED COST`,
  )}
  ${metricBlock(
    314,
    96,
    "30 DAY TOKENS",
    compactTokens(monthStats.totalTokens),
    `${monthStats.activeDays || 0} ACTIVE DAYS`,
  )}
  ${metricBlock(58, 180, "GLOBAL RANK", rank, `TOKENS SORT / ${user.username || username}`)}
  ${metricBlock(
    314,
    180,
    "SUBMISSIONS",
    compactNumber(number(stats.submissionCount)),
    `${compactNumber(number(stats.sessionCount))} SESSIONS`,
  )}

  <text class="model-label" x="58" y="249">TOKEN MIX</text>
  <rect x="58" y="260" width="478" height="12" fill="#e4ded1" />
  ${buildMixSegments(stats)}

  <text class="chart-title" x="642" y="96">30 DAY ACTIVITY FIELD</text>
  <text class="chart-note" x="642" y="119">${escapeXml(dateLine)} / HIGHEST DAY ${escapeXml(
    compactTokens(Math.max(...contributions.map((entry) => number(entry.totals?.tokens)), 0)),
  )}</text>
  <line class="grid" x1="642" y1="132" x2="1098" y2="132" />
  <line class="grid" x1="642" y1="168" x2="1098" y2="168" />
  <line class="grid" x1="642" y1="204" x2="1098" y2="204" />
  <g aria-label="Daily activity bars">
    ${bars}
  </g>
  <path class="trace" pathLength="1" d="${trace}" />

  <text class="model-label" x="642" y="225">TOP MODELS IN WINDOW</text>
  ${modelRows}
  <line class="rule" x1="58" y1="311" x2="1142" y2="311" />
  <text class="stamp" x="58" y="333">INPUT ${percent(
    stats.inputTokens,
    totalTokens,
  )} / OUTPUT ${percent(stats.outputTokens, totalTokens)} / CACHE ${percent(
    number(stats.cacheReadTokens) + number(stats.cacheWriteTokens),
    totalTokens,
  )} / REASONING ${percent(stats.reasoningTokens, totalTokens)}</text>
  <text class="stamp" x="642" y="333">SOURCE TOKSCALE.AI/U/${escapeXml(
    username,
  )} / GENERATED ${escapeXml(formatDate(generated).toUpperCase())}</text>
</svg>
`;
}

function renderMomentumSvg({ month, username, base }) {
  const momentum = buildModelMomentum(month, 5);
  const generated = new Date().toISOString();
  const leading = momentum.leading;
  const riser = momentum.fastestRiser;
  const firstRecentDate = momentum.dates[momentum.recentStart] || momentum.dates.at(-1);
  const lastDate = momentum.dates.at(-1);
  const priorFirstDate = momentum.dates[momentum.priorStart];
  const priorLastDate = momentum.dates[Math.max(momentum.priorStart, momentum.priorEnd - 1)];
  const rows = momentum.rows
    .map((entry, index) => {
      const top = 180 + index * 48;
      const textY = top + 22;
      const spark = sparkGeometry(entry.series, 355, top + 2, 540, 28);
      return `<g class="model-row" style="--delay:${index * 110}ms">
    <text class="row-rank" x="58" y="${textY}">${String(index + 1).padStart(2, "0")}</text>
    <text class="row-model" x="96" y="${textY}">${escapeXml(entry.model)}</text>
    <line class="row-baseline" x1="355" y1="${top + 30}" x2="895" y2="${top + 30}" />
    <line class="recent-boundary" x1="${(
      355 + (momentum.recentStart / (TREND_DAYS - 1)) * 540
    ).toFixed(1)}" y1="${top}" x2="${(
      355 + (momentum.recentStart / (TREND_DAYS - 1)) * 540
    ).toFixed(1)}" y2="${top + 31}" />
    <path class="spark-area ${entry.direction}" d="${spark.area}" />
    <path class="spark ${entry.direction}" pathLength="1" d="${spark.line}" />
    <circle class="spark-dot ${entry.direction}" cx="${spark.last.x.toFixed(1)}" cy="${spark.last.y.toFixed(1)}" r="3.5" />
    <text class="row-value" x="1032" y="${textY}" text-anchor="end">${escapeXml(
      compactTokens(entry.recentTokens),
    )}</text>
    <text class="row-delta ${entry.direction}" x="1142" y="${textY}" text-anchor="end">${escapeXml(
      signedPercentagePoints(entry.deltaPercentagePoints),
    )}</text>
    <line class="row-rule" x1="58" y1="${top + 41}" x2="1142" y2="${top + 41}" />
  </g>`;
    })
    .join("\n  ");

  const emptyRows = momentum.rows.length
    ? ""
    : `<text class="empty" x="58" y="245">NO MODEL-LEVEL ACTIVITY RECORDED IN THIS WINDOW</text>`;
  const title = `${username} personal model momentum`;
  const desc = `Thirty-day model activity with the latest seven days compared with the preceding seven days.`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 450" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXml(title)}</title>
  <desc id="desc">${escapeXml(desc)}</desc>
  <!-- Generated from ${escapeXml(
    new URL(`/api/users/${encodeURIComponent(username)}?period=month`, base).href,
  )} at ${generated} -->
  <style>
    :root {
      --paper: #f1ede4;
      --paper-deep: #e4ded1;
      --ink: #10231f;
      --ink-soft: #304943;
      --rust: #c9482b;
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
    .edge, .rule, .row-rule, .row-baseline, .recent-boundary { fill: none; stroke: #b9b2a5; }
    .edge { stroke: #10231f; stroke-width: 2; }
    .rule { stroke-width: 1; }
    .row-rule { stroke-width: 0.8; opacity: 0.6; }
    .row-baseline { stroke-width: 1; opacity: 0.8; }
    .recent-boundary { stroke-width: 1; stroke-dasharray: 3 4; opacity: 0.7; }
    .kicker { fill: #c9482b; font-family: ui-monospace, "SFMono-Regular", Consolas, monospace; font-size: 14px; font-weight: 700; letter-spacing: 2px; }
    .meta, .summary-label, .column-label, .row-rank, .stamp { fill: #304943; font-family: ui-monospace, "SFMono-Regular", Consolas, monospace; font-weight: 700; letter-spacing: 1px; }
    .meta { font-size: 11px; }
    .summary-label, .column-label { font-size: 10px; }
    .summary-value { fill: #10231f; font-family: "Arial Narrow", "Avenir Next Condensed", "Helvetica Neue", sans-serif; font-size: 23px; font-weight: 800; }
    .summary-note { fill: #304943; font-family: "Avenir Next", "Segoe UI", "Helvetica Neue", sans-serif; font-size: 11px; font-weight: 600; }
    .row-rank { font-size: 11px; }
    .row-model { fill: #10231f; font-family: "Avenir Next", "Segoe UI", "Helvetica Neue", sans-serif; font-size: 15px; font-weight: 700; }
    .row-value, .row-delta { font-family: ui-monospace, "SFMono-Regular", Consolas, monospace; font-size: 12px; font-weight: 700; letter-spacing: 0.5px; }
    .row-value { fill: #10231f; }
    .row-delta.up { fill: #c9482b; }
    .row-delta.down { fill: #173e50; }
    .row-delta.flat { fill: #445d50; }
    .spark { fill: none; stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 1; stroke-dashoffset: 1; animation: draw 1300ms var(--ease-out) forwards; animation-delay: var(--delay); }
    .spark.up { stroke: #c9482b; }
    .spark.down { stroke: #173e50; }
    .spark.flat { stroke: #445d50; }
    .spark-area { opacity: 0.09; }
    .spark-area.up, .spark-dot.up { fill: #c9482b; }
    .spark-area.down, .spark-dot.down { fill: #173e50; }
    .spark-area.flat, .spark-dot.flat { fill: #445d50; }
    .spark-dot { transform-box: fill-box; transform-origin: center; animation: ping 650ms var(--ease-out) both; animation-delay: calc(var(--delay) + 900ms); }
    .model-row { animation: reveal 500ms var(--ease-out) both; animation-delay: var(--delay); }
    .stamp { font-size: 10px; }
    .empty { fill: #304943; font-family: ui-monospace, "SFMono-Regular", Consolas, monospace; font-size: 13px; font-weight: 700; letter-spacing: 1px; }
    @keyframes draw { to { stroke-dashoffset: 0; } }
    @keyframes reveal { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes ping { from { opacity: 0; transform: scale(0.3); } to { opacity: 1; transform: scale(1); } }
    @media (prefers-reduced-motion: reduce) {
      .spark, .spark-dot, .model-row { animation: none; }
      .spark { stroke-dashoffset: 0; }
    }
  </style>

  <rect class="paper" width="1200" height="450" />
  <rect class="edge" x="1" y="1" width="1198" height="448" />
  <line class="rule" x1="58" y1="58" x2="1142" y2="58" />
  <text class="kicker" x="58" y="39">TOKSCALE / PERSONAL MODEL MOMENTUM</text>
  <text class="meta" x="1142" y="39" text-anchor="end">LATEST 7 DAYS / PREVIOUS 7 DAYS</text>

  <text class="summary-label" x="58" y="87">LEADING NOW</text>
  <text class="summary-value" x="58" y="116">${escapeXml(leading?.model || "NO MODEL DATA")}</text>
  <text class="summary-note" x="58" y="134">${escapeXml(
    leading ? `${compactTokens(leading.recentTokens)} IN LATEST 7D` : "",
  )}</text>

  <text class="summary-label" x="420" y="87">FASTEST RISER</text>
  <text class="summary-value" x="420" y="116">${escapeXml(riser?.model || "NO CHANGE")}</text>
  <text class="summary-note" x="420" y="134">${escapeXml(
    riser ? `${signedPercentagePoints(riser.deltaPercentagePoints)} SHARE SHIFT` : "",
  )}</text>

  <text class="summary-label" x="822" y="87">7 DAY MODEL TOKENS</text>
  <text class="summary-value" x="822" y="116">${escapeXml(compactTokens(momentum.totalRecent))}</text>
  <text class="summary-note" x="822" y="134">${escapeXml(
    `${formatShortDate(firstRecentDate)} — ${formatShortDate(lastDate)}`,
  )}</text>

  <line class="rule" x1="58" y1="151" x2="1142" y2="151" />
  <text class="column-label" x="58" y="169">RANK / MODEL</text>
  <text class="column-label" x="355" y="169">30 DAY TRACE / DASHED LINE MARKS LATEST 7D</text>
  <text class="column-label" x="1032" y="169" text-anchor="end">LATEST 7D</text>
  <text class="column-label" x="1142" y="169" text-anchor="end">SHARE SHIFT</text>

  ${rows}
  ${emptyRows}

  <text class="stamp" x="58" y="430">BASELINE ${escapeXml(
    `${formatShortDate(priorFirstDate)} — ${formatShortDate(priorLastDate)}`,
  )}</text>
  <text class="stamp" x="1142" y="430" text-anchor="end">SOURCE TOKSCALE.AI/U/${escapeXml(
    username,
  )} / GENERATED ${escapeXml(formatDate(generated).toUpperCase())}</text>
</svg>
`;
}

function serializeMomentum(momentum) {
  return {
    dates: momentum.dates,
    latestWindow: {
      start: momentum.dates[momentum.recentStart] || null,
      end: momentum.dates.at(-1) || null,
      totalTokens: momentum.totalRecent,
    },
    previousWindow: {
      start: momentum.dates[momentum.priorStart] || null,
      end: momentum.dates[Math.max(momentum.priorStart, momentum.priorEnd - 1)] || null,
      totalTokens: momentum.totalPrior,
    },
    models: momentum.rows.map((entry) => ({
      model: entry.model,
      recentTokens: entry.recentTokens,
      priorTokens: entry.priorTokens,
      recentShare: entry.recentShare,
      priorShare: entry.priorShare,
      deltaPercentagePoints: entry.deltaPercentagePoints,
      direction: entry.direction,
      series: entry.series,
    })),
  };
}

function buildMeta({ all, month, username, base }) {
  const momentum = buildModelMomentum(month, 5);
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
    topModels: topModels(month, 5).map((model) => ({
      model: model.model,
      tokens: number(model.tokens),
      cost: number(model.cost),
    })),
    modelMomentum: serializeMomentum(momentum),
    updatedAt: all.updatedAt || null,
  };
}

const args = parseArgs(process.argv.slice(2));
const fs = await import("node:fs/promises");
const path = await import("node:path");
const profiles = await loadProfiles(args);
const svg = renderSvg({
  all: profiles.all,
  month: profiles.month,
  username: args.username,
  base: args.base,
});
const trendsSvg = renderMomentumSvg({
  month: profiles.month,
  username: args.username,
  base: args.base,
});
const meta = buildMeta({
  all: profiles.all,
  month: profiles.month,
  username: args.username,
  base: args.base,
});

await fs.mkdir(path.dirname(args.out), { recursive: true });
await fs.writeFile(args.out, svg, "utf8");
if (args.trendsOut) {
  await fs.mkdir(path.dirname(args.trendsOut), { recursive: true });
  await fs.writeFile(args.trendsOut, trendsSvg, "utf8");
}
if (args.meta) {
  await fs.mkdir(path.dirname(args.meta), { recursive: true });
  await fs.writeFile(args.meta, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
}

console.log(`Rendered Tokscale dossier for ${args.username} to ${args.out}`);
console.log(`Rendered Tokscale model momentum to ${args.trendsOut}`);
