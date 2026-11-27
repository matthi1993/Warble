import { html } from "lit";

export function renderInlineName(
  name: string,
  kind: "Group" | "Preset",
  save: (name: string) => boolean,
  close: () => void,
) {
  return html`
    <form class="inline-name" @submit=${(event: SubmitEvent) => {
      event.preventDefault();
      const input = (event.currentTarget as HTMLFormElement).querySelector("input")!;
      const next = input.value.trim();
      if (next && save(next)) {
        close();
        return;
      }
      input.setCustomValidity(next ? `This ${kind.toLowerCase()} name is already in use.` : "Enter a name.");
      input.reportValidity();
    }} @keydown=${(event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    }}>
      <input aria-label="${kind} name" maxlength="64" required .value=${name}
        @input=${(event: Event) => (event.target as HTMLInputElement).setCustomValidity("")}
      />
      <button class="group-action" type="submit" title="Save name" aria-label="Save name"><pf-icon name="check"></pf-icon></button>
    </form>
  `;
}
