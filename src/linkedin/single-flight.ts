export class SingleFlight {
  private tail: Promise<unknown> = Promise.resolve();
  private readonly activeByKey = new Map<string, Promise<unknown>>();

  run<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const active = this.activeByKey.get(key);
    if (active) return active as Promise<T>;

    const task = this.tail.then(operation, operation);
    this.tail = task.catch(() => undefined);
    this.activeByKey.set(key, task);
    void task.finally(() => this.activeByKey.delete(key)).catch(() => undefined);
    return task;
  }
}
