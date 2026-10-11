/**
 * The base of every exception for an error response, and the one thrown for
 * a status without a class of its own: `catch (e) { if (e instanceof
 * HttpException) e.status }` covers them all
 */
export class HttpException extends Error {
  override name = "HttpException";

  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}
