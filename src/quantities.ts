/**
 * SI units accepted by the Journey Model's physical quantity types.
 */
export type SIUnit = "m" | "m/s" | "m/s^2" | "s" | "kg" | "m^3/s^2";

declare const siValueBrand: unique symbol;

/**
 * A finite numeric value branded with its SI unit at compile time.
 *
 * @typeParam Unit - The SI unit represented by the number.
 */
export type SIValue<Unit extends SIUnit> = number & {
  readonly [siValueBrand]: Unit;
};

/**
 * A runtime-tagged SI quantity whose numeric value is also branded at compile time.
 *
 * @typeParam Unit - The SI unit represented by the quantity.
 */
export type SIQuantity<Unit extends SIUnit> = {
  readonly value: SIValue<Unit>;
  readonly unit: Unit;
};

/**
 * A distance measured in metres.
 */
export type Meters = SIQuantity<"m">;

/**
 * A speed measured in metres per second.
 */
export type MetersPerSecond = SIQuantity<"m/s">;

/**
 * An acceleration measured in metres per second squared.
 */
export type MetersPerSecondSquared = SIQuantity<"m/s^2">;

/**
 * A duration measured in seconds.
 */
export type Seconds = SIQuantity<"s">;

/**
 * A mass measured in kilograms.
 */
export type Kilograms = SIQuantity<"kg">;

/**
 * A standard gravitational parameter measured in cubic metres per second squared.
 */
export type GravitationalParameter = SIQuantity<"m^3/s^2">;

/**
 * A three-dimensional vector whose components share one SI unit.
 *
 * @typeParam Unit - The SI unit represented by each component.
 */
export type Vector3<Unit extends SIUnit> = {
  readonly x: SIQuantity<Unit>;
  readonly y: SIQuantity<Unit>;
  readonly z: SIQuantity<Unit>;
};

/**
 * A position vector in the Cluster Frame, measured in metres.
 */
export type PositionVector = Vector3<"m">;

/**
 * A velocity vector in the Cluster Frame, measured in metres per second.
 */
export type VelocityVector = Vector3<"m/s">;

/**
 * The exact speed of light used by the physical model, in SI units.
 */
export const SPEED_OF_LIGHT: MetersPerSecond = Object.freeze({
  value: 299_792_458 as SIValue<"m/s">,
  unit: "m/s",
});

function quantity<Unit extends SIUnit>(unit: Unit, value: number): SIQuantity<Unit> {
  if (!Number.isFinite(value)) {
    throw new RangeError(`An SI quantity must be finite; received ${String(value)}.`);
  }

  return Object.freeze({
    value: value as SIValue<Unit>,
    unit,
  });
}

/**
 * Creates a finite distance quantity in metres.
 *
 * @param value - The distance value in metres.
 * @returns A runtime-tagged, compile-time-branded metre quantity.
 * @throws RangeError when `value` is not finite.
 */
export function meters(value: number): Meters {
  return quantity("m", value);
}

/**
 * Creates a finite speed quantity in metres per second.
 *
 * @param value - The speed value in metres per second.
 * @returns A runtime-tagged, compile-time-branded speed quantity.
 * @throws RangeError when `value` is not finite.
 */
export function metersPerSecond(value: number): MetersPerSecond {
  return quantity("m/s", value);
}

/**
 * Creates a finite acceleration quantity in metres per second squared.
 *
 * @param value - The acceleration value in metres per second squared.
 * @returns A runtime-tagged, compile-time-branded acceleration quantity.
 * @throws RangeError when `value` is not finite.
 */
export function metersPerSecondSquared(value: number): MetersPerSecondSquared {
  return quantity("m/s^2", value);
}

/**
 * Creates a finite duration quantity in seconds.
 *
 * @param value - The duration value in seconds.
 * @returns A runtime-tagged, compile-time-branded seconds quantity.
 * @throws RangeError when `value` is not finite.
 */
export function seconds(value: number): Seconds {
  return quantity("s", value);
}

/**
 * Creates a finite standard gravitational parameter quantity.
 *
 * @param value - The gravitational parameter in m^3/s^2.
 * @returns A runtime-tagged, compile-time-branded gravitational parameter quantity.
 * @throws RangeError when `value` is not finite.
 */
export function metersCubedPerSecondSquared(value: number): GravitationalParameter {
  return quantity("m^3/s^2", value);
}

/**
 * Creates a finite mass quantity in kilograms.
 *
 * @param value - The mass value in kilograms.
 * @returns A runtime-tagged, compile-time-branded kilogram quantity.
 * @throws RangeError when `value` is not finite.
 */
export function kilograms(value: number): Kilograms {
  return quantity("kg", value);
}

/**
 * Creates a three-dimensional vector from three quantities with the same SI unit.
 *
 * @typeParam Unit - The SI unit shared by all components.
 * @param x - The x-axis component.
 * @param y - The y-axis component.
 * @param z - The z-axis component.
 * @returns An immutable vector with the supplied components.
 */
export function vector3<Unit extends SIUnit>(
  x: SIQuantity<Unit>,
  y: SIQuantity<Unit>,
  z: SIQuantity<Unit>,
): Vector3<Unit> {
  return Object.freeze({ x, y, z });
}
