import { BadRequestException } from "../error/bad-request.exception";
import { ConflictException } from "../error/conflict.exception";
import { ForbiddenException } from "../error/forbidden.exception";
import { HttpException } from "../error/http.exception";
import { InternalServerException } from "../error/internal-server.exception";
import { NotFoundException } from "../error/not-found.exception";
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
 * Throws the exception for a status, given the body's `message` (`undefined`
 * when it had none)
 */
export const errorMapper: Record<number, (message: unknown) => never> = {
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
  500: (message) => {
    throw new InternalServerException(asText(message, 500));
  },
};

/** Throws the exception for an error response */
export const throwResponseError = (status: number, data: unknown): never => {
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
  if (map) return map(message);
  throw new HttpException(asText(message, status), status);
};
