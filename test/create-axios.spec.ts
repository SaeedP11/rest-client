import { Readable } from "stream";
import { AxiosResponse } from "axios";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { ConflictException, createAxios, NotFoundException } from "../index";
import { ITestServer, json, startServer } from "./helper/test-server";

let server: ITestServer;

beforeAll(async () => {
  server = await startServer();
});
afterAll(() => server.close());
beforeEach(() => {
  server.requests.length = 0;
  server.handle((req, res) => json(res, 200, { echo: req.text }));
});

describe("createAxios: requests", () => {
  it("resolves routes against the base URL", async () => {
    await createAxios(`${server.url}/api`).get("/post/1");
    expect(server.requests[0].url).toBe("/api/post/1");
  });

  it("sends objects as JSON", async () => {
    await createAxios(server.url).post("/x", { a: 1, nested: { b: [2] } });
    const [req] = server.requests;
    expect(req.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(req.text)).toEqual({ a: 1, nested: { b: [2] } });
  });

  it("sends arrays as JSON", async () => {
    await createAxios(server.url).put("/x", [1, "two"]);
    expect(JSON.parse(server.requests[0].text)).toEqual([1, "two"]);
  });

  it("sends class instances as JSON of their fields", async () => {
    class Dto {
      constructor(public readonly name: string) {}
    }
    await createAxios(server.url).post("/x", new Dto("n"));
    expect(JSON.parse(server.requests[0].text)).toEqual({ name: "n" });
  });

  it("sends strings as they are", async () => {
    await createAxios(server.url).post("/x", "already text");
    expect(server.requests[0].text).toBe("already text");
  });

  it("sends no body when there is none", async () => {
    await createAxios(server.url).post("/x");
    expect(server.requests[0].body.length).toBe(0);
  });

  it("sends FormData as multipart, file and fields intact", async () => {
    const form = new FormData();
    form.set("file", new Blob(["file body"], { type: "text/plain" }), "a.txt");
    form.set("title", "hello");
    await createAxios(server.url).post("/upload", form);
    const [req] = server.requests;
    expect(req.headers["content-type"]).toMatch(
      /^multipart\/form-data; boundary=/,
    );
    expect(req.text).toContain('name="file"; filename="a.txt"');
    expect(req.text).toContain("file body");
    expect(req.text).toContain('name="title"');
    expect(req.text).toContain("hello");
  });

  it("sends URLSearchParams as a urlencoded form", async () => {
    await createAxios(server.url).post(
      "/form",
      new URLSearchParams({ a: "1", b: "x y" }),
    );
    const [req] = server.requests;
    expect(req.headers["content-type"]).toBe(
      "application/x-www-form-urlencoded",
    );
    expect(req.text).toBe("a=1&b=x+y");
  });

  it("sends Buffers, ArrayBuffers, Blobs and streams as raw bytes", async () => {
    const axios = createAxios(server.url);
    await axios.post("/b", Buffer.from("buffer"));
    await axios.post("/b", new TextEncoder().encode("arraybuffer").buffer);
    await axios.post("/b", new Blob(["blob"]));
    await axios.post(
      "/b",
      Readable.from([Buffer.from("str"), Buffer.from("eam")]),
    );
    expect(server.requests.map((req) => req.text)).toEqual([
      "buffer",
      "arraybuffer",
      "blob",
      "stream",
    ]);
  });

  it("adds the extra headers to every request", async () => {
    await createAxios(server.url, { "X-App": "demo" }).get("/x");
    expect(server.requests[0].headers["x-app"]).toBe("demo");
  });

  it("lets a request override the content type", async () => {
    await createAxios(server.url).post("/x", "<a/>", {
      headers: { "Content-Type": "application/xml" },
    });
    expect(server.requests[0].headers["content-type"]).toBe("application/xml");
  });
});

describe("createAxios: responses", () => {
  it("parses JSON objects and arrays", async () => {
    const axios = createAxios(server.url);
    server.handle((_, res) => json(res, 200, { a: [1, { b: true }] }));
    expect((await axios.get("/x")).data).toEqual({ a: [1, { b: true }] });
    server.handle((_, res) => json(res, 200, [1, 2]));
    expect((await axios.get("/x")).data).toEqual([1, 2]);
  });

  it.each([
    ["plain text", "plain text"],
    ["JSON number", "123"],
    ["JSON string", '"quoted"'],
    ["JSON null", "null"],
    ["empty body", ""],
    ["broken JSON", '{"a":'],
  ])("leaves a %s as the text it was", async (_, body) => {
    server.handle((_, res) => {
      res.writeHead(200);
      res.end(body);
    });
    expect((await createAxios(server.url).get("/x")).data).toBe(body);
  });

  it("returns binary responses untouched", async () => {
    const bytes = Buffer.from([0, 1, 2, 255, 123]);
    server.handle((_, res) => {
      res.writeHead(200, { "Content-Type": "application/octet-stream" });
      res.end(bytes);
    });
    const { data } = await createAxios(server.url).get("/x", {
      responseType: "arraybuffer",
    });
    expect(Buffer.from(data).equals(bytes)).toBe(true);
  });

  it("resolves every 2xx", async () => {
    server.handle((_, res) => {
      res.writeHead(204);
      res.end();
    });
    expect((await createAxios(server.url).delete("/x")).status).toBe(204);
  });

  it("throws the exception for an error status, with the server's message", async () => {
    server.handle((_, res) => json(res, 404, { message: "no such post" }));
    const error = await createAxios(server.url)
      .get("/x")
      .catch((e) => e);
    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.message).toBe("no such post");
  });

  it("throws for an error on a binary request, decoding its JSON body", async () => {
    server.handle((_, res) => json(res, 409, { message: "busy" }));
    const error = await createAxios(server.url)
      .get("/x", { responseType: "arraybuffer" })
      .catch((e) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.message).toBe("busy");
  });

  it("treats 3xx without a redirect target as an error", async () => {
    server.handle((_, res) => {
      res.writeHead(304);
      res.end();
    });
    const error = await createAxios(server.url)
      .get("/x")
      .catch((e) => e);
    expect(error.status).toBe(304);
  });
});

describe("createAxios: recover", () => {
  it("is not called for a success", async () => {
    const recover = vi.fn();
    await createAxios(server.url, {}, recover).get("/x");
    expect(recover).not.toHaveBeenCalled();
  });

  it("gets the error response and lets it through when it returns undefined", async () => {
    server.handle((_, res) => json(res, 404, { message: "nope" }));
    const recover = vi.fn(async (_response: AxiosResponse) => undefined);
    const error = await createAxios(server.url, {}, recover)
      .get("/x")
      .catch((e) => e);
    expect(error).toBeInstanceOf(NotFoundException);
    expect(recover).toHaveBeenCalledTimes(1);
    expect(recover.mock.calls[0][0]).toMatchObject({
      status: 404,
      data: { message: "nope" },
    });
  });

  it("answers with the response it returns instead", async () => {
    server.handle((_, res) => json(res, 401, { message: "expired" }));
    const axios = createAxios(server.url, {}, async (response) => ({
      ...response,
      status: 200,
      data: "recovered",
    }));
    expect((await axios.get("/x")).data).toBe("recovered");
  });

  it("propagates an error it throws", async () => {
    server.handle((_, res) => json(res, 401, {}));
    const axios = createAxios(server.url, {}, async () => {
      throw new Error("refresh failed");
    });
    await expect(axios.get("/x")).rejects.toThrow("refresh failed");
  });
});
