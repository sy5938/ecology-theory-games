import { STRATEGIES, type Strategy } from './species'

export interface Point2D {
  x: number
  y: number
}

export interface ViewExtent {
  left: number
  right: number
  bottom: number
  top: number
}

export interface DetailLayerHintState {
  compactView: boolean
  shouldPrompt: boolean
  maxSpanMeters: number
  riskVisible: boolean
  deathVisible: boolean
}

export interface FunctionalTypeLegendItem {
  strategy: Strategy
  label: string
  color: number
  cssColor: string
}

export const DETAIL_LAYER_PROMPT_MAX_SPAN_METERS = 25

export const FUNCTIONAL_TYPE_LEGEND: readonly FunctionalTypeLegendItem[] = (
  ['sun', 'shade', 'broad'] as const
).map((strategy) => ({
  strategy,
  label: STRATEGIES[strategy].short,
  color: STRATEGIES[strategy].color,
  cssColor: STRATEGIES[strategy].css,
}))

export function fivePointStarVertices(
  centerX: number,
  centerY: number,
  outerRadius: number,
  innerRadiusRatio = 0.45,
): Point2D[] {
  const innerRadius = outerRadius * innerRadiusRatio
  return Array.from({ length: 10 }, (_, index) => {
    const radius = index % 2 === 0 ? outerRadius : innerRadius
    const angle = -Math.PI / 2 + index * Math.PI / 5
    return {
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius,
    }
  })
}

export function detailLayerHintState(
  extent: ViewExtent,
  riskVisible: boolean,
  deathVisible: boolean,
): DetailLayerHintState {
  const maxSpanMeters = Math.max(
    Math.max(0, extent.right - extent.left),
    Math.max(0, extent.top - extent.bottom),
  )
  const compactView = maxSpanMeters <= DETAIL_LAYER_PROMPT_MAX_SPAN_METERS
  return {
    compactView,
    shouldPrompt: compactView && !riskVisible && !deathVisible,
    maxSpanMeters,
    riskVisible,
    deathVisible,
  }
}
