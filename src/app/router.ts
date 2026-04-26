export interface Route {
  path: string;
}

type Listener = (route: Route) => void;

class Router {
  private listeners = new Set<Listener>();

  current(): Route {
    return { path: window.location.hash.slice(1) || "/" };
  }

  navigate(path: string): void {
    window.location.hash = path;
    this.emit();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    const onHashChange = () => this.emit();
    window.addEventListener("hashchange", onHashChange);
    return () => {
      this.listeners.delete(listener);
      window.removeEventListener("hashchange", onHashChange);
    };
  }

  private emit(): void {
    const route = this.current();
    for (const l of this.listeners) l(route);
  }
}

export const router = new Router();
