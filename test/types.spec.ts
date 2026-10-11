import { describe, expectTypeOf, it } from "vitest";
import {
  IPaginationOptions,
  ISimpleFilter,
  SimpleFilterOperator,
  ValidationException,
} from "../index";

interface IPost {
  title: string;
  views: number;
}

describe("filter types", () => {
  it("limits field to the resource's keys", () => {
    expectTypeOf<ISimpleFilter<IPost>["field"]>().toEqualTypeOf<
      "title" | "views"
    >();
    const filter: ISimpleFilter<IPost> = {
      // @ts-expect-error: not a field of IPost
      field: "author",
      operator: SimpleFilterOperator.EQ,
      value: "x",
    };
    void filter;
  });

  it("takes any field name without a resource type", () => {
    expectTypeOf<ISimpleFilter["field"]>().toEqualTypeOf<string>();
    const options: IPaginationOptions = {
      filter: [
        { field: "owner.name", operator: SimpleFilterOperator.EQ, value: "x" },
      ],
    };
    void options;
  });
});

describe("exception types", () => {
  it("types a 422's errors as a list", () => {
    expectTypeOf<ValidationException["errors"]>().toEqualTypeOf<
      unknown[] | undefined
    >();
  });
});
