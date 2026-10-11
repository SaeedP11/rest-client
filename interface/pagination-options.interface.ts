import { PaginationSort } from "../type/pagination-sort.type";
import { ISimpleFilter } from "./simple-filter.interface";

export interface IPaginationOptions<T = unknown> {
  filter?: ISimpleFilter<T>[];
  search?: ISimpleFilter<T>[];
  sort?: PaginationSort;
  page?: number;
  limit?: number;
}
