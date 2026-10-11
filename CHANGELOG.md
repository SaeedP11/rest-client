# Changelog

## 1.1.0

### Changed

- Every exception for an error status now extends `HttpException`, so
  `instanceof HttpException` and `error.status` cover them all, and each has its
  own `name` (`NotFoundException: post not found` in logs and stacks). Their
  constructors take an optional message, defaulting to the status text.
- `ValidationException` (422) keeps the backend's text as its `message`, joining a
  list of messages with `"; "`, instead of always saying `Unprocessable Entity`.
  `errors` is now `unknown[] | undefined`: the list the backend sent, if any.
- A 401, 403, 404, 409 or 500 whose `message` is a list of strings joins it with
  `"; "` (it read `"a,b"`); a message that is not text gives the generic
  `Request failed with status <n>`, as unmapped statuses already did.
- `ResourceService` / `ReadResourceService` percent-encode the id in `route/:id`.
- `ISimpleFilter` (and so `IFilterOptions` / `IPaginationOptions`) without a type
  argument accepts any field name; `field` was `never`.
- The JSDoc comments now ship in the `.d.ts` files, so editors show them.

### Added

- `NetworkException` (with `code` and `cause`) for a request that got no answer, and
  `TimeoutException` for one past the timeout, from `axios`, `publicAxios` and
  `stream` alike. Cancellations still reject with axios's `CanceledError`.
- `timeout` option on `HttpClient`.
- `examples/`, run by the test suite (`pnpm examples` prints their output), and a
  full guide in the README.

## 1.0.0

- First release: `HttpClient`, typed errors, `ReadResourceService` /
  `ResourceService`, the nova-mongoose query format and server-sent events, taken
  out of `nova-api-client`.
