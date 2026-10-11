import { Axios } from "axios";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  ForbiddenException,
  HttpClient,
  NetworkException,
  TimeoutException,
  IServerSentEvent,
  ITokenStore,
  UnauthorizedException,
} from "../index";
import {
  closedPortUrl,
  ITestServer,
  json,
  startServer,
} from "./helper/test-server";

interface Tokens {
  accessToken: string;
  refreshToken: string;
  userId?: string;
}

const memoryStore = (initial?: Tokens) => {
  let value = initial;
  return {
    get: vi.fn(() => value),
    set: vi.fn((tokens: Tokens) => {
      value = tokens;
    }),
    del: vi.fn(() => {
      value = undefined;
    }),
    peek: () => value,
  } satisfies ITokenStore<Tokens> & { peek(): Tokens | undefined };
};

let server: ITestServer;

/** Accepts only `Bearer <valid>`; `/auth/refresh` trades r<n> for a<n+1> */
let valid = "a1";
let refreshCalls = 0;

const tokenServer = () => {
  server.handle(async (req, res) => {
    if (req.url === "/api/auth/refresh") {
      refreshCalls++;
      const { refreshToken } = JSON.parse(req.text);
      if (refreshToken === "revoked")
        return json(res, 401, { message: "refresh token revoked" });
      await new Promise((resolve) => setTimeout(resolve, 30));
      const n = Number(refreshToken.slice(1)) + 1;
      valid = `a${n}`;
      return json(res, 201, { accessToken: valid, refreshToken: `r${n}` });
    }
    if (req.url === "/api/forbidden") return json(res, 403, { message: "no" });
    if (req.url === "/api/public") return json(res, 200, { public: true });
    if (req.headers.authorization !== `Bearer ${valid}`)
      return json(res, 401, { message: "Unauthorized" });
    json(res, 200, { ok: true, body: req.text || undefined });
  });
};

const refresh = vi.fn(
  async (tokens: Tokens, publicAxios: Axios): Promise<Tokens> =>
    (
      await publicAxios.post<Tokens>("/auth/refresh", {
        refreshToken: tokens.refreshToken,
      })
    ).data,
);

const authHeaders = () =>
  server.requests.map((req) => req.headers.authorization);

beforeAll(async () => {
  server = await startServer();
});
afterAll(() => server.close());
beforeEach(() => {
  server.requests.length = 0;
  valid = "a1";
  refreshCalls = 0;
  refresh.mockClear();
  tokenServer();
});

describe("HttpClient: setup", () => {
  it("strips trailing slashes from the base URL", async () => {
    const client = new HttpClient({ baseUrl: `${server.url}/api///` });
    expect(client.baseUrl).toBe(`${server.url}/api`);
    await client.publicAxios.get("/public");
    expect(server.requests[0].url).toBe("/api/public");
  });

  it("starts signed out without a store", () => {
    expect(new HttpClient({ baseUrl: server.url }).getTokens()).toBeUndefined();
  });

  it("loads the tokens from the store once", () => {
    const store = memoryStore({ accessToken: "a1", refreshToken: "r1" });
    const client = new HttpClient({ baseUrl: server.url, tokenStore: store });
    expect(client.getTokens()).toEqual({
      accessToken: "a1",
      refreshToken: "r1",
    });
    client.getTokens();
    expect(store.get).toHaveBeenCalledTimes(1);
  });

  it("sends the extra headers from both instances", async () => {
    const client = new HttpClient({
      baseUrl: `${server.url}/api`,
      headers: { "Accept-Language": "fa" },
    });
    await client.publicAxios.get("/public");
    await client.axios.get("/public");
    expect(server.requests.map((r) => r.headers["accept-language"])).toEqual([
      "fa",
      "fa",
    ]);
  });
});

