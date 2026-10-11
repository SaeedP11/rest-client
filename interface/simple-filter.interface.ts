import { SimpleFilterOperator } from "../enum/simple-filter-operator.enum";

/**
 * Most operators take a scalar, `IN` / `NOT_IN` / `BETWEEN` take an array
 * (`BETWEEN` a `[min, max]` pair) and `ELM_MTC` takes an object
 */
export type SimpleFilterValue =
  | string
  | number
  | boolean
  | Date
  | (string | number | Date)[]
  | Record<string, unknown>;

/** A field of `T`, or any name when `T` is not given */
export type FilterField<T> = unknown extends T ? string : keyof T;

export interface ISimpleFilter<T = unknown> {
  field: FilterField<T>;
  operator: SimpleFilterOperator;
  value: SimpleFilterValue;
}
