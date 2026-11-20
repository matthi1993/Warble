import { Emitter, type Listener, type Unsubscribe } from "./emitter";

export class Store<T> {
  private readonly changes = new Emitter<T>();

  constructor(private current: T) {}

  get value(): T {
    return this.current;
  }

  set(value: T): void {
    if (Object.is(value, this.current)) return;
    this.current = value;
    this.changes.emit(value);
  }

  update(change: (current: T) => T): void {
    this.set(change(this.current));
  }

  subscribe(listener: Listener<T>): Unsubscribe {
    return this.changes.subscribe(listener);
  }

  watch(listener: Listener<T>): Unsubscribe {
    listener(this.current);
    return this.subscribe(listener);
  }
}