describe("HttpClient: timeout", () => {
  it("has none by default", () => {
    const client = new HttpClient({ baseUrl: server.url });
    expect(client.axios.defaults.timeout).toBeFalsy();
  });

  it("applies to both instances", async () => {
    server.handle(async (_, res) => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      json(res, 200, {});
    });
    const client = new HttpClient({ baseUrl: server.url, timeout: 20 });
    client.setTokens({ accessToken: "a" });
    await expect(client.axios.get("/slow")).rejects.toBeInstanceOf(
      TimeoutException,
    );
    await expect(client.publicAxios.get("/slow")).rejects.toBeInstanceOf(
      TimeoutException,
    );
  });
});

describe("HttpClient: tokens", () => {
  it("setTokens replaces them and saves them", () => {
    const store = memoryStore();
    const client = new HttpClient<Tokens>({
      baseUrl: server.url,
      tokenStore: store,
    });
    client.setTokens({ accessToken: "x", refreshToken: "y" });
    expect(client.getTokens()).toEqual({ accessToken: "x", refreshToken: "y" });
    expect(store.set).toHaveBeenCalledWith({
      accessToken: "x",
      refreshToken: "y",
    });
  });

  it("setTokens(undefined) and clearTokens sign out and empty the store", () => {
    const store = memoryStore({ accessToken: "x", refreshToken: "y" });
    const client = new HttpClient<Tokens>({
      baseUrl: server.url,
      tokenStore: store,
    });
    client.setTokens(undefined);
    expect(client.getTokens()).toBeUndefined();
    client.setTokens({ accessToken: "x", refreshToken: "y" });
    client.clearTokens();
    expect(client.getTokens()).toBeUndefined();
    expect(store.del).toHaveBeenCalledTimes(2);
    expect(store.peek()).toBeUndefined();
  });

  it("updateTokens merges into the current ones and saves the result", () => {
    const store = memoryStore({
      accessToken: "x",
      refreshToken: "y",
      userId: "u",
    });
    const client = new HttpClient<Tokens>({
      baseUrl: server.url,
      tokenStore: store,
    });
    client.updateTokens({ accessToken: "x2" });
    expect(client.getTokens()).toEqual({
      accessToken: "x2",
      refreshToken: "y",
      userId: "u",
    });
    expect(store.peek()).toEqual(client.getTokens());
  });

  it("updateTokens keeps a field passed as undefined", () => {
    const client = new HttpClient<Tokens>({ baseUrl: server.url });
    client.setTokens({ accessToken: "x", refreshToken: "y" });
    client.updateTokens({ accessToken: "x2", refreshToken: undefined });
    expect(client.getTokens()).toEqual({
      accessToken: "x2",
      refreshToken: "y",
    });
  });

  it("updateTokens throws when signed out", () => {
    const client = new HttpClient<Tokens>({ baseUrl: server.url });
    expect(() => client.updateTokens({ accessToken: "x" })).toThrow(
      /No tokens/,
    );
  });

  it("works without a store", () => {
    const client = new HttpClient<Tokens>({ baseUrl: server.url });
    client.setTokens({ accessToken: "x", refreshToken: "y" });
    client.updateTokens({ refreshToken: "z" });
    client.clearTokens();
    expect(client.getTokens()).toBeUndefined();
  });
});

describe("HttpClient: Authorization", () => {
  it("sends no Authorization while signed out", async () => {
    const client = new HttpClient({ baseUrl: `${server.url}/api` });
    await client.axios.get("/public");
    expect(authHeaders()).toEqual([undefined]);
  });

  it("sends the current access token as a Bearer token", async () => {
    const client = new HttpClient<Tokens>({ baseUrl: `${server.url}/api` });
    client.setTokens({ accessToken: "a1", refreshToken: "r1" });
    await client.axios.get("/me");
    client.setTokens({ accessToken: "a9", refreshToken: "r9" });
    await client.axios.get("/public");
    expect(authHeaders()).toEqual(["Bearer a1", "Bearer a9"]);
  });

  it("never sends it from publicAxios", async () => {
    const client = new HttpClient<Tokens>({ baseUrl: `${server.url}/api` });
    client.setTokens({ accessToken: "a1", refreshToken: "r1" });
    await client.publicAxios.get("/public");
    expect(authHeaders()).toEqual([undefined]);
  });
});

