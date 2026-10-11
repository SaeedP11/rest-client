import { HttpException } from "./http.exception";

export class BadRequestException extends HttpException {
  override name = "BadRequestException";
  /** The validation messages, when the backend sent several */
  errors?: string[];

  constructor(value: string | string[] = "Bad Request") {
    super(Array.isArray(value) ? value.join("; ") : value, 400);
    if (Array.isArray(value)) this.errors = value;
  }
}
