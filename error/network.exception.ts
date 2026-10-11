/**
 * No answer came back: the server is down or unreachable, DNS failed, the
 * connection dropped. Not an `HttpException`, since there is no status
 */
export class NetworkException extends Error {
  override name = "NetworkException";

  constructor(
    message: string,
    /** The underlying code, e.g. `ECONNREFUSED`, when there is one */
    public readonly code?: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

/** The request outlived the client's `timeout` */
export class TimeoutException extends NetworkException {
  override name = "TimeoutException";
}
