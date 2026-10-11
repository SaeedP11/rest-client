import { HttpException } from "./http.exception";

export class ForbiddenException extends HttpException {
  override name = "ForbiddenException";

  constructor(message = "Forbidden") {
    super(message, 403);
  }
}
