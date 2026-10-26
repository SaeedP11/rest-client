import { BadRequestException } from "../error/bad-request.exception";
import { ConflictException } from "../error/conflict.exception";
import { ForbiddenException } from "../error/forbidden.exception";
import { HttpException } from "../error/http.exception";
import { InternalServerException } from "../error/internal-server.exception";
import { NotFoundException } from "../error/not-found.exception";
import { TooManyRequestsException } from "../error/too-many-requests.exception";
import { UnauthorizedException } from "../error/unauthorized.exception";
import { ValidationException } from "../error/validation.exception";

/** A list of strings, as a ValidationPipe sends for a 400 */
const isTextList = (message: unknown): message is string[] =>
  Array.isArray(message) &&
  message.length > 0 &&
  message.every((item) => typeof item === "string");

/** The message as text (a list joined with "; "), or a generic one */
const asText = (message: unknown, status: number): string =>
  typeof message === "string"
    ? message
    : isTextList(message)
      ? message.join("; ")
      : `Request failed with status ${status}`;

/**
 * Response headers as axios (`AxiosHeaders`) and fetch (`Headers`) give
 * them, both with a case-insensitive `get`, or a plain object
 */
export type ResponseHeaders =
  { get(name: string): unknown } | Record<string, unknown>;

/** What else an error response carried, for the statuses that read it */
export interface IErrorResponse {
  data?: unknown;
  headers?: ResponseHeaders;
}

const headerOf = (
  headers: ResponseHeaders | undefined,
  name: string,
): unknown => {
  if (!headers) return undefined;
  if (typeof headers.get === "function")
    return (headers as { get(name: string): unknown }).get(name);
  const key = Object.keys(headers).find(
    (key) => key.toLowerCase() === name.toLowerCase(),
  );
  return key === undefined
    ? undefined
    : (headers as Record<string, unknown>)[key];
};

/**
 * Seconds to wait: `Retry-After` is either seconds or an HTTP date, and a
 * body may say `retryAfter` (in seconds) when a proxy dropped the header
 */
const retryAfterOf = ({ data, headers }: IErrorResponse = {}):
  number | undefined => {
  const header = headerOf(headers, "retry-after");
  if (typeof header === "string" && header.trim()) {
    if (/^\d+$/.test(header.trim())) return Number(header.trim());
    const at = Date.parse(header);
    if (!Number.isNaN(at))
      return Math.max(0, Math.ceil((at - Date.now()) / 1000));
  }
  const fromBody =
    typeof data === "object" && data !== null && "retryAfter" in data
      ? Number((data as { retryAfter: unknown }).retryAfter)
      : NaN;
  return Number.isFinite(fromBody) && fromBody >= 0 ? fromBody : undefined;
};

/**
 * Throws the exception for a status, given the body's `message` (`undefined`
 * when it had none) and the rest of the response
 */
export const errorMapper: Record<
  number,
  (message: unknown, response?: IErrorResponse) => never
> = {
  400: (message) => {
    throw new BadRequestException(
      isTextList(message) ? message : asText(message, 400),
    );
  },
  401: (message) => {
    throw new UnauthorizedException(asText(message, 401));
  },
  403: (message) => {
    throw new ForbiddenException(asText(message, 403));
  },
  404: (message) => {
    throw new NotFoundException(asText(message, 404));
  },
  409: (message) => {
    throw new ConflictException(asText(message, 409));
  },
  422: (message) => {
    // A list of error objects is kept as it is, in `errors`
    throw new ValidationException(
      Array.isArray(message) ? message : asText(message, 422),
    );
  },
  429: (message, response) => {
    throw new TooManyRequestsException(
      asText(message, 429),
      retryAfterOf(response),
    );
  },
  500: (message) => {
    throw new InternalServerException(asText(message, 500));
  },
};

/** Throws the exception for an error response */
export const throwResponseError = (
  status: number,
  data: unknown,
  headers?: ResponseHeaders,
): never => {
  // A download's error body arrives as bytes, not as parsed JSON
  if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
    try {
      data = JSON.parse(new TextDecoder().decode(data));
    } catch {
      data = undefined;
    }
  }
  const message =
    typeof data === "object" && data !== null && "message" in data
      ? (data as { message: unknown }).message
      : undefined;
  const map = errorMapper[status];
  if (map) return map(message, { data, headers });
  throw new HttpException(asText(message, status), status);
};
