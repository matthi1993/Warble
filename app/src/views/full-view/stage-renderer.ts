import { html, type TemplateResult } from "lit";
import { VideoSources } from "@warble/media";
import type { FullViewController } from "./full-view-controller";

type PathEvent = CustomEvent<{ path: string }>;

function renderVideo(view: FullViewController, videoPath: string): TemplateResult {
  const { stage, viewState, slideshow } = view;
  const { proofingSize, frameSize, frameColor, frameRadius, sizing } = viewState.value;
  return html`<pf-video-view
    .path=${videoPath}
    .presenting=${stage.presenting}
    .proofingSize=${proofingSize}
    .frameSize=${frameSize}
    .frameColor=${viewState.colorCss(frameColor)}
    .frameRadius=${frameRadius}
    .sizing=${sizing}
    .background=${viewState.backgroundCss}
    @video-playing=${(event: PathEvent) => slideshow.videoPlaying(event.detail.path)}
    @video-ended=${(event: PathEvent) => slideshow.videoEnded(event.detail.path)}
    @video-error=${(event: PathEvent) => slideshow.videoFailed(event.detail.path)}
    @video-activate=${() => view.stageActivated()}
    @video-double-activate=${(event: Event) => view.stageDoubleActivated(event)}
    @video-swipe=${(event: CustomEvent<{ delta: number }>) => view.navigation.go(event.detail.delta)}
  ></pf-video-view>`;
}

function renderImage(view: FullViewController, path: string): TemplateResult {
  const { stage, viewState, editing, compare, slideshow } = view;
  const { proofingSize, frameSize, frameColor, frameRadius, sizing, autoRotate, smoothing } = viewState.value;
  const overrides = editing.canvasOverrides();
  return html`<pf-image-canvas
    .path=${path}
    ?presenting=${stage.presenting}
    .proofingSize=${proofingSize}
    .frameSize=${frameSize}
    .frameColor=${viewState.colorCss(frameColor)}
    .frameRadius=${frameRadius}
    .sizing=${overrides.sizing ?? sizing}
    .autoRotate=${autoRotate}
    .smoothingQuality=${smoothing}
    .cropMode=${overrides.cropMode ?? false}
    .cropAspect=${overrides.cropAspect ?? null}
    .rotation=${overrides.rotation ?? 0}
    ?horizonMode=${overrides.horizonMode ?? false}
    .previewOriginal=${compare.showing}
    .editing=${view.canvasEditing}
    .enableFullRes=${view.fullResolutionEnabled}
    background=${viewState.backgroundCss}
    @crop-change=${() => editing.canvasCropChanged()}
    @orientation-flip=${() => editing.canvasOrientationFlipped()}
    @horizon-line=${(event: CustomEvent<number>) => editing.canvasHorizonDrawn(Number(event.detail))}
    @image-activate=${() => view.stageActivated()}
    @image-double-activate=${(event: Event) => view.stageDoubleActivated(event)}
    @image-swipe=${(event: CustomEvent<{ delta: number }>) => view.navigation.go(event.detail.delta)}
    @image-ready=${(event: PathEvent) => view.imageReady(event.detail.path)}
    @image-error=${(event: PathEvent) => slideshow.imageFailed(event.detail.path)}
    @image-preview-start=${() => compare.show(true)}
    @image-preview-end=${() => compare.show(false)}
  ></pf-image-canvas>`;
}

function hideWhenFaded(event: TransitionEvent): void {
  (event.target as HTMLCanvasElement).style.display = "none";
}

export function renderStage(view: FullViewController, path: string): TemplateResult {
  const { stage, controls, host } = view;
  const videoPath = stage.activeVideoPath;
  const offersLivePhoto = stage.liveVideoPath && !VideoSources.isVideo(path) && !stage.presenting;
  return html`
    <div class="stage">
      ${offersLivePhoto
        ? html`<button class="live-toggle" type="button" @click=${() => view.toggleLivePhoto()}>
            ${stage.playLivePhoto ? "Show photo" : "Play Live Photo"}
          </button>`
        : null}
      ${videoPath ? renderVideo(view, videoPath) : renderImage(view, path)}
      <canvas class="slideshow-overlay" aria-hidden="true" @transitionend=${hideWhenFaded}></canvas>
      ${!videoPath && path
        ? html`<pf-rating-overlay
            class="fv-rating-overlay"
            .path=${path}
            ?fullscreen=${true}
            ?forceVisible=${!host.immersive || !controls.hidden}
            style="--pf-rating-inset: 16px; --pf-rating-star-size: 14px; --pf-rating-label-size: 8px;"
          ></pf-rating-overlay>`
        : null}
    </div>
  `;
}
