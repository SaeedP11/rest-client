export interface IPagination<T> {
  totalItems: number;
  items: T[];
  totalPages: number;
  page: number;
  limit: number;
}
