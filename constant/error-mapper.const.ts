import { BadRequestException } from "../error/bad-request.exception";
import { ConflictException } from "../error/conflict.exception";
import { ForbiddenException } from "../error/forbidden.exception";
import { HttpException } from "../error/http.exception";
import { InternalServerException } from "../error/internal-server.exception";
import { NotFoundException } from "../error/not-found.exception";
import { UnauthorizedException } from "../error/unauthorized.exception";
import { ValidationException } from "../error/validation.exception";

export const errorMapper: Record<number, (message: any) => never> = {
  400: (message: string | string[]) => {
    throw new BadRequestException(message);
  },
  401: (message: string) => {
    throw new UnauthorizedException(message);
  },
  403: (message: string) => {
    throw new ForbiddenException(message);
  },
  404: (message: string) => {
    throw new NotFoundException(message);
  },
  409: (message: string) => {
    throw new ConflictException(message);
  },
  422: (message: string) => {
    throw new ValidationException(message);
  },
  500: (message: string) => {
    throw new InternalServerException(message);
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
  const body =
    typeof data === "object" && data !== null && "message" in data
      ? (data as { message: unknown }).message
      : undefined;
  const map = errorMapper[status];
  if (map) return map(body ?? `Request failed with status ${status}`);
  throw new HttpException(
    typeof body === "string" ? body : `Request failed with status ${status}`,
    status,
  );
};
