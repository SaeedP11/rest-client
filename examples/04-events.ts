/** Following server-sent events, and closing the stream with an AbortSignal */
import { IServerSentEvent } from "@sp11/rest-client";
import { createClient } from "./client";

export const main = async (baseUrl: string, log = console.log) => {
  const { http, auth, posts } = createClient(baseUrl);
  await auth.login("demo", "demo");

  const events: IServerSentEvent[] = [];
  const controller = new AbortController();
  // Resolves when the server ends the stream or the signal aborts it. Note
  // that `stream` does not refresh: an expired token is an UnauthorizedException
  const following = http.stream(
    "/post/live",
    (event) => {
      events.push(event);
      log("event", event.type, event.data);
      if (event.type === "deleted") controller.abort();
    },
    { signal: controller.signal },
  );

  // Give the stream a moment to connect before anything happens
  await new Promise((resolve) => setTimeout(resolve, 50));
  const post = await posts.create({ title: "Live" });
  await posts.delete(post.id);

  await following;
  log("stream closed after", events.length, "events");
  return events;
};
