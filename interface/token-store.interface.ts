/** Where the client keeps its tokens between sessions (localStorage, a file, ...) */
export interface ITokenStore<T> {
  set(tokens: T): void;
  get(): T | undefined;
  del(): void;
}
