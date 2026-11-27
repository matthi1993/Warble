export interface EffectLayers<S> {
  readonly photo: S | null;
  readonly post: S | null;
}

export abstract class Effect<S> {
  abstract readonly id: string;
  abstract defaults(): S;
  abstract isNeutral(settings: S | null | undefined): boolean;
}
