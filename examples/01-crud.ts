/** Sign in, then create, read, update and delete through a ResourceService */
import { createClient } from "./client";

export const main = async (baseUrl: string, log = console.log) => {
  const { auth, posts } = createClient(baseUrl);
  await auth.login("demo", "demo");

  const post = await posts.create({ title: "Hello" });
  log("created", post.id, post.title);

  log("read", (await posts.getById(post.id)).title);

  const renamed = await posts.update(post.id, { title: "Hello, world" });
  log("updated", renamed.title);

  const liked = await posts.like(post.id);
  log("liked", liked.views);

  await posts.delete(post.id);
  log("left", (await posts.get()).length);

  return { renamed, liked };
};
