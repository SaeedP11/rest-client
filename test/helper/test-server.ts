import { createServer, IncomingMessage, ServerResponse } from "http";
import { AddressInfo } from "net";

export interface IRecordedRequest {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: Buffer;
  text: string;
}

export type Handler = (
  req: IRecordedRequest,
  res: ServerResponse,
) => void | Promise<void>;

export interface ITestServer {
  /** `http://127.0.0.1:<port>`, no trailing slash */
  url: string;
  requests: IRecordedRequest[];
  /** Swaps the handler for the next requests */
  handle(handler: Handler): void;
  close(): Promise<void>;
}

export const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

/** A real HTTP server on a free port that records every request */
export const startServer = async (
  handler: Handler = (_, res) => json(res, 200, {}),
): Promise<ITestServer> => {
  const requests: IRecordedRequest[] = [];
  let current = handler;

  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", async () => {
      const body = Buffer.concat(chunks);
      const recorded: IRecordedRequest = {
        method: req.method ?? "",
        url: req.url ?? "",
        headers: req.headers,
        body,
        text: body.toString("utf8"),
      };
      requests.push(recorded);
      try {
        await current(recorded, res);
      } catch (error) {
        if (!res.headersSent) json(res, 599, { message: String(error) });
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    handle: (next) => {
      current = next;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
};

/** A port nothing listens on, for connection errors */
export const closedPortUrl = async (): Promise<string> => {
  const server = await startServer();
  const url = server.url;
  await server.close();
  return url;
};
