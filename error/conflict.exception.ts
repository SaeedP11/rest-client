import { HttpException } from "./http.exception";

export class ConflictException extends HttpException {
  override name = "ConflictException";

  constructor(message = "Conflict") {
    super(message, 409);
  }
}
