import { HttpException } from "./http.exception";

export class UnauthorizedException extends HttpException {
  override name = "UnauthorizedException";

  constructor(message = "Unauthorized") {
    super(message, 401);
  }
}
