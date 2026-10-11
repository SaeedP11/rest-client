/** Filters, search, sort and pages, in the format nova-mongoose reads */
import { IPaginationOptions, SimpleFilterOperator } from "@sp11/rest-client";
import { createClient } from "./client";
import type { IPost } from "./mock-api";

export const main = async (baseUrl: string, log = console.log) => {
  const { auth, posts } = createClient(baseUrl);
  await auth.login("demo", "demo");
  for (let i = 1; i <= 12; i++) {
    await posts.create({
      title: i % 3 ? `Note ${i}` : `Recipe ${i}`,
      views: i * 10,
    });
  }

  // `filter` items must all match (AND)
  const popular = await posts.get({
    filter: [
      { field: "views", operator: SimpleFilterOperator.GTE, value: 50 },
      { field: "title", operator: SimpleFilterOperator.ILIKE, value: "note" },
    ],
  });
  log(
    "popular notes",
    popular.map((post) => post.title),
  );

  // `search` items are alternatives (OR): what a search box sends
  const found = await posts.get({
    search: [
      { field: "title", operator: SimpleFilterOperator.ILIKE, value: "recipe" },
      { field: "views", operator: SimpleFilterOperator.IN, value: [10, 20] },
    ],
  });
  log(
    "found",
    found.map((post) => post.title),
  );

  // Pages are 1-based; `sort` takes `+field` / `-field`, comma-separated
  const options: IPaginationOptions<IPost> = {
    filter: [
      {
        field: "views",
        operator: SimpleFilterOperator.BETWEEN,
        value: [20, 110],
      },
    ],
    sort: "-views",
    limit: 5,
  };
  const first = await posts.getPaginate({ ...options, page: 1 });
  log(
    `page 1 of ${first.totalPages} (${first.totalItems} posts)`,
    first.items.map((post) => post.views),
  );
  const last = await posts.getPaginate({ ...options, page: first.totalPages });
  log(
    `page ${last.page}`,
    last.items.map((post) => post.views),
  );

  return { popular, found, first, last };
};
