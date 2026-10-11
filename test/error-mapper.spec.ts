import { describe, expect, it } from "vitest";
import {
  BadRequestException,
  ConflictException,
  errorMapper,
  ForbiddenException,
  HttpException,
  InternalServerException,
  NotFoundException,
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

  it("keeps every message of a 400 that sent several", () => {
    const error = thrown(400, { message: ["name is empty", "age is low"] });
    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.errors).toEqual(["name is empty", "age is low"]);
    expect(error.message).toBe("name is empty; age is low");
  });

  it("leaves errors unset on a 400 with one message", () => {
    expect(thrown(400, { message: "bad" }).errors).toBeUndefined();
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

describe("errorMapper", () => {
  it("covers the statuses the backend answers with", () => {
    expect(Object.keys(errorMapper).map(Number).sort()).toEqual([
      400, 401, 403, 404, 409, 422, 500,
    ]);
  });
});
