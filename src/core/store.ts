/** Minimal observable store. */
export class Store<T extends object> {
  private listeners = new Set<(s: T, prev: T) => void>();
  constructor(private state: T) {}

  get(): T {
    return this.state;
  }

  set(patch: Partial<T>): void {
    const prev = this.state;
    this.state = { ...prev, ...patch };
    for (const l of [...this.listeners]) l(this.state, prev);
  }

  update(fn: (s: T) => Partial<T>): void {
    this.set(fn(this.state));
  }

  subscribe(fn: (s: T, prev: T) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
