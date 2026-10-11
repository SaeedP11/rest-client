/**
 * The pieces an API client built on @sp11/rest-client is made of: the tokens,
 * an `HttpClient` that refreshes them, and a service per resource. The other
 * examples use these.
 */
import { HttpClient, ITokenStore, ResourceService } from "@sp11/rest-client";
import type { IPost } from "./mock-api";

/** What the backend's sign-in and refresh routes answer with */
export interface ITokens {
  accessToken: string;
  refreshToken: string;
}

/** A resource with routes of its own, on top of the CRUD ones */
export class PostService extends ResourceService<
  IPost,
  { title: string; views?: number }
> {
  constructor(http: HttpClient<ITokens>) {
    super(http, "/post");
  }

  async like(id: string): Promise<IPost> {
    const post = await this.getById(id);
    return this.update(id, { views: (post.views ?? 0) + 1 });
  }
}

export class AuthService {
  constructor(private readonly http: HttpClient<ITokens>) {}

  /** Signs in through `publicAxios` (no token yet) and keeps the tokens */
  async login(username: string, password: string): Promise<void> {
    const { data } = await this.http.publicAxios.post<ITokens>("/auth/login", {
      username,
      password,
    });
    this.http.setTokens(data);
  }

  async me(): Promise<{ username: string }> {
    return (await this.http.axios.get<{ username: string }>("/auth/me")).data;
  }

  logout(): void {
    this.http.clearTokens();
  }
}

/** The client a project would export: one transport, one service per resource */
export const createClient = (
  baseUrl: string,
  tokenStore?: ITokenStore<ITokens>,
) => {
  const http = new HttpClient<ITokens>({
    baseUrl,
    tokenStore,
    timeout: 10_000,
    // Called once for every batch of requests that got a 401 together
    refresh: async (tokens, publicAxios) =>
      (
        await publicAxios.post<ITokens>("/auth/refresh", {
          refreshToken: tokens.refreshToken,
        })
      ).data,
  });
  return { http, auth: new AuthService(http), posts: new PostService(http) };
};
