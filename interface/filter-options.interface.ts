import { ISimpleFilter } from "./simple-filter.interface";

export interface IFilterOptions<T> {
  filter?: ISimpleFilter<T>[];
  search?: ISimpleFilter<T>[];
}
