import { Axios } from "axios";
import { HttpClient } from "./http-client";
import { withQuery } from "./helper/stringify-query.helper";
import { IFilterOptions } from "./interface/filter-options.interface";
import { IPagination } from "./interface/pagination.interface";
import { IPaginationOptions } from "./interface/pagination-options.interface";
import { OmitOfCreate } from "./type/omit-of-create.type";

/**
 * The read routes a nova-mongoose backend serves for a resource at `route`:
 * `GET /:id`, `GET /?filter` and `GET /paginate`. Extend it for a resource
 * that is only read, or written through routes of its own
 */
export class ReadResourceService<T> {
  constructor(
    protected readonly http: HttpClient<any>,
    protected readonly route: string,
  ) {}

  protected get axios(): Axios {
    return this.http.axios;
  }

  async getById(id: string): Promise<T> {
    return (await this.axios.get<T>(`${this.route}/${id}`)).data;
  }

  async get(data: IFilterOptions<T> = {}): Promise<T[]> {
    return (await this.axios.get<T[]>(withQuery(this.route, data))).data;
  }

  async getPaginate(data: IPaginationOptions<T> = {}): Promise<IPagination<T>> {
    return (
      await this.axios.get<IPagination<T>>(
        withQuery(`${this.route}/paginate`, data),
      )
    ).data;
  }
}

/**
 * Every CRUD route: the read ones, and `POST /`, `PATCH /:id` and
 * `DELETE /:id`. Extend it and add the resource's own routes
 */
export class ResourceService<
  T,
  TCreate = OmitOfCreate<T>,
  TUpdate = Partial<TCreate>,
  TCreated = T,
> extends ReadResourceService<T> {
  async create(data: TCreate): Promise<TCreated> {
    return (await this.axios.post<TCreated>(this.route, data)).data;
  }

  async update(id: string, data: TUpdate): Promise<T> {
    return (await this.axios.patch<T>(`${this.route}/${id}`, data)).data;
  }

  async delete(id: string): Promise<T> {
    return (await this.axios.delete<T>(`${this.route}/${id}`)).data;
  }
}
