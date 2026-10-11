/** Any error status without an exception class of its own */
export class HttpException extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}
