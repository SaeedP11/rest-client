import { HttpException } from "./http.exception";

/**
 * A 422. The message is the backend's when it sent text (one string, or
 * several joined with "; "); anything else it sent is kept in `errors`
 */
export class ValidationException extends HttpException {
  override name = "ValidationException";
  /** Every message (or error object) the backend sent, when it sent a list */
  errors?: unknown[];

  constructor(value: unknown = "Unprocessable Entity") {
    super(
      typeof value === "string"
        ? value
        : isTextList(value)
          ? value.join("; ")
          : "Unprocessable Entity",
      422,
    );
    if (Array.isArray(value)) this.errors = value;
  }
}

const isTextList = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every((item) => typeof item === "string");
