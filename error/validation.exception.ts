export class ValidationException extends Error {
  status = 422;
  errors: [];

  constructor(value: any) {
    super("Unprocessable Entity");
    this.errors = value;
  }
}
