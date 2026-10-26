import { HttpException } from "./http.exception";

/**
 * 429: a rate limit or a lockout. `retryAfter` is how many seconds to wait,
 * from the `Retry-After` header or else the body's `retryAfter`, when the
 * server said
 */
export class TooManyRequestsException extends HttpException {
  override name = "TooManyRequestsException";

  constructor(
    message = "Too Many Requests",
    public readonly retryAfter?: number,
  ) {
    super(message, 429);
  }
}
