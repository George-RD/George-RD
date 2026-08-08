import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchUserRepositories,
  renderRepositoryStarsSvg,
  summarizeRepositories,
} from "../scripts/render-repository-stars.mjs";

test("summarizeRepositories counts only public non-fork repositories owned by the user", () => {
  const summary = summarizeRepositories(
    [
      {
        owner: { login: "George-RD" },
        private: false,
        fork: false,
        stargazers_count: 7,
      },
      {
        owner: { login: "george-rd" },
        private: false,
        fork: false,
        stargazers_count: 5,
      },
      {
        owner: { login: "George-RD" },
        private: false,
        fork: true,
        stargazers_count: 900,
      },
      {
        owner: { login: "George-RD" },
        private: true,
        fork: false,
        stargazers_count: 800,
      },
      {
        owner: { login: "someone-else" },
        private: false,
        fork: false,
        stargazers_count: 700,
      },
      {
        owner: { login: "George-RD" },
        private: false,
        fork: false,
        stargazers_count: "not-a-number",
      },
    ],
    "George-RD",
  );

  assert.deepEqual(summary, { repositoryCount: 3, totalStars: 12 });
});

test("fetchUserRepositories follows pagination and sends token headers", async () => {
  const requests = [];
  const batches = [
    [
      { id: 1 },
      { id: 2 },
    ],
    [{ id: 3 }],
  ];

  const repositories = await fetchUserRepositories("George-RD", {
    token: "test-token",
    perPage: 2,
    fetchImpl: async (url, options) => {
      requests.push({ url: new URL(url), options });
      const batch = batches.shift();
      return {
        ok: true,
        status: 200,
        json: async () => batch,
        text: async () => "",
      };
    },
  });

  assert.deepEqual(repositories, [{ id: 1 }, { id: 2 }, { id: 3 }]);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url.searchParams.get("page"), "1");
  assert.equal(requests[1].url.searchParams.get("page"), "2");
  assert.equal(requests[0].options.headers.Authorization, "Bearer test-token");
});

test("renderRepositoryStarsSvg uses a drawn icon and formats the total", () => {
  const svg = renderRepositoryStarsSvg({
    username: "George-RD",
    totalStars: 1234,
    repositoryCount: 27,
  });

  assert.match(svg, /1,234 STARS/);
  assert.match(svg, /27 public non-fork repositories/);
  assert.match(svg, /<path d=/);
  assert.doesNotMatch(svg, /★/);
});
