import { ServerResponse } from "http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  IServerSentEvent,
  NotFoundException,
  parseEvent,
  readEventStream,
  UnauthorizedException,
} from "../index";
import {
  closedPortUrl,
  ITestServer,
  json,
  startServer,
} from "./helper/test-server";

const sse = (res: ServerResponse) =>
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
  });

const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

/** Writes the chunks with a pause between them, so each arrives on its own */
const writeSlowly = async (res: ServerResponse, chunks: string[]) => {
  sse(res);
  for (const chunk of chunks) {
    res.write(chunk);
    await tick(15);
  }
  res.end();
};

describe("parseEvent", () => {
  it("reads the event type and JSON data", () => {
    expect(parseEvent('event: snapshot\ndata: {"a":1}')).toEqual({
      type: "snapshot",
      data: { a: 1 },
    });
  });

  it("defaults the type to message", () => {
    expect(parseEvent("data: hi")).toEqual({ type: "message", data: "hi" });
  });

  it("joins several data lines with newlines", () => {
    expect(parseEvent("data: line one\ndata: line two")?.data).toBe(
      "line one\nline two",
    );
    expect(parseEvent('data: {"a":\ndata: 1}')?.data).toEqual({ a: 1 });
  });

  it("strips one leading space only, and takes a colon-less field as empty", () => {
    expect(parseEvent("data:  two spaces")?.data).toBe(" two spaces");
    expect(parseEvent("data:nospace")?.data).toBe("nospace");
    expect(parseEvent("data")?.data).toBe("");
  });

  it("keeps colons inside the value", () => {
    expect(parseEvent("data: a:b:c")?.data).toBe("a:b:c");
  });

  it("parses JSON scalars too", () => {
    expect(parseEvent("data: 5")?.data).toBe(5);
    expect(parseEvent("data: true")?.data).toBe(true);
    expect(parseEvent('data: "s"')?.data).toBe("s");
  });

  it("skips comments, unknown fields, and blocks without data", () => {
    expect(parseEvent(": keep-alive")).toBeUndefined();
    expect(parseEvent("event: ping")).toBeUndefined();
    expect(parseEvent("id: 3\nretry: 1000")).toBeUndefined();
    expect(parseEvent(": c\nid: 3\nevent: e\ndata: x")).toEqual({
      type: "e",
      data: "x",
    });
  });
});

describe("readEventStream", () => {
  let server: ITestServer;

  beforeAll(async () => {
    server = await startServer();
  });
  afterAll(() => server.close());
  beforeEach(() => {
    server.requests.length = 0;
  });

  const collect = async (path = "/live", headers?: Record<string, string>) => {
    const events: IServerSentEvent[] = [];
    await readEventStream(`${server.url}${path}`, (e) => events.push(e), {
      headers,
    });
    return events;
  };

  it("delivers each event in order and resolves when the server ends", async () => {
    server.handle((_, res) => {
      sse(res);
      res.end(
        'event: snapshot\ndata: {"t":20}\n\n: ping comment\n\nevent: reading\ndata: {"t":21}\n\ndata: bye\n\n',
      );
    });
    expect(await collect()).toEqual([
      { type: "snapshot", data: { t: 20 } },
      { type: "reading", data: { t: 21 } },
      { type: "message", data: "bye" },
    ]);
  });

  it("asks for an event stream and sends the extra headers", async () => {
    server.handle((_, res) => {
      sse(res);
      res.end();
    });
    await collect("/live", { Authorization: "Bearer t" });
    expect(server.requests[0].headers.accept).toBe("text/event-stream");
    expect(server.requests[0].headers.authorization).toBe("Bearer t");
  });

  it("joins events split across chunks, even mid-line", async () => {
    server.handle((_, res) =>
      writeSlowly(res, [
        "eve",
        "nt: a\nda",
        'ta: {"x"',
        ":1}\n",
        "\ndata: b\n\n",
      ]),
    );
    expect(await collect()).toEqual([
      { type: "a", data: { x: 1 } },
      { type: "message", data: "b" },
    ]);
  });

  it("accepts CRLF and CR line endings, also split between chunks", async () => {
    server.handle((_, res) =>
      writeSlowly(res, [
        "event: a\r\ndata: 1\r",
        "\n\r\n",
        "data: 2\r\rdata: 3\n\n",
      ]),
    );
    expect(await collect()).toEqual([
      { type: "a", data: 1 },
      { type: "message", data: 2 },
      { type: "message", data: 3 },
    ]);
  });

  it("keeps an event whole when a CRLF inside it is split between chunks", async () => {
    server.handle((_, res) =>
      writeSlowly(res, ["event: a\r", "\ndata: 1\r\n\r", "\n"]),
    );
    expect(await collect()).toEqual([{ type: "a", data: 1 }]);
  });

  it("decodes multi-byte characters split across chunks", async () => {
    const bytes = Buffer.from("data: سلام\n\n");
    server.handle(async (_, res) => {
      sse(res);
      res.write(bytes.subarray(0, 8)); // inside the first letter
      await tick();
      res.end(bytes.subarray(8));
    });
    expect(await collect()).toEqual([{ type: "message", data: "سلام" }]);
  });

  it("drops an unterminated last event", async () => {
    server.handle((_, res) => {
      sse(res);
      res.end("data: complete\n\ndata: cut off");
    });
    expect(await collect()).toEqual([{ type: "message", data: "complete" }]);
  });

  it("resolves for a stream with no events", async () => {
    server.handle((_, res) => {
      sse(res);
      res.end();
    });
    expect(await collect()).toEqual([]);
  });

  it("throws the exception for an error status with a JSON body", async () => {
    server.handle((_, res) => json(res, 401, { message: "token expired" }));
    const error = await collect().catch((e) => e);
    expect(error).toBeInstanceOf(UnauthorizedException);
    expect(error.message).toBe("token expired");
  });

  it("throws for an error status with a text body", async () => {
    server.handle((_, res) => {
      res.writeHead(404);
      res.end("Not Found");
    });
    const error = await collect().catch((e) => e);
    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.message).toBe("Request failed with status 404");
  });

  it("resolves once the signal aborts a stream that stays open", async () => {
    server.handle((_, res) => {
      sse(res);
      res.write("data: first\n\n");
      // never ends
    });
    const controller = new AbortController();
    const events: IServerSentEvent[] = [];
    const done = readEventStream(
      `${server.url}/live`,
      (e) => {
        events.push(e);
        controller.abort();
      },
      { signal: controller.signal },
    );
    await expect(done).resolves.toBeUndefined();
    expect(events).toEqual([{ type: "message", data: "first" }]);
  });

  it("resolves at once for a signal aborted before the call", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      readEventStream(`${server.url}/live`, () => {}, {
        signal: controller.signal,
      }),
    ).resolves.toBeUndefined();
  });

  it("propagates an error onEvent throws", async () => {
    server.handle((_, res) => {
      sse(res);
      res.end("data: x\n\n");
    });
    await expect(
      readEventStream(`${server.url}/live`, () => {
        throw new Error("handler broke");
      }),
    ).rejects.toThrow("handler broke");
  });

  it("rejects when it cannot connect", async () => {
    await expect(
      readEventStream(`${await closedPortUrl()}/live`, () => {}),
    ).rejects.toThrow();
  });
});
