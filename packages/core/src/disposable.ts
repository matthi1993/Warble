export interface Disposable {
  dispose(): void;
}

export class DisposableBag implements Disposable {
  private readonly items: Array<Disposable | (() => void)> = [];

  add(item: Disposable | (() => void)): void {
    this.items.push(item);
  }

  dispose(): void {
    for (const item of this.items.splice(0).reverse()) {
      if (typeof item === "function") item();
      else item.dispose();
    }
  }
}
