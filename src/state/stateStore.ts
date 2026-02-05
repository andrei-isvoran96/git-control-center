export class StateStore<T> {
  private readonly cache = new Map<string, { value: T; timestamp: number }>();

  get(key: string): T | undefined {
    return this.cache.get(key)?.value;
  }

  set(key: string, value: T): void {
    this.cache.set(key, { value, timestamp: Date.now() });
  }

  invalidate(key?: string): void {
    if (!key) {
      this.cache.clear();
      return;
    }
    this.cache.delete(key);
  }

  isFresh(key: string, maxAgeMs: number): boolean {
    const cached = this.cache.get(key);
    if (!cached) {
      return false;
    }
    return Date.now() - cached.timestamp <= maxAgeMs;
  }
}