describe("HttpClient: refresh on 401", () => {
  const signedIn = (
    store = memoryStore({ accessToken: "stale", refreshToken: "r1" }),
  ) =>
    new HttpClient<Tokens>({
      baseUrl: `${server.url}/api`,
      tokenStore: store,
      refresh,
    });

  it("refreshes, saves the new tokens and retries with them", async () => {
    const store = memoryStore({ accessToken: "stale", refreshToken: "r1" });
    const client = signedIn(store);
    const { data } = await client.axios.get("/me");
    expect(data).toEqual({ ok: true });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh.mock.calls[0][0]).toEqual({
      accessToken: "stale",
      refreshToken: "r1",
    });
    expect(refresh.mock.calls[0][1]).toBe(client.publicAxios);
    expect(client.getTokens()).toEqual({
      accessToken: "a2",
      refreshToken: "r2",
    });
    expect(store.peek()).toEqual({ accessToken: "a2", refreshToken: "r2" });
    expect(
      server.requests.map((r) => [r.url, r.headers.authorization]),
    ).toEqual([
      ["/api/me", "Bearer stale"],
      ["/api/auth/refresh", undefined],
      ["/api/me", "Bearer a2"],
    ]);
  });

  it("retries with the same body", async () => {
    const client = signedIn();
    const { data } = await client.axios.post("/me", { name: "سلام" });
    expect(data.body).toBe(JSON.stringify({ name: "سلام" }));
    expect(server.requests[0].text).toBe(server.requests[2].text);
  });

  it("retries a multipart upload intact", async () => {
    const client = signedIn();
    const form = new FormData();
    form.set("file", new Blob(["bytes"]), "f.bin");
    await client.axios.post("/me", form);
    expect(server.requests[2].headers["content-type"]).toMatch(
      /^multipart\/form-data/,
    );
    expect(server.requests[2].text).toContain("bytes");
  });

  it("shares one refresh between requests that fail together", async () => {
    const client = signedIn();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => client.axios.get("/me")),
    );
    expect(results.every((r) => r.data.ok)).toBe(true);
    expect(refreshCalls).toBe(1);
  });

  it("does not refresh again for a 401 that arrives after the refresh ended", async () => {
    // /api/slow answers its 401 only once the refresh is over
    let refreshed!: () => void;
    const refreshDone = new Promise<void>((resolve) => (refreshed = resolve));
    server.handle(async (req, res) => {
      if (req.url === "/api/auth/refresh") {
        refreshCalls++;
        valid = "a2";
        json(res, 201, { accessToken: "a2", refreshToken: "r2" });
        return refreshed();
      }
      if (req.headers.authorization !== `Bearer ${valid}`) {
        if (req.url === "/api/slow") {
          await refreshDone;
          await new Promise((resolve) => setTimeout(resolve, 30));
        }
        return json(res, 401, {});
      }
      json(res, 200, { ok: true });
    });
    const client = signedIn();
    const results = await Promise.all([
      client.axios.get("/me"),
      client.axios.get("/slow"),
    ]);
    expect(results.map((r) => r.data.ok)).toEqual([true, true]);
    expect(refreshCalls).toBe(1);
    expect(client.getTokens()?.refreshToken).toBe("r2");
  });

  it("refreshes again when the new token expires later", async () => {
    const client = signedIn();
    await client.axios.get("/me");
    valid = "server-rotated";
    // r2 -> a3, which the server then accepts
    server.handle(async (req, res) => {
      if (req.url === "/api/auth/refresh") {
        refreshCalls++;
        valid = "a3";
        return json(res, 201, { accessToken: "a3", refreshToken: "r3" });
      }
      if (req.headers.authorization !== `Bearer ${valid}`)
        return json(res, 401, {});
      json(res, 200, { ok: true });
    });
    await client.axios.get("/me");
    expect(refreshCalls).toBe(2);
    expect(client.getTokens()?.accessToken).toBe("a3");
  });

  it("throws a second 401 instead of refreshing again", async () => {
    server.handle(async (req, res) => {
      if (req.url === "/api/auth/refresh")
        return json(res, 201, { accessToken: "still-bad", refreshToken: "r2" });
      json(res, 401, { message: "go away" });
    });
    const client = signedIn();
    const error = await client.axios.get("/me").catch((e) => e);
    expect(error).toBeInstanceOf(UnauthorizedException);
    expect(error.message).toBe("go away");
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(server.requests).toHaveLength(3);
  });

  it("signs out and throws the refresh's error when the refresh fails", async () => {
    const store = memoryStore({
      accessToken: "stale",
      refreshToken: "revoked",
    });
    const client = signedIn(store);
    const errors = await Promise.all([
      client.axios.get("/me").catch((e) => e),
      client.axios.get("/me").catch((e) => e),
    ]);
    for (const error of errors) {
      expect(error).toBeInstanceOf(UnauthorizedException);
      expect(error.message).toBe("refresh token revoked");
    }
    expect(refreshCalls).toBe(1);
    expect(client.getTokens()).toBeUndefined();
    expect(store.del).toHaveBeenCalled();
    // Signed out now: the next 401 is thrown without a refresh
    await expect(client.axios.get("/me")).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(refreshCalls).toBe(1);
  });

  it("signs out and throws a NetworkException when the refresh gets no answer", async () => {
    const client = new HttpClient<Tokens>({
      baseUrl: `${server.url}/api`,
      refresh: async (tokens) => {
        const offline = new HttpClient({ baseUrl: await closedPortUrl() });
        return (await offline.publicAxios.post<Tokens>("/refresh", tokens))
          .data;
      },
    });
    client.setTokens({ accessToken: "stale", refreshToken: "r1" });
    await expect(client.axios.get("/me")).rejects.toBeInstanceOf(
      NetworkException,
    );
    expect(client.getTokens()).toBeUndefined();
  });

  it("throws the 401 as it is without a refresh option", async () => {
    const client = new HttpClient<Tokens>({ baseUrl: `${server.url}/api` });
    client.setTokens({ accessToken: "stale", refreshToken: "r1" });
    await expect(client.axios.get("/me")).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(server.requests).toHaveLength(1);
    expect(client.getTokens()).toBeDefined();
  });

  it("does not refresh while signed out", async () => {
    const client = new HttpClient<Tokens>({
      baseUrl: `${server.url}/api`,
      refresh,
    });
    await expect(client.axios.get("/me")).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(refresh).not.toHaveBeenCalled();
  });

  it("does not refresh on other errors", async () => {
    const client = signedIn();
    await expect(client.axios.get("/forbidden")).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(refresh).not.toHaveBeenCalled();
  });

  it("does not refresh for publicAxios", async () => {
    const client = signedIn();
    await expect(client.publicAxios.get("/me")).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("HttpClient: stream", () => {
  it("follows a stream under the base URL with the current token", async () => {
    server.handle((_, res) => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end('event: hello\ndata: {"n":1}\n\n');
    });
    const client = new HttpClient<Tokens>({ baseUrl: `${server.url}/api/` });
    client.setTokens({ accessToken: "a1", refreshToken: "r1" });
    const events: IServerSentEvent[] = [];
    await client.stream("/device/1/live", (e) => events.push(e), {
      headers: { "X-Extra": "1" },
    });
    expect(events).toEqual([{ type: "hello", data: { n: 1 } }]);
    expect(server.requests[0].url).toBe("/api/device/1/live");
    expect(server.requests[0].headers.authorization).toBe("Bearer a1");
    expect(server.requests[0].headers["x-extra"]).toBe("1");
  });

  it("sends no token while signed out", async () => {
    server.handle((_, res) => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end();
    });
    await new HttpClient({ baseUrl: server.url }).stream("/live", () => {});
    expect(server.requests[0].headers.authorization).toBeUndefined();
  });

  it("throws on an expired token instead of refreshing", async () => {
    server.handle((_, res) => json(res, 401, { message: "expired" }));
    const client = new HttpClient<Tokens>({ baseUrl: server.url, refresh });
    client.setTokens({ accessToken: "stale", refreshToken: "r1" });
    await expect(client.stream("/live", () => {})).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(refresh).not.toHaveBeenCalled();
  });
});
