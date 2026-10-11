import { HttpException } from "./http.exception";

export class InternalServerException extends HttpException {
  override name = "InternalServerException";

  constructor(message = "Internal Server Error") {
    super(message, 500);
  }
}
