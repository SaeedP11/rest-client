import { describe, expect, it } from "vitest";
import { SimpleFilterOperator, stringifyQuery, withQuery } from "../index";

describe("stringifyQuery", () => {
  it("returns an empty string for an empty object", () => {
    expect(stringifyQuery({})).toBe("");
  });

  it("joins scalars as key=value pairs in insertion order", () => {
    expect(stringifyQuery({ page: 2, limit: 10, deleted: false, q: "x" })).toBe(
      "page=2&limit=10&deleted=false&q=x",
    );
  });

  it("leaves out undefined values but keeps null as text", () => {
    expect(stringifyQuery({ a: undefined, b: null, c: 0, d: "" })).toBe(
      "b=null&c=0&d=",
    );
  });

  it("sends dates as ISO strings", () => {
    const from = new Date("2026-01-02T03:04:05.678Z");
    expect(stringifyQuery({ from })).toBe(
      `from=${encodeURIComponent("2026-01-02T03:04:05.678Z")}`,
    );
  });

  it("sends filter and search arrays as JSON", () => {
    const filter = [
      { field: "status", operator: SimpleFilterOperator.IN, value: ["a", "b"] },
    ];
    const search = [
      { field: "name", operator: SimpleFilterOperator.ILIKE, value: "ali" },
    ];
    const query = stringifyQuery({ filter, search, sort: "-createdAt" });
    const params = new URLSearchParams(query);
    expect(JSON.parse(params.get("filter")!)).toEqual(filter);
    expect(JSON.parse(params.get("search")!)).toEqual(search);
    expect(params.get("sort")).toBe("-createdAt");
  });

  it("sends plain objects as JSON, with dates inside as ISO strings", () => {
    const date = new Date("2026-05-05T00:00:00.000Z");
    const query = stringifyQuery({ where: { at: date, n: 1 } });
    expect(JSON.parse(new URLSearchParams(query).get("where")!)).toEqual({
      at: "2026-05-05T00:00:00.000Z",
      n: 1,
    });
  });

  it("percent-encodes reserved and non-ASCII characters", () => {
    const query = stringifyQuery({ q: "a&b=c d/é?#", name: "سلام" });
    expect(query).not.toMatch(/[ #?/]|&b=/);
    const params = new URLSearchParams(query);
    expect(params.get("q")).toBe("a&b=c d/é?#");
    expect(params.get("name")).toBe("سلام");
  });

  it("keeps the sort prefix + intact", () => {
    // `+` would be a space if it were left unencoded
    expect(
      new URLSearchParams(stringifyQuery({ sort: "+name" })).get("sort"),
    ).toBe("+name");
  });
});

describe("withQuery", () => {
  it("returns the path alone when there is nothing to send", () => {
    expect(withQuery("/post")).toBe("/post");
    expect(withQuery("/post", {})).toBe("/post");
    expect(withQuery("/post", { page: undefined })).toBe("/post");
  });

  it("appends the query after a ?", () => {
    expect(withQuery("/post/paginate", { page: 1 })).toBe(
      "/post/paginate?page=1",
    );
  });
});
