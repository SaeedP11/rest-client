import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  ConflictException,
  HttpClient,
  IPagination,
  NotFoundException,
  ReadResourceService,
  ResourceService,
  SimpleFilterOperator,
} from "../index";
import { ITestServer, json, startServer } from "./helper/test-server";

interface IPost {
  id: string;
  owner: string;
  createdAt: Date;
  title: string;
  views: number;
}

interface IPostCredentials {
  post: IPost;
  secret: string;
}

class PostService extends ResourceService<
  IPost,
  { title: string },
  { title?: string },
  IPostCredentials
> {
  constructor(http: HttpClient) {
    super(http, "/post");
  }

  async publish(id: string): Promise<IPost> {
    return (await this.axios.post<IPost>(`${this.route}/${id}/publish`)).data;
  }
}

let server: ITestServer;
let http: HttpClient;
let posts: PostService;

const last = () => server.requests[server.requests.length - 1];
const query = () => new URL(last().url, "http://x").searchParams;

beforeAll(async () => {
  server = await startServer();
  http = new HttpClient({ baseUrl: `${server.url}/api` });
  http.setTokens({ accessToken: "a" });
  posts = new PostService(http);
});
afterAll(() => server.close());
beforeEach(() => {
  server.requests.length = 0;
  server.handle((req, res) =>
    json(res, 200, { method: req.method, url: req.url }),
  );
});

describe("ResourceService", () => {
  it("create POSTs the body to the route", async () => {
    server.handle((req, res) =>
      json(res, 201, {
        post: { id: "1", ...JSON.parse(req.text) },
        secret: "s",
      }),
    );
    const created = await posts.create({ title: "hi" });
    expect(created).toEqual({ post: { id: "1", title: "hi" }, secret: "s" });
    expect(last().method).toBe("POST");
    expect(last().url).toBe("/api/post");
    expect(JSON.parse(last().text)).toEqual({ title: "hi" });
  });

  it("getById GETs /:id", async () => {
    await posts.getById("abc");
    expect([last().method, last().url]).toEqual(["GET", "/api/post/abc"]);
  });

  it("get sends no query by default", async () => {
    await posts.get();
    expect([last().method, last().url]).toEqual(["GET", "/api/post"]);
  });

  it("get sends filter and search as JSON", async () => {
    server.handle((_, res) => json(res, 200, [{ id: "1" }]));
    const filter = [
      {
        field: "views" as const,
        operator: SimpleFilterOperator.GTE,
        value: 10,
      },
    ];
    const search = [
      {
        field: "title" as const,
        operator: SimpleFilterOperator.ILIKE,
        value: "x",
      },
    ];
    expect(await posts.get({ filter, search })).toEqual([{ id: "1" }]);
    expect(JSON.parse(query().get("filter")!)).toEqual(filter);
    expect(JSON.parse(query().get("search")!)).toEqual(search);
  });

  it("getPaginate GETs /paginate with the options", async () => {
    const page: IPagination<IPost> = {
      items: [],
      totalItems: 0,
      totalPages: 0,
      page: 3,
      limit: 5,
    };
    server.handle((_, res) => json(res, 200, page));
    expect(
      await posts.getPaginate({ page: 3, limit: 5, sort: "-createdAt" }),
    ).toEqual(page);
    expect(new URL(last().url, "http://x").pathname).toBe("/api/post/paginate");
    expect(Object.fromEntries(query())).toEqual({
      page: "3",
      limit: "5",
      sort: "-createdAt",
    });
  });

  it("getPaginate sends no query by default", async () => {
    await posts.getPaginate();
    expect(last().url).toBe("/api/post/paginate");
  });

  it("update PATCHes /:id with the body", async () => {
    await posts.update("abc", { title: "new" });
    expect([last().method, last().url]).toEqual(["PATCH", "/api/post/abc"]);
    expect(JSON.parse(last().text)).toEqual({ title: "new" });
  });

  it("delete DELETEs /:id", async () => {
    await posts.delete("abc");
    expect([last().method, last().url]).toEqual(["DELETE", "/api/post/abc"]);
  });

  it("percent-encodes the id in /:id routes", async () => {
    await posts.getById("a/b?c");
    expect(last().url).toBe("/api/post/a%2Fb%3Fc");
    await posts.update("a b", { title: "t" });
    expect(last().url).toBe("/api/post/a%20b");
    await posts.delete("#1");
    expect(last().url).toBe("/api/post/%231");
  });

  it("sends the client's token", async () => {
    await posts.getById("abc");
    expect(last().headers.authorization).toBe("Bearer a");
  });

  it("lets a subclass add routes on the same axios and route", async () => {
    await posts.publish("abc");
    expect([last().method, last().url]).toEqual([
      "POST",
      "/api/post/abc/publish",
    ]);
    expect(last().headers.authorization).toBe("Bearer a");
  });

  it("throws the backend's errors", async () => {
    server.handle((_, res) => json(res, 404, { message: "Post not found" }));
    await expect(posts.getById("x")).rejects.toThrow(NotFoundException);
    server.handle((_, res) => json(res, 409, { message: "Published" }));
    await expect(posts.delete("x")).rejects.toThrow(ConflictException);
  });

  it("returns the response body as it is", async () => {
    server.handle((_, res) =>
      json(res, 200, { id: "abc", title: "t", views: 2 }),
    );
    expect(await posts.getById("abc")).toEqual({
      id: "abc",
      title: "t",
      views: 2,
    });
  });
});

describe("ReadResourceService", () => {
  class AlertService extends ReadResourceService<{ id: string }> {
    constructor(http: HttpClient) {
      super(http, "/alert");
    }

    async acknowledge(id: string) {
      return (await this.axios.post(`${this.route}/${id}/acknowledge`)).data;
    }
  }

  it("serves the read routes", async () => {
    const alerts = new AlertService(http);
    await alerts.getById("1");
    await alerts.get({ filter: [] });
    await alerts.getPaginate({ page: 1 });
    expect(server.requests.map((r) => [r.method, r.url])).toEqual([
      ["GET", "/api/alert/1"],
      ["GET", `/api/alert?filter=${encodeURIComponent("[]")}`],
      ["GET", "/api/alert/paginate?page=1"],
    ]);
  });

  it("has no write routes, only the subclass's own", async () => {
    const alerts = new AlertService(http) as unknown as Record<string, unknown>;
    expect(alerts.create).toBeUndefined();
    expect(alerts.update).toBeUndefined();
    expect(alerts.delete).toBeUndefined();
    await (alerts as unknown as AlertService).acknowledge("9");
    expect([last().method, last().url]).toEqual([
      "POST",
      "/api/alert/9/acknowledge",
    ]);
  });

  it("is the base of ResourceService", () => {
    expect(posts).toBeInstanceOf(ReadResourceService);
  });
});
