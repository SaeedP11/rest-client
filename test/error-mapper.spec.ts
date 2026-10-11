import { describe, expect, it } from "vitest";
import {
  BadRequestException,
  ConflictException,
  errorMapper,
  ForbiddenException,
  HttpException,
  InternalServerException,
  NetworkException,
  NotFoundException,
  TimeoutException,
  throwResponseError,
  UnauthorizedException,
  ValidationException,
} from "../index";

const thrown = (status: number, data: unknown): any => {
  try {
    throwResponseError(status, data);
  } catch (error) {
    return error;
  }
  throw new Error("throwResponseError returned");
};

describe("throwResponseError", () => {
  it.each([
    [400, BadRequestException],
    [401, UnauthorizedException],
    [403, ForbiddenException],
    [404, NotFoundException],
    [409, ConflictException],
    [500, InternalServerException],
  ])("maps %i to its exception with the server's message", (status, type) => {
    const error = thrown(status, { message: "the reason" });
    expect(error).toBeInstanceOf(type);
    expect(error).toBeInstanceOf(Error);
    expect(error.status).toBe(status);
    expect(error.message).toBe("the reason");
  });

  it.each([
    [400, BadRequestException],
    [401, UnauthorizedException],
    [403, ForbiddenException],
    [404, NotFoundException],
    [409, ConflictException],
    [422, ValidationException],
    [500, InternalServerException],
  ])("makes %i an HttpException named after its class", (status, type) => {
    const error = thrown(status, { message: "the reason" });
    expect(error).toBeInstanceOf(HttpException);
    expect(error.name).toBe(type.name);
    expect(String(error)).toBe(`${type.name}: the reason`);
  });

  it("names the fallback HttpException too", () => {
    expect(thrown(429, {}).name).toBe("HttpException");
  });

  it.each([401, 403, 404, 409, 500])(
    "joins the messages of a %i that sent several",
    (status) => {
      const error = thrown(status, { message: ["one", "two"] });
      expect(error.message).toBe("one; two");
      expect(error.errors).toBeUndefined();
    },
  );

  it.each([401, 403, 404, 409, 500])(
    "uses a generic message when a %i's message is not text",
    (status) => {
      expect(thrown(status, { message: { nested: true } }).message).toBe(
        `Request failed with status ${status}`,
      );
    },
  );

  it("keeps every message of a 400 that sent several", () => {
    const error = thrown(400, { message: ["name is empty", "age is low"] });
    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.errors).toEqual(["name is empty", "age is low"]);
    expect(error.message).toBe("name is empty; age is low");
  });

  it("leaves errors unset on a 400 with one message", () => {
    expect(thrown(400, { message: "bad" }).errors).toBeUndefined();
  });

  it("takes a 422's text message, as the backend's services send it", () => {
    const error = thrown(422, { message: "device is not found" });
    expect(error).toBeInstanceOf(ValidationException);
    expect(error.message).toBe("device is not found");
    expect(error.errors).toBeUndefined();
  });

  it("joins a 422's text messages and keeps them in errors", () => {
    const error = thrown(422, { message: ["a is empty", "b is low"] });
    expect(error.message).toBe("a is empty; b is low");
    expect(error.errors).toEqual(["a is empty", "b is low"]);
  });

  it("uses a generic message for a 422 without one", () => {
    expect(thrown(422, {}).message).toBe("Request failed with status 422");
  });

  it("carries a 422's validation errors", () => {
    const errors = [{ property: "name", constraints: { isNotEmpty: "x" } }];
    const error = thrown(422, { message: errors });
    expect(error).toBeInstanceOf(ValidationException);
    expect(error.status).toBe(422);
    expect(error.message).toBe("Unprocessable Entity");
    expect(error.errors).toEqual(errors);
  });

  it("falls back to HttpException for an unmapped status", () => {
    const error = thrown(429, { message: "slow down" });
    expect(error).toBeInstanceOf(HttpException);
    expect(error.status).toBe(429);
    expect(error.message).toBe("slow down");
  });

  it("uses a generic message when an unmapped status's message is not text", () => {
    const error = thrown(418, { message: { nested: true } });
    expect(error).toBeInstanceOf(HttpException);
    expect(error.message).toBe("Request failed with status 418");
  });

  it.each([undefined, null, "plain text body", 42, { error: "x" }])(
    "uses a generic message when the body (%j) has none",
    (data) => {
      const error = thrown(404, data);
      expect(error).toBeInstanceOf(NotFoundException);
      expect(error.message).toBe("Request failed with status 404");
    },
  );

  it("decodes a JSON body that arrived as bytes", () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ message: "gone" }));
    expect(thrown(404, bytes.buffer).message).toBe("gone");
    expect(thrown(404, bytes).message).toBe("gone");
    expect(thrown(404, Buffer.from(bytes)).message).toBe("gone");
  });

  it("ignores bytes that are not JSON", () => {
    const bytes = new TextEncoder().encode("<html>oops</html>");
    expect(thrown(500, bytes).message).toBe("Request failed with status 500");
  });
});

describe("exceptions", () => {
  it.each([
    [new BadRequestException(), 400, "Bad Request"],
    [new UnauthorizedException(), 401, "Unauthorized"],
    [new ForbiddenException(), 403, "Forbidden"],
    [new NotFoundException(), 404, "Not Found"],
    [new ConflictException(), 409, "Conflict"],
    [new ValidationException(), 422, "Unprocessable Entity"],
    [new InternalServerException(), 500, "Internal Server Error"],
  ])("%s has its status and a default message", (error, status, message) => {
    expect(error.status).toBe(status);
    expect(error.message).toBe(message);
  });

  it("can be thrown by hand, e.g. from a mock", () => {
    const error = new NotFoundException("no such post");
    expect(error).toBeInstanceOf(HttpException);
    expect(error.status).toBe(404);
    expect(error.message).toBe("no such post");
    expect(error.stack).toContain("NotFoundException: no such post");
  });

  it("keeps network errors apart from HTTP ones", () => {
    const error = new TimeoutException("timeout of 5ms exceeded", "ETIMEDOUT");
    expect(error).toBeInstanceOf(NetworkException);
    expect(error).not.toBeInstanceOf(HttpException);
    expect(error.name).toBe("TimeoutException");
    expect(error.code).toBe("ETIMEDOUT");
  });
});

describe("errorMapper", () => {
  it("covers the statuses the backend answers with", () => {
    expect(Object.keys(errorMapper).map(Number).sort()).toEqual([
      400, 401, 403, 404, 409, 422, 500,
    ]);
  });
});
