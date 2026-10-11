export class BadRequestException extends Error {
  status = 400;
  /** The validation messages, when the backend sent several */
  errors?: string[];

  constructor(value: string | string[]) {
    super(Array.isArray(value) ? value.join("; ") : value);
    if (Array.isArray(value)) this.errors = value;
  }
}
