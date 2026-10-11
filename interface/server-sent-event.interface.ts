/** One `text/event-stream` message; `data` is parsed when it is JSON */
export interface IServerSentEvent<T = unknown> {
  type: string;
  data: T;
}

export interface IEventStreamOptions {
  headers?: Record<string, string>;
  /** Aborting it closes the stream, and the returned promise resolves */
  signal?: AbortSignal;
}
