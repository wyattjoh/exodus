/**
 * A finite numeric three-dimensional vector used by the physics modules before SI tagging.
 */
export type NumericVector3 = {
  readonly x: number;
  readonly y: number;
  readonly z: number;
};

/**
 * Adds two numeric three-dimensional vectors component by component.
 *
 * @param left - The first vector.
 * @param right - The second vector.
 * @returns The component-wise sum.
 */
export function addVector(left: NumericVector3, right: NumericVector3): NumericVector3 {
  return { x: left.x + right.x, y: left.y + right.y, z: left.z + right.z };
}

/**
 * Subtracts one numeric three-dimensional vector from another.
 *
 * @param left - The vector from which to subtract.
 * @param right - The vector to subtract.
 * @returns The component-wise difference.
 */
export function subtractVector(left: NumericVector3, right: NumericVector3): NumericVector3 {
  return { x: left.x - right.x, y: left.y - right.y, z: left.z - right.z };
}

/**
 * Scales a numeric three-dimensional vector by a scalar.
 *
 * @param value - The vector to scale.
 * @param factor - The scalar multiplier.
 * @returns The scaled vector.
 */
export function scaleVector(value: NumericVector3, factor: number): NumericVector3 {
  return { x: value.x * factor, y: value.y * factor, z: value.z * factor };
}

/**
 * Computes the Euclidean magnitude of a numeric three-dimensional vector.
 *
 * @param value - The vector whose magnitude is requested.
 * @returns The non-negative Euclidean magnitude.
 */
export function vectorMagnitude(value: NumericVector3): number {
  return Math.hypot(value.x, value.y, value.z);
}
