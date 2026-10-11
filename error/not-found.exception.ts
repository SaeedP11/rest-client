import { HttpException } from "./http.exception";

export class NotFoundException extends HttpException {
  override name = "NotFoundException";

  constructor(message = "Not Found") {
    super(message, 404);
  }
}
