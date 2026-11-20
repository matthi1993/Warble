import {
  EffectRegistry,
  normalizeAnalog,
  normalizeClarity,
  normalizeColor,
  type AnalogSettings,
  type ClaritySettings,
  type Effect,
  type EffectId,
  type EffectSettingsMap,
} from "@warble/render";

export type SettingsNormalizers = {
  readonly [K in EffectId]?: (value: unknown) => EffectSettingsMap[K];
};

export class EffectCatalog {
  constructor(
    readonly registry: EffectRegistry,
    private readonly normalizers: SettingsNormalizers = {},
  ) {}

  static standard(): EffectCatalog {
    return new EffectCatalog(EffectRegistry.standard(), {
      clarity: (value) => normalizeClarity(value as Partial<ClaritySettings> | null),
      analog: (value) => normalizeAnalog(value as Partial<AnalogSettings> | null),
      color: normalizeColor,
    });
  }

  get ids(): EffectId[] {
    return this.registry.effects.map((effect) => effect.id as EffectId);
  }

  has(id: string): id is EffectId {
    return this.registry.get(id) !== undefined;
  }

  defaults<K extends EffectId>(id: K): EffectSettingsMap[K] {
    return this.effect(id).defaults() as EffectSettingsMap[K];
  }

  isNeutral<K extends EffectId>(id: K, settings: EffectSettingsMap[K] | null | undefined): boolean {
    return this.effect(id).isNeutral(settings);
  }

  /** Effects without their own normalizer get missing keys filled in from the defaults. */
  normalize<K extends EffectId>(id: K, value: unknown): EffectSettingsMap[K] {
    const normalizer = this.normalizers[id];
    if (normalizer) return normalizer(value);
    return { ...this.defaults(id), ...(value as Partial<EffectSettingsMap[K]> | null) };
  }

  private effect(id: EffectId): Effect<unknown> {
    const effect = this.registry.get(id);
    if (!effect) throw new Error(`Unknown effect "${id}"`);
    return effect;
  }
}
