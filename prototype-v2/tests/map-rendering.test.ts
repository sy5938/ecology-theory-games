import { describe, expect, it } from 'vitest'
import {
  DETAIL_LAYER_PROMPT_MAX_SPAN_METERS,
  FUNCTIONAL_TYPE_LEGEND,
  detailLayerHintState,
  fivePointStarVertices,
} from '../src/map-rendering'

describe('vector player marker geometry', () => {
  it('returns alternating outer and inner vertices for a five-point star', () => {
    const points = fivePointStarVertices(10, 20, 8)

    expect(points).toHaveLength(10)
    expect(points[0]).toEqual({ x: 10, y: 12 })
    for (let index = 0; index < points.length; index += 1) {
      const distance = Math.hypot(points[index].x - 10, points[index].y - 20)
      expect(distance).toBeCloseTo(index % 2 === 0 ? 8 : 3.6, 8)
    }
  })
})

describe('detail-layer LOD hint', () => {
  it('prompts only at a compact extent while both noisy layers remain hidden', () => {
    const compact = { left: 20, right: 40, bottom: 30, top: 50 }
    expect(detailLayerHintState(compact, false, false)).toMatchObject({
      compactView: true,
      shouldPrompt: true,
      maxSpanMeters: 20,
    })
    expect(detailLayerHintState(compact, true, false).shouldPrompt).toBe(false)
  })

  it('does not prompt at overview scale', () => {
    const overview = { left: 0, right: 100, bottom: 0, top: 100 }
    const state = detailLayerHintState(overview, false, false)
    expect(state.compactView).toBe(false)
    expect(state.shouldPrompt).toBe(false)
    expect(DETAIL_LAYER_PROMPT_MAX_SPAN_METERS).toBe(25)
  })
})

describe('functional-type legend contract', () => {
  it('contains the three strategy colors in stable display order', () => {
    expect(FUNCTIONAL_TYPE_LEGEND.map((item) => item.strategy)).toEqual(['sun', 'shade', 'broad'])
    expect(FUNCTIONAL_TYPE_LEGEND.every((item) => /^#[0-9a-f]{6}$/i.test(item.cssColor))).toBe(true)
  })
})
