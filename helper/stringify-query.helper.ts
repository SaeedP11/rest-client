/**
 * A query string without the `?`: dates as ISO strings, objects and arrays
 * (`filter`, `search`) as JSON, `undefined` values left out
 */
export const stringifyQuery = (obj: object): string =>
  Object.entries(obj)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => {
      const text =
        value instanceof Date
          ? value.toISOString()
          : typeof value === "object" && value !== null
            ? JSON.stringify(value)
            : String(value);
      return `${key}=${encodeURIComponent(text)}`;
    })
    .join("&");

/** `path?query`, or `path` alone when the query is empty */
export const withQuery = (path: string, obj: object = {}): string => {
  const query = stringifyQuery(obj);
  return query ? `${path}?${query}` : path;
};
