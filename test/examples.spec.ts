import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { main as crud } from "../examples/01-crud";
import { main as authRefresh } from "../examples/02-auth-refresh";
import { main as filterPaginate } from "../examples/03-filter-paginate";
import { main as events } from "../examples/04-events";
import { main as errors } from "../examples/05-errors";
import { IMockApi, startMockApi } from "../examples/mock-api";
import { closedPortUrl } from "./helper/test-server";

// Every example runs against the mock API, so a change that breaks one
// fails here. `pnpm examples` runs this file alone, with the examples' output
let api: IMockApi;
const log = process.env.EXAMPLES_LOG ? console.log : () => {};

beforeAll(async () => {
  api = await startMockApi();
});
afterAll(() => api.close());

describe("examples", () => {
  it("01-crud", async () => {
    const { renamed, liked } = await crud(api.url, log);
    expect(renamed.title).toBe("Hello, world");
    expect(liked.views).toBe(1);
  });

  it("02-auth-refresh", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rest-client-"));
    try {
      const { before, after, answers } = await authRefresh(
        api.url,
        join(dir, "tokens.json"),
        api.expireAccessTokens,
        log,
      );
      expect(answers).toEqual(Array(3).fill({ username: "demo" }));
      expect(after?.accessToken).not.toBe(before?.accessToken);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("03-filter-paginate", async () => {
    const { popular, found, first, last } = await filterPaginate(api.url, log);
    expect(popular.map((post) => post.title)).toEqual([
      "Note 11",
      "Note 10",
      "Note 8",
      "Note 7",
      "Note 5",
    ]);
    expect(found).toHaveLength(6);
    expect(first.items.map((post) => post.views)).toEqual([
      110, 100, 90, 80, 70,
    ]);
    expect([first.totalItems, first.totalPages]).toEqual([10, 2]);
    expect(last.items).toHaveLength(5);
  });

  it("04-events", async () => {
    const received = await events(api.url, log);
    expect(received.map((event) => event.type)).toEqual(["created", "deleted"]);
  });

  it("05-errors", async () => {
    expect(await errors(api.url, await closedPortUrl(), log)).toEqual({
      wrongPassword: "please sign in again",
      signedOut: "please sign in again",
      login: "ok",
      invalid:
        "fix the form: title should not be empty, title must be a string",
      first: "ok",
      duplicate: "conflict: a post with this title exists",
      missing: "it is gone",
      badPage: "fix the form: limit must be between 5 and 50",
      offline: "offline? (ECONNREFUSED)",
    });
  });
});
