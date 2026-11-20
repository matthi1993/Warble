import { css } from "lit";

export const videoViewStyles = css`
  :host {
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    background: var(--video-background, #000);
  }
  .proof {
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    max-width: 100%;
    max-height: 100%;
    padding: var(--proof-size);
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 0;
    min-height: 0;
    touch-action: pan-y;
  }
  .frame {
    box-sizing: border-box;
    max-width: 100%;
    max-height: 100%;
    padding: var(--frame-size);
    background: var(--frame-color);
    border-radius: var(--frame-radius);
    overflow: hidden;
    display: flex;
    min-width: 0;
    min-height: 0;
  }
  video {
    display: block;
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    border-radius: var(--frame-radius);
    background: #000;
  }
  :host([sizing="fill"]) .proof, :host([sizing="fill"]) .frame {
    width: 100%;
    height: 100%;
  }
  :host([sizing="fill"]) video {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .error { color: #ff8080; padding: 1rem; }
`;
