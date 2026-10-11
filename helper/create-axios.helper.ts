import { Axios, AxiosResponse } from "axios";
import { throwResponseError } from "../constant/error-mapper.const";

/**
 * Bodies the adapter sends as they are (a Node stream has `pipe`):
 * everything else that is an object goes as JSON
 */
const isRawBody = (body: object): boolean =>
  (typeof FormData !== "undefined" && body instanceof FormData) ||
  (typeof Blob !== "undefined" && body instanceof Blob) ||
  body instanceof ArrayBuffer ||
  ArrayBuffer.isView(body) ||
  typeof (body as { pipe?: unknown }).pipe === "function";

/** A JSON object or array; other text (and JSON scalars) stays a string */
const parseJson = (text: string): unknown => {
  try {
    const value = JSON.parse(text);
    return typeof value === "object" && value !== null ? value : text;
  } catch {
    return text;
  }
};

/**
 * Called with a non-2xx response before it is thrown: a response it returns
 * (a retry, say) is the answer instead, `undefined` lets the error through
 */
export type RecoverResponse = (
  response: AxiosResponse,
) => Promise<AxiosResponse | undefined>;

/**
 * A bare `Axios` (no defaults, so every status resolves) that speaks JSON
 * and turns any non-2xx answer into the exception for its status
 */
export const createAxios = (
  baseURL: string,
  headers: Record<string, string> = {},
  recover?: RecoverResponse,
): Axios => {
  const axios = new Axios({
    baseURL,
    transformRequest: (request, requestHeaders) => {
      if (typeof request !== "object" || request === null) return request;
      // Neither adapter takes it as an object, so send it as a form
      if (
        typeof URLSearchParams !== "undefined" &&
        request instanceof URLSearchParams
      ) {
        requestHeaders.setContentType("application/x-www-form-urlencoded");
        return request.toString();
      }
      return isRawBody(request) ? request : JSON.stringify(request);
    },
    transformResponse: (response) =>
      typeof response === "string" ? parseJson(response) : response,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });

  axios.interceptors.response.use(async (response) => {
    if (response.status >= 200 && response.status < 300) return response;
    const recovered = await recover?.(response);
    if (recovered) return recovered;
    return throwResponseError(response.status, response.data);
  });

  return axios;
};
