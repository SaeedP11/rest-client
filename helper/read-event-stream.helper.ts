import { throwResponseError } from "../constant/error-mapper.const";
import { NetworkException } from "../error/network.exception";
import {
  IEventStreamOptions,
  IServerSentEvent,
} from "../interface/server-sent-event.interface";

/**
 * Follows a `text/event-stream` with `fetch`, calling `onEvent` per message.
 * Resolves when the server ends the stream or `signal` aborts it; an error
 * status throws the exception for it, and no connection a `NetworkException`
 */
export const readEventStream = async <T = IServerSentEvent>(
  url: string,
  onEvent: (event: T) => void,
  { headers, signal }: IEventStreamOptions = {},
): Promise<void> => {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: "text/event-stream", ...headers },
      signal,
    });
  } catch (error) {
    if (signal?.aborted) return;
    const cause = (error as { cause?: { code?: unknown } }).cause;
    throw new NetworkException(
      (error as Error).message,
      typeof cause?.code === "string" ? cause.code : undefined,
      { cause: error },
    );
  }

  if (!response.ok) {
    const text = await response.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // Not JSON: the status alone says what went wrong
    }
    throwResponseError(response.status, body);
  }
  if (!response.body) return;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  // A CRLF split between chunks is one line break, not two
  let endedWithCr = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      let text = decoder.decode(value, { stream: true });
      if (endedWithCr && text.startsWith("\n")) text = text.slice(1);
      if (text) endedWithCr = text.endsWith("\r");
      buffer += text.replace(/\r\n?/g, "\n");
      let end: number;
      while ((end = buffer.indexOf("\n\n")) !== -1) {
        const event = parseEvent(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
        if (event) onEvent(event as T);
      }
    }
  } catch (error) {
    if (signal?.aborted) return;
    throw error;
  } finally {
    reader.releaseLock();
  }
};

/** One message; comments and data-less blocks are skipped */
export const parseEvent = (block: string): IServerSentEvent | undefined => {
  let type = "message";
  const data: string[] = [];
  for (const line of block.split("\n")) {
    const colon = line.indexOf(":");
    if (colon === 0) continue;
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
    if (field === "event") type = value;
    else if (field === "data") data.push(value);
  }
  if (!data.length) return undefined;

  const raw = data.join("\n");
  let parsed: unknown = raw;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Left as the string it was sent as
  }
  return { type, data: parsed };
};
