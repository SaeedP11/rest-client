# @sp11/rest-client

The transport layer an axios API client is built on, taken out of `nova-api-client`
so other projects can use it:

- `HttpClient`: an `axios` that sends the access token and, on a 401, refreshes it
  once (one refresh shared by every request that failed together) and retries; a
  `publicAxios` without the token; a token store; `stream` for server-sent events.
- Typed errors: every non-2xx answer throws `BadRequestException`,
  `UnauthorizedException`, ..., or `HttpException` with its `status`.
- `ReadResourceService` (getById / get / getPaginate) and `ResourceService` (+ create / update / delete) for a
  resource, to extend with its own routes.
- The filter and pagination query format nova-mongoose serves (`ISimpleFilter`,
  `SimpleFilterOperator`, `IPaginationOptions`, `IPagination`) and `stringifyQuery`.

```ts
import { HttpClient, ResourceService } from "@sp11/rest-client";

type Tokens = { accessToken: string; refreshToken: string };

const http = new HttpClient<Tokens>({
  baseUrl: "https://example.com/api",
  tokenStore: {
    get: () => JSON.parse(localStorage.getItem("tokens") ?? "null") ?? undefined,
    set: (t) => localStorage.setItem("tokens", JSON.stringify(t)),
    del: () => localStorage.removeItem("tokens"),
  },
  refresh: async (tokens, publicAxios) =>
    (await publicAxios.post<Tokens>("/auth/refresh", { refreshToken: tokens.refreshToken })).data,
});

class PostService extends ResourceService<IPost> {
  constructor(http: HttpClient<Tokens>) {
    super(http, "/post");
  }

  async publish(id: string): Promise<IPost> {
    return (await this.axios.post<IPost>(`${this.route}/${id}/publish`)).data;
  }
}
```

`axios` is a peer dependency. Build with `pnpm build`.
