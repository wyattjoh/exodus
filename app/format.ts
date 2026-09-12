import type { Seconds } from "../src/index";

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const YEAR = 365.25 * DAY;

/**
 * Reads the numeric value from a runtime-tagged SI quantity.
 *
 * @param quantity - A Seconds quantity or an unknown display value.
 * @returns The finite numeric value, or zero when the value is not a quantity.
 */
export function numericValue(quantity: Seconds | unknown): number {
  if (
    typeof quantity === "object" &&
    quantity !== null &&
    "value" in quantity &&
    typeof quantity.value === "number" &&
    Number.isFinite(quantity.value)
  ) {
    return quantity.value;
  }
  return 0;
}

/**
 * Formats elapsed seconds using adaptive human-readable units.
 *
 * @param quantity - Seconds to present.
 * @param precision - Maximum fractional digits for the selected unit.
 * @returns A readable duration with its unit.
 */
export function formatDuration(quantity: Seconds | number, precision = 2): string {
  const value = typeof quantity === "number" ? quantity : numericValue(quantity);
  const absolute = Math.abs(value);
  const sign = value < 0 ? "−" : "";
  if (absolute >= YEAR) {
    return `${sign}${(absolute / YEAR).toFixed(precision)} y`;
  }
  if (absolute >= DAY) {
    return `${sign}${(absolute / DAY).toFixed(precision)} d`;
  }
  if (absolute >= HOUR) {
    return `${sign}${(absolute / HOUR).toFixed(precision)} h`;
  }
  if (absolute >= MINUTE) {
    return `${sign}${(absolute / MINUTE).toFixed(precision)} min`;
  }
  return `${sign}${absolute.toFixed(precision)} s`;
}

/**
 * Formats a physical scalar with its SI unit and adaptive precision.
 *
 * @param value - Numeric value and unit to present.
 * @returns A readable value with the supplied unit.
 */
export function formatPhysicalValue(value: unknown): string {
  if (
    typeof value === "object" &&
    value !== null &&
    "value" in value &&
    "unit" in value &&
    typeof value.value === "number" &&
    typeof value.unit === "string"
  ) {
    return `${value.value.toPrecision(5)} ${value.unit}`;
  }
  return String(value);
}

/**
 * Formats a decimal ratio as a percentage.
 *
 * @param value - Ratio to present.
 * @returns A percentage string.
 */
export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/**
 * Turns a domain phase kind into a readable label without changing its meaning.
 *
 * @param kind - Journey phase kind from the model.
 * @returns Human-readable phase label.
 */
export function formatPhaseKind(kind: string): string {
  return kind
    .split("-")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
