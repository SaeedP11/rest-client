import { Axios, AxiosResponse, InternalAxiosRequestConfig } from "axios";
import { createAxios } from "./helper/create-axios.helper";
import { readEventStream } from "./helper/read-event-stream.helper";
import { ITokenStore } from "./interface/token-store.interface";
import {
  IEventStreamOptions,
  IServerSentEvent,
} from "./interface/server-sent-event.interface";

export interface IAccessTokens {
  accessToken: string;
}

export interface IHttpClientOptions<T extends IAccessTokens> {
  /** Every route is relative to it, e.g. `https://example.com/api` */
  baseUrl: string;
  /** Loaded once on construction, then kept in step with every change */
  tokenStore?: ITokenStore<T>;
  /**
   * Trades the current tokens for new ones, through `publicAxios`. Without
   * it a 401 is thrown as it is. A failed refresh signs the client out
   */
  refresh?: (tokens: T, publicAxios: Axios) => Promise<T>;
  /** Sent with every request, on top of `Content-Type: application/json` */
  headers?: Record<string, string>;
  /**
   * Milliseconds a request may take before it fails with a
   * `TimeoutException`; none by default. `stream` is not limited by it
   */
  timeout?: number;
}

/**
 * The transport an API client is built on: a signed-in `axios` that sends
 * the access token and refreshes it once on a 401, a `publicAxios` for
 * routes that need no token, and `stream` for server-sent events
 */
export class HttpClient<T extends IAccessTokens = IAccessTokens> {
  constructor(private readonly options: IHttpClientOptions<T>) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.publicAxios = createAxios(this.baseUrl, options.headers);
    this.axios = createAxios(this.baseUrl, options.headers, (response) =>
      this.retryUnauthorized(response),
    );
    if (options.timeout !== undefined) {
      this.axios.defaults.timeout = options.timeout;
      this.publicAxios.defaults.timeout = options.timeout;
    }

    this.axios.interceptors.request.use((config) => {
      if (this.tokens) {
        config.headers.set(
          "Authorization",
          `Bearer ${this.tokens.accessToken}`,
        );
      }
      return config;
    });

    this.tokens = options.tokenStore?.get();
  }

  readonly baseUrl: string;
  /** Sends the access token, refreshes it on a 401 */
  readonly axios: Axios;
  /** Sends no token: sign-in, sign-up, refresh, public routes */
  readonly publicAxios: Axios;

  private tokens?: T;
  private refreshing?: Promise<void>;

  getTokens(): T | undefined {
    return this.tokens;
  }

  /** Replaces the tokens, or with `undefined` signs the client out */
  setTokens(tokens?: T): void {
    this.tokens = tokens;
    if (tokens) this.options.tokenStore?.set(tokens);
    else this.options.tokenStore?.del();
  }

  /**
   * Merges into the current tokens, skipping `undefined` values; throws
   * when signed out
   */
  updateTokens(tokens: Partial<T>): void {
    if (!this.tokens) throw new Error("No tokens to update: call setTokens");
    const defined = Object.fromEntries(
      Object.entries(tokens).filter(([, value]) => value !== undefined),
    );
    this.setTokens({ ...this.tokens, ...defined });
  }

  clearTokens(): void {
    this.setTokens(undefined);
  }

  /**
   * Follows a server-sent event stream at `path`. Uses the access token as
   * it is when called; an expired one is an `UnauthorizedException`, not a
   * refresh
   */
  stream<E = IServerSentEvent>(
    path: string,
    onEvent: (event: E) => void,
    { headers, signal }: IEventStreamOptions = {},
  ): Promise<void> {
    const accessToken = this.tokens?.accessToken;
    return readEventStream<E>(`${this.baseUrl}${path}`, onEvent, {
      headers: {
        ...headers,
        ...(accessToken && { Authorization: `Bearer ${accessToken}` }),
      },
      signal,
    });
  }

  // Retried once: a second 401 is the answer, not a reason to refresh again
  private async retryUnauthorized(
    response: AxiosResponse,
  ): Promise<AxiosResponse | undefined> {
    const config = response.config as InternalAxiosRequestConfig & {
      _retried?: boolean;
    };
    if (
      response.status !== 401 ||
      !this.tokens ||
      !this.options.refresh ||
      config._retried
    ) {
      return undefined;
    }
    // Sent before a refresh that has since ended: its token is already
    // replaced, so retry with the new one instead of spending another
    const sentWith = config.headers.get("Authorization");
    if (sentWith === `Bearer ${this.tokens.accessToken}`) {
      await this.refreshTokens();
    }
    config._retried = true;
    return this.axios.request(config);
  }

  // A refresh token is often good for one use, so requests that fail
  // together share one refresh rather than each spending (and the losers
  // voiding) it
  private refreshTokens(): Promise<void> {
    const { refresh } = this.options;
    const tokens = this.tokens;
    if (!refresh || !tokens) return Promise.resolve();

    this.refreshing ??= refresh(tokens, this.publicAxios)
      .then(
        (next) => this.setTokens(next),
        (error) => {
          this.clearTokens();
          throw error;
        },
      )
      .finally(() => {
        this.refreshing = undefined;
      });
    return this.refreshing;
  }
}
