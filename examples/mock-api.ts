/**
 * A small in-memory stand-in for a nova-mongoose backend, so the examples run
 * without one. It serves, under `/api`:
 *
 * - `POST /auth/login` (`demo` / `demo`) and `POST /auth/refresh`, whose
 *   refresh tokens are good for one use
 * - the CRUD routes of `/post`, with `filter`, `search`, `sort`, `page` and
 *   `limit` read the way nova-mongoose reads them
 * - `GET /post/live`, a server-sent event per post created or deleted
 *
 * and answers errors in NestJS's shape: `{ statusCode, message }`.
 */
import { createServer, IncomingMessage, ServerResponse } from "http";
import { AddressInfo } from "net";

export interface IPost {
  id: string;
  owner: string;
  createdAt: Date;
  title: string;
  views: number;
}

export interface IMockApi {
  /** `http://127.0.0.1:<port>/api` */
  url: string;
  /** Makes every access token handed out so far expire, to show a refresh */
  expireAccessTokens(): void;
  close(): Promise<void>;
}

interface IFilter {
  field: string;
  operator: string;
  value: unknown;
}

class ApiError {
  constructor(
    readonly status: number,
    readonly message: string | string[],
  ) {}
}

const send = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

const readBody = (req: IncomingMessage): Promise<any> =>
  new Promise((resolve) => {
    let text = "";
    req.on("data", (chunk) => (text += chunk));
    req.on("end", () => resolve(text ? JSON.parse(text) : {}));
  });

const matches = (post: IPost, { field, operator, value }: IFilter): boolean => {
  const actual = (post as unknown as Record<string, unknown>)[field] as any;
  const v = value as any;
  switch (operator) {
    case "EQ":
      return actual === v;
    case "NE":
      return actual !== v;
    case "GT":
      return actual > v;
    case "GTE":
      return actual >= v;
    case "LT":
      return actual < v;
    case "LTE":
      return actual <= v;
    case "IN":
      return (v as unknown[]).includes(actual);
    case "BETWEEN":
      return actual >= v[0] && actual <= v[1];
    case "LIKE":
      return String(actual).includes(String(v));
    case "ILIKE":
      return String(actual).toLowerCase().includes(String(v).toLowerCase());
    default:
      throw new ApiError(400, `${operator} is not supported by the mock`);
  }
};

/** `filter` items all match (AND), and at least one `search` item (OR) */
const select = (posts: IPost[], query: URLSearchParams): IPost[] => {
  const filter: IFilter[] = JSON.parse(query.get("filter") ?? "[]");
  const search: IFilter[] = JSON.parse(query.get("search") ?? "[]");
  return posts.filter(
    (post) =>
      filter.every((item) => matches(post, item)) &&
      (!search.length || search.some((item) => matches(post, item))),
  );
};

/** `-views,+title`; newest first by default */
const sortBy = (posts: IPost[], sort = "-createdAt"): IPost[] => {
  const keys = sort
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((token) => ({
      field: token.replace(/^[+-]/, "") as keyof IPost,
      direction: token.startsWith("-") ? -1 : 1,
    }));
  return [...posts].sort((a, b) => {
    for (const { field, direction } of keys) {
      if (a[field] < b[field]) return -direction;
      if (a[field] > b[field]) return direction;
    }
    return 0;
  });
};

export const startMockApi = async (): Promise<IMockApi> => {
  const posts: IPost[] = [];
  const accessTokens = new Map<string, string>();
  const refreshTokens = new Map<string, string>();
  const listeners = new Set<ServerResponse>();
  let counter = 0;

  const issueTokens = (username: string) => {
    const n = ++counter;
    accessTokens.set(`access-${n}`, username);
    refreshTokens.set(`refresh-${n}`, username);
    return { accessToken: `access-${n}`, refreshToken: `refresh-${n}` };
  };

  const broadcast = (type: string, data: unknown) => {
    for (const res of listeners) {
      res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    }
  };

  const findPost = (id: string): IPost => {
    const post = posts.find((item) => item.id === id);
    if (!post) throw new ApiError(404, "post not found");
    return post;
  };

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://mock");
    const path = url.pathname.replace(/^\/api/, "");
    const method = req.method ?? "GET";

    if (method === "POST" && path === "/auth/login") {
      const { username, password } = await readBody(req);
      if (username !== "demo" || password !== "demo") {
        throw new ApiError(401, "wrong username or password");
      }
      return send(res, 201, issueTokens(username));
    }
    if (method === "POST" && path === "/auth/refresh") {
      const { refreshToken } = await readBody(req);
      const username = refreshTokens.get(refreshToken);
      if (!username) throw new ApiError(401, "refresh token is not valid");
      refreshTokens.delete(refreshToken);
      return send(res, 201, issueTokens(username));
    }

    const token = req.headers.authorization?.replace(/^Bearer /, "") ?? "";
    const user = accessTokens.get(token);
    if (!user) throw new ApiError(401, "Unauthorized");

    if (method === "GET" && path === "/auth/me") {
      return send(res, 200, { username: user });
    }
    if (method === "GET" && path === "/post/live") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
      });
      res.write(": connected\n\n");
      listeners.add(res);
      req.on("close", () => listeners.delete(res));
      return;
    }
    if (method === "GET" && path === "/post") {
      return send(res, 200, sortBy(select(posts, url.searchParams)));
    }
    if (method === "GET" && path === "/post/paginate") {
      const page = Number(url.searchParams.get("page") ?? 1);
      const limit = Number(url.searchParams.get("limit") ?? 10);
      if (limit < 5 || limit > 50) {
        throw new ApiError(400, ["limit must be between 5 and 50"]);
      }
      const all = sortBy(
        select(posts, url.searchParams),
        url.searchParams.get("sort") ?? undefined,
      );
      return send(res, 200, {
        items: all.slice((page - 1) * limit, page * limit),
        totalItems: all.length,
        totalPages: Math.ceil(all.length / limit),
        page,
        limit,
      });
    }
    if (method === "POST" && path === "/post") {
      const { title, views = 0 } = await readBody(req);
      if (typeof title !== "string" || !title) {
        throw new ApiError(400, [
          "title should not be empty",
          "title must be a string",
        ]);
      }
      if (posts.some((post) => post.title === title)) {
        throw new ApiError(409, "a post with this title exists");
      }
      const post: IPost = {
        id: String(++counter),
        owner: user,
        createdAt: new Date(),
        title,
        views,
      };
      posts.push(post);
      broadcast("created", post);
      return send(res, 201, post);
    }

    const id = decodeURIComponent(path.match(/^\/post\/([^/]+)$/)?.[1] ?? "");
    if (id && method === "GET") return send(res, 200, findPost(id));
    if (id && method === "PATCH") {
      const post = findPost(id);
      Object.assign(post, await readBody(req));
      return send(res, 200, post);
    }
    if (id && method === "DELETE") {
      const post = findPost(id);
      posts.splice(posts.indexOf(post), 1);
      broadcast("deleted", { id });
      return send(res, 200, post);
    }
    throw new ApiError(404, `Cannot ${method} ${url.pathname}`);
  };

  const server = createServer((req, res) => {
    handle(req, res).catch((error) => {
      if (error instanceof ApiError) {
        return send(res, error.status, {
          statusCode: error.status,
          message: error.message,
        });
      }
      send(res, 500, { statusCode: 500, message: "Internal server error" });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}/api`,
    expireAccessTokens: () => accessTokens.clear(),
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
};
