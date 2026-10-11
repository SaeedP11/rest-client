# @sp11/rest-client

The transport layer an axios API client is built on, taken out of `nova-api-client`
so other projects can use it. It knows nothing about any one API:

- **`HttpClient`**: an `axios` that sends the access token and, on a 401, refreshes it
  once and retries (requests that fail together share one refresh); a `publicAxios`
  without the token; a pluggable token store; `stream` for server-sent events.
- **Typed errors**: every non-2xx answer throws an `HttpException` subclass
  (`NotFoundException`, ...) with its `status`; a request with no answer throws a
  `NetworkException` (`TimeoutException` past `timeout`).
- **`ReadResourceService` / `ResourceService`**: the CRUD routes a
  nova-mongoose backend serves for a resource, to extend with
  the resource's own routes.
- **The query format** nova-mongoose reads: `ISimpleFilter`, `SimpleFilterOperator`,
  `IPaginationOptions`, `IPagination`, and `stringifyQuery` / `withQuery`.

```sh
pnpm add @sp11/rest-client axios   # from https://npm.sp11.ir
```

`axios` (≥ 1.7) is a peer dependency. Node 18+ or any current browser: `stream` uses
`fetch` and web streams.

## Contents

- [Quick start](#quick-start)
- [HttpClient](#httpclient)
- [Tokens and refresh](#tokens-and-refresh)
- [Resource services](#resource-services)
- [Filters, search, sort and pages](#filters-search-sort-and-pages)
- [Errors](#errors)
- [Server-sent events](#server-sent-events)
- [Request and response bodies](#request-and-response-bodies)
- [Examples](#examples)
- [Development](#development)

## Quick start

```ts
import { HttpClient, ResourceService } from "@sp11/rest-client";

interface IPost {
  id: string;
  owner: string;
  createdAt: Date;
  title: string;
  views: number;
}

type Tokens = { accessToken: string; refreshToken: string };

const http = new HttpClient<Tokens>({
  baseUrl: "https://example.com/api",
  timeout: 10_000,
  tokenStore: {
    get: () => JSON.parse(localStorage.getItem("tokens") ?? "null") ?? undefined,
    set: (tokens) => localStorage.setItem("tokens", JSON.stringify(tokens)),
    del: () => localStorage.removeItem("tokens"),
  },
  refresh: async (tokens, publicAxios) =>
    (await publicAxios.post<Tokens>("/auth/refresh", { refreshToken: tokens.refreshToken }))
      .data,
});

class PostService extends ResourceService<IPost> {
  constructor(http: HttpClient<Tokens>) {
    super(http, "/post");
  }

  async publish(id: string): Promise<IPost> {
    return (await this.axios.post<IPost>(`${this.route}/${id}/publish`)).data;
  }
}

const posts = new PostService(http);

const { data } = await http.publicAxios.post<Tokens>("/auth/login", { username, password });
http.setTokens(data);

const post = await posts.create({ title: "Hello", views: 0 });
const page = await posts.getPaginate({ sort: "-createdAt", limit: 10 });
```

## HttpClient

```ts
new HttpClient<T extends { accessToken: string }>(options)
```

| Option | |
| --- | --- |
| `baseUrl` | Every route is relative to it. Trailing slashes are dropped. |
| `tokenStore` | Where the tokens live between sessions. Read once on construction, written on every change. |
| `refresh(tokens, publicAxios)` | Trades the current tokens for new ones. Without it a 401 is thrown as it is. |
| `headers` | Sent with every request, on top of `Content-Type: application/json`. |
| `timeout` | Milliseconds before a request fails with `TimeoutException`. None by default; `stream` is not limited by it. |

| Member | |
| --- | --- |
| `axios` | Sends `Authorization: Bearer <accessToken>` while signed in, and refreshes on a 401. Use it for every route that needs a user. |
| `publicAxios` | Never sends the token and never refreshes: sign-in, sign-up, refresh, public routes. |
| `getTokens()` | The current tokens, or `undefined` when signed out. |
| `setTokens(tokens?)` | Replaces them and saves them; `undefined` signs out and empties the store. |
| `updateTokens(partial)` | Merges into the current tokens (skipping `undefined` values) and saves the result. Throws when signed out. |
| `clearTokens()` | Signs out. |
| `stream(path, onEvent, options?)` | Follows a server-sent event stream. See [below](#server-sent-events). |
| `baseUrl` | The base URL, without a trailing slash. |

Both `axios` instances are plain `Axios` objects with no defaults of their own beyond
the JSON handling, so per-request options (`params`, `signal`, `responseType`,
`onUploadProgress`, ...) work as usual, and you can add your own interceptors.

## Tokens and refresh

`T` is whatever your backend's sign-in answers with; only `accessToken` is required.
Keep anything else you need in it (a refresh token, the user's id) and it is stored
alongside.

A token store is three functions:

```ts
interface ITokenStore<T> {
  get(): T | undefined;
  set(tokens: T): void;
  del(): void;
}
```

`localStorage` (above) in a browser, a file in Node (`examples/02-auth-refresh.ts`),
or nothing at all for a short-lived script.

When a request on `axios` gets a **401** while signed in and `refresh` is set:

1. `refresh` is called with the current tokens and `publicAxios`. Requests that got a
   401 together **share one call**: a refresh token is often good for one use, and
   spending it twice would void the session.
2. The new tokens are saved (`setTokens`), and the request is **retried once** with the
   new access token, body and all (multipart uploads included).
3. A request that was sent before the refresh but answered after it is retried with
   the new token without refreshing again.
4. A second 401 on the retry is thrown as `UnauthorizedException`, not refreshed again.
5. If `refresh` throws, the client **signs out** (`clearTokens`) and every waiting
   request rejects with the refresh's error.

A 401 is thrown as it is when signed out, without a `refresh` option, or on
`publicAxios`. To send the user to the sign-in page, catch `UnauthorizedException`
where you call the API, or check `getTokens()` after a failure.

## Resource services

For a backend built on nova-mongoose, a resource at `route` serves:

| Method | Route | |
| --- | --- | --- |
| `getById(id)` | `GET route/:id` | |
| `get(options?)` | `GET route?filter&search` | Every match, as an array |
| `getPaginate(options?)` | `GET route/paginate?filter&search&sort&page&limit` | One page, as `IPagination<T>` |
| `create(body)` | `POST route` | `ResourceService` only |
| `update(id, body)` | `PATCH route/:id` | `ResourceService` only |
| `delete(id)` | `DELETE route/:id` | `ResourceService` only |

The id is percent-encoded. Extend `ReadResourceService<T>` for a resource that is only
read (or written through routes of its own), `ResourceService` for the full set. A
subclass reaches the signed-in `this.axios`, `this.http` and `this.route`:

```ts
class DeviceService extends ReadResourceService<IDevice> {
  constructor(http: HttpClient<Tokens>) {
    super(http, "/device");
  }

  async reboot(id: string): Promise<void> {
    await this.axios.post(`${this.route}/${id}/reboot`);
  }
}
```

`ResourceService<T, TCreate, TUpdate, TCreated>` types the bodies:

| Parameter | Default | |
| --- | --- | --- |
| `TCreate` | `OmitOfCreate<T>`: `T` without `id`, `owner`, `createdAt` | The body of `create` |
| `TUpdate` | `Partial<TCreate>` | The body of `update` |
| `TCreated` | `T` | What `create` answers with, when it is not the resource itself |

## Filters, search, sort and pages

```ts
import { SimpleFilterOperator as Op } from "@sp11/rest-client";

await posts.get({
  // every item must match (AND)
  filter: [
    { field: "views", operator: Op.GTE, value: 50 },
    { field: "createdAt", operator: Op.BETWEEN, value: [from, to] },
  ],
  // at least one item must match (OR): what a search box sends
  search: [
    { field: "title", operator: Op.ILIKE, value: query },
    { field: "body", operator: Op.ILIKE, value: query },
  ],
});

await posts.getPaginate({
  filter: [{ field: "owner", operator: Op.EQ, value: userId }],
  sort: "-views,+title", // `+field` ascending, `-field` descending, comma-separated
  page: 2, // 1-based
  limit: 20, // nova-mongoose takes 5 to 50
});
// → { items, totalItems, totalPages, page, limit }
```

`field` is checked against the resource's keys (`ISimpleFilter<IPost>`). Without a type
argument (`ISimpleFilter`, `IPaginationOptions`) any field name is accepted, e.g. a
nested `"owner.name"`. A field that is in both `filter` and `search` is only filtered.

| Operator | Value | Matches when the field |
| --- | --- | --- |
| `EQ`, `NE` | scalar | equals / does not equal it |
| `GT`, `GTE`, `LT`, `LTE` | number, date or string | compares so |
| `IN`, `NOT_IN` | array | is / is not one of them |
| `BETWEEN`, `NOT_BETWEEN` | `[min, max]` | is / is not within them, both ends included |
| `LIKE`, `NOT_LIKE` | string | contains / does not contain it, literally |
| `ILIKE`, `NOT_ILIKE` | string | the same, ignoring case |
| `REGEXP`, `NOT_REGEXP` | pattern | matches / does not match it |
| `IREGEXP`, `NOT_IREGEXP` | pattern | the same, ignoring case |
| `IS`, `NOT` | boolean | is / is not it |
| `ELM_MTC` | object | is an array with an element matching it (`$elemMatch`) |

On the wire, `filter` and `search` are JSON in the query string, dates are ISO strings
and `undefined` options are left out. `stringifyQuery(obj)` and `withQuery(path, obj)`
build that query for routes of your own:

```ts
await this.axios.get(withQuery(`${this.route}/stats`, { from: new Date(), filter }));
```

## Errors

Every failed call rejects with one of:

| Class | When |
| --- | --- |
| `BadRequestException` | 400. `errors` holds every message when the backend sent a list (a NestJS `ValidationPipe` does) and `message` joins them with `"; "`. |
| `UnauthorizedException` | 401 (after a refresh, if one was possible) |
| `ForbiddenException` | 403 |
| `NotFoundException` | 404 |
| `ConflictException` | 409 |
| `ValidationException` | 422. The backend's text as `message`; a list it sent is kept in `errors`. |
| `InternalServerException` | 500 |
| `HttpException` | Any other status. The base class of all of the above, with `status`. |
| `NetworkException` | No answer: refused, DNS, dropped connection. `code` is the underlying one (`ECONNREFUSED`, ...) and `cause` the original error. |
| `TimeoutException` | No answer within `timeout`. A `NetworkException`. |

The `message` is the body's `message` (NestJS's error shape); when there is none, it is
`Request failed with status <n>`. Each class has its own `name`, so logs show
`NotFoundException: post not found`. A request cancelled with an `AbortSignal` rejects
with axios's own `CanceledError` (check it with axios's `isCancel`), not with any of
these.

```ts
try {
  await posts.create(form);
} catch (error) {
  if (error instanceof BadRequestException) showFieldErrors(error.errors ?? [error.message]);
  else if (error instanceof ConflictException) toast("That title is taken");
  else if (error instanceof HttpException) toast(`${error.status}: ${error.message}`);
  else if (error instanceof NetworkException) toast("You seem to be offline");
  else throw error;
}
```

The classes can be constructed by hand too (`new NotFoundException("no such post")`),
e.g. in a mock of your API.

## Server-sent events

```ts
const controller = new AbortController();

const done = http.stream<IServerSentEvent<IReading>>(
  `/device/${id}/live`,
  (event) => {
    // { type: "message" | the `event:` field, data: parsed JSON or the raw text }
    if (event.type === "reading") chart.push(event.data);
  },
  { signal: controller.signal },
);

controller.abort(); // closes the stream; `done` resolves
await done; // also resolves when the server ends the stream
```

- It sends the access token as it is when called, and **does not refresh**: an expired
  token rejects with `UnauthorizedException`. Refresh (any call on `http.axios`) and
  call `stream` again.
- An error status rejects with its exception, no connection with `NetworkException`,
  and an error thrown by `onEvent` rejects the promise too.
- It does not reconnect: when the stream ends or fails, call it again.
- Comments and `id:`/`retry:` fields are ignored; data lines are joined with `\n`.
- `readEventStream(url, onEvent, options)` is the same without an `HttpClient`.

## Request and response bodies

- Objects and arrays are sent as JSON, class instances as JSON of their fields.
- `FormData` is sent as multipart, `URLSearchParams` as a urlencoded form, and
  `Blob`, `ArrayBuffer`, typed arrays, Buffers and Node streams as raw bytes.
- A JSON object or array in the response is parsed; other text, and JSON scalars, stay
  strings. Ask for `responseType: "arraybuffer"` (or `"blob"`) for binary downloads;
  an error on one still throws with the decoded message.
- Every 2xx resolves; a 3xx that is not followed is thrown as an `HttpException`.

`createAxios(baseUrl, headers?, recover?)` makes such an `Axios` on its own, with
`recover` as a hook to answer an error response with something else (that is how
`HttpClient` retries a 401).

## Examples

`examples/` holds small programs written as a project using the package would write
them, all run against `examples/mock-api.ts`, an in-memory stand-in for a nova-mongoose
backend:

| File | Shows |
| --- | --- |
| [`client.ts`](examples/client.ts) | An API client: tokens, `HttpClient` with refresh, a `ResourceService` with a route of its own, an auth service |
| [`01-crud.ts`](examples/01-crud.ts) | Sign in, then create, read, update and delete |
| [`02-auth-refresh.ts`](examples/02-auth-refresh.ts) | File and `localStorage` token stores, restoring a session, three requests sharing one refresh |
| [`03-filter-paginate.ts`](examples/03-filter-paginate.ts) | `filter`, `search`, `sort` and pages |
| [`04-events.ts`](examples/04-events.ts) | Following server-sent events and closing the stream |
| [`05-errors.ts`](examples/05-errors.ts) | Telling every failure apart |

`pnpm examples` runs them all and prints what they do. They are also part of
`pnpm test`, so they keep working as the package changes.

## Development

```sh
pnpm install
pnpm test        # vitest, against a real local HTTP server
pnpm typecheck   # the sources, tests and examples
pnpm examples    # the examples, with their output
pnpm build       # dist/
pnpm format
```

`prepublishOnly` runs the type check, the tests and the build. See
[CHANGELOG.md](CHANGELOG.md) for what changed between versions.
