import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { router, type Route } from "./router";

@customElement("photoflow-app")
export class PhotoflowApp extends LitElement {
  static styles = css`
    :host {
      display: block;
      font-family: system-ui, sans-serif;
      height: 100vh;
    }
    main {
      padding: 1rem;
    }
  `;

  @state()
  private route: Route = router.current();

  connectedCallback(): void {
    super.connectedCallback();
    router.subscribe((r) => {
      this.route = r;
    });
  }

  render() {
    return html`
      <main>
        <h1>Photoflow</h1>
        <p>Current route: ${this.route.path}</p>
        <pf-button @click=${() => router.navigate("/library")}>
          Go to library
        </pf-button>
      </main>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "photoflow-app": PhotoflowApp;
  }
}
