export function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value))
}

export function competitionFromLoad(neighborLoad: number): number {
  return sigmoid(1.4 * (neighborLoad - 3))
}

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}
