/**
 * Tokens kept in a file between runs (in a browser, localStorage), and an
 * expired access token refreshed without the caller noticing
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from "fs";
import { ITokenStore } from "@sp11/rest-client";
import { createClient, ITokens } from "./client";

export const fileTokenStore = (path: string): ITokenStore<ITokens> => ({
  get: () =>
    existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined,
  set: (tokens) => writeFileSync(path, JSON.stringify(tokens)),
  del: () => rmSync(path, { force: true }),
});

/** The browser equivalent */
export const localStorageTokenStore = (key: string): ITokenStore<ITokens> => ({
  get: () => JSON.parse(localStorage.getItem(key) ?? "null") ?? undefined,
  set: (tokens) => localStorage.setItem(key, JSON.stringify(tokens)),
  del: () => localStorage.removeItem(key),
});

export const main = async (
  baseUrl: string,
  tokenFile: string,
  expireAccessTokens: () => void,
  log = console.log,
) => {
  const first = createClient(baseUrl, fileTokenStore(tokenFile));
  await first.auth.login("demo", "demo");
  const before = first.http.getTokens();
  log("signed in with", before?.accessToken);

  // A new client, as after a restart, picks the tokens up from the store
  const { http, auth } = createClient(baseUrl, fileTokenStore(tokenFile));
  log("restored", http.getTokens()?.accessToken);

  // The server lets the access token expire. The three requests each get a
  // 401, share one refresh, and are retried with the new token
  expireAccessTokens();
  const answers = await Promise.all([auth.me(), auth.me(), auth.me()]);
  const after = http.getTokens();
  log("answered", answers.map((me) => me.username).join(", "));
  log("refreshed to", after?.accessToken, "and saved it");

  auth.logout();
  log("signed out, token file removed:", !existsSync(tokenFile));

  return { before, after, answers };
};
