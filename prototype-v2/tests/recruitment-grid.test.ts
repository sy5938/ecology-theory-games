import { describe, expect, it } from 'vitest'
import { RecruitmentGrid } from '../src/recruitment-grid'

describe('RecruitmentGrid', () => {
  it('prefills initial occupancy without counting it and deduplicates the same species and cell', () => {
    const grid = new RecruitmentGrid()

    expect(grid.register('MACLEP', 0.05, 0.05, 'initial')).toEqual({
      newlyOccupied: true,
      gridColonized: false,
    })
    expect(grid.register('MACLEP', 0.09, 0.09, 'establishment')).toEqual({
      newlyOccupied: false,
      gridColonized: false,
    })
    expect(grid.occupiedCount('MACLEP')).toBe(1)
  })

  it('isolates historical occupancy by species', () => {
    const grid = new RecruitmentGrid()
    grid.register('MACLEP', 0.25, 0.25, 'initial')

    expect(grid.register('SASTZU', 0.25, 0.25, 'establishment')).toEqual({
      newlyOccupied: true,
      gridColonized: true,
    })
    expect(grid.occupiedCount('MACLEP')).toBe(1)
    expect(grid.occupiedCount('SASTZU')).toBe(1)
  })

  it('can colonize at most 100 ten-meter cells per species', () => {
    const grid = new RecruitmentGrid()
    let events = 0
    for (let row = 0; row < 10; row += 1) {
      for (let column = 0; column < 10; column += 1) {
        const result = grid.register(
          'SASTZU',
          (column + 0.5) / 10,
          (row + 0.5) / 10,
          'establishment',
        )
        if (result.gridColonized) events += 1
      }
    }

    expect(events).toBe(100)
    expect(grid.occupiedCount('SASTZU')).toBe(100)
    expect(grid.register('SASTZU', 0.95, 0.95, 'establishment').gridColonized).toBe(false)
    expect(grid.occupiedCount('SASTZU')).toBe(100)
  })

  it('registers a transplant without turning it or later establishment into colonization', () => {
    const grid = new RecruitmentGrid()

    expect(grid.register('MACLEP', 0.35, 0.45, 'transplant')).toEqual({
      newlyOccupied: true,
      gridColonized: false,
    })
    expect(grid.occupiedCount('MACLEP')).toBe(1)
    expect(grid.register('MACLEP', 0.39, 0.49, 'establishment')).toEqual({
      newlyOccupied: false,
      gridColonized: false,
    })
  })
})
