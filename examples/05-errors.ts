/** Every failure is a typed exception: one `instanceof` per case */
import {
  BadRequestException,
  ConflictException,
  HttpException,
  NetworkException,
  NotFoundException,
  TimeoutException,
  UnauthorizedException,
} from "@sp11/rest-client";
import { createClient } from "./client";

/** What a UI would show for a failed call */
export const describeError = (error: unknown): string => {
  if (error instanceof BadRequestException) {
    // A ValidationPipe's messages, one per broken rule
    return `fix the form: ${(error.errors ?? [error.message]).join(", ")}`;
  }
  if (error instanceof UnauthorizedException) return "please sign in again";
  if (error instanceof NotFoundException) return "it is gone";
  if (error instanceof ConflictException) return `conflict: ${error.message}`;
  // Every other error status: 403, 422, 429, 500, ...
  if (error instanceof HttpException) {
    return `server said ${error.status}: ${error.message}`;
  }
  if (error instanceof TimeoutException) return "the server is slow, retry";
  if (error instanceof NetworkException) return `offline? (${error.code})`;
  throw error;
};

export const main = async (
  baseUrl: string,
  unreachableUrl: string,
  log = console.log,
) => {
  const { auth, posts } = createClient(baseUrl);
  const attempt = async (what: string, call: () => Promise<unknown>) => {
    try {
      await call();
      log(what, "→ ok");
      return "ok";
    } catch (error) {
      const text = describeError(error);
      log(what, "→", text);
      return text;
    }
  };

  const results = {
    wrongPassword: await attempt("wrong password", () =>
      auth.login("demo", "nope"),
    ),
    signedOut: await attempt("signed out", () => posts.get()),
    login: await attempt("login", () => auth.login("demo", "demo")),
    invalid: await attempt("invalid post", () => posts.create({ title: "" })),
    first: await attempt("first post", () => posts.create({ title: "Once" })),
    duplicate: await attempt("same title", () =>
      posts.create({ title: "Once" }),
    ),
    missing: await attempt("missing post", () => posts.getById("404")),
    badPage: await attempt("page too big", () =>
      posts.getPaginate({ limit: 500 }),
    ),
    offline: await attempt("offline", () =>
      createClient(unreachableUrl).auth.login("demo", "demo"),
    ),
  };
  return results;
};
