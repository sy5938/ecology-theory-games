import { describe, expect, it } from 'vitest'
import { PROCESS_EVENT_TYPES, ProcessLedger } from '../src/process-ledger'

const EMPTY_TOTALS = {
  reproduction_credit_added: 0,
  seed_created: 0,
  long_distance_seed: 0,
  seed_established: 0,
  grid_colonized: 0,
  gap_release: 0,
}

describe('ProcessLedger', () => {
  it('publishes recruitment metrics in a stable order', () => {
    expect(PROCESS_EVENT_TYPES).toEqual([
      'reproduction_credit_added',
      'seed_created',
      'long_distance_seed',
      'seed_established',
      'grid_colonized',
      'gap_release',
    ])
  })

  it('exposes the next record position as a read-only cursor', () => {
    const ledger = new ProcessLedger()
    expect(ledger.cursor).toBe(0)

    ledger.record({ speciesCode: 'MACLEP', year: 1, type: 'seed_created' })
    ledger.record({ speciesCode: 'MACLEP', year: 1, type: 'seed_established' })

    expect(ledger.cursor).toBe(2)
  })

  it('totals every metric recorded since a cursor', () => {
    const ledger = new ProcessLedger()
    ledger.record({ speciesCode: 'MACLEP', year: 1, type: 'seed_created', amount: 9 })
    const startCursor = ledger.cursor
    ledger.record({ speciesCode: 'MACLEP', year: 2, type: 'reproduction_credit_added', amount: 1.5 })
    ledger.record({ speciesCode: 'MACLEP', year: 2, type: 'seed_created', amount: 2 })

    expect(ledger.totalsSince(startCursor, 'MACLEP')).toEqual({
      ...EMPTY_TOTALS,
      reproduction_credit_added: 1.5,
      seed_created: 2,
    })
  })

  it('returns zero totals for an empty half-open cursor interval', () => {
    const ledger = new ProcessLedger()
    ledger.record({ speciesCode: 'MACLEP', year: 1, type: 'seed_created', amount: 5 })

    expect(ledger.totalsSince(1, 'MACLEP', 1)).toEqual(EMPTY_TOTALS)
  })

  it('isolates cursor totals by species', () => {
    const ledger = new ProcessLedger()
    ledger.record({ speciesCode: 'MACLEP', year: 1, type: 'seed_created', amount: 2 })
    ledger.record({ speciesCode: 'CYTOCO', year: 1, type: 'seed_created', amount: 7 })

    expect(ledger.totalsSince(0, 'MACLEP')).toEqual({ ...EMPTY_TOTALS, seed_created: 2 })
    expect(ledger.totalsSince(0, 'CYTOCO')).toEqual({ ...EMPTY_TOTALS, seed_created: 7 })
  })

  it('keeps an explicit ending cursor frozen as later records arrive', () => {
    const ledger = new ProcessLedger()
    ledger.record({ speciesCode: 'MACLEP', year: 1, type: 'seed_created', amount: 2 })
    const endCursor = ledger.cursor
    ledger.record({ speciesCode: 'MACLEP', year: 2, type: 'gap_release', amount: 3 })

    expect(ledger.totalsSince(0, 'MACLEP', endCursor)).toEqual({
      ...EMPTY_TOTALS,
      seed_created: 2,
    })
    expect(ledger.totalsSince(endCursor, 'MACLEP')).toEqual({
      ...EMPTY_TOTALS,
      gap_release: 3,
    })
  })

  it('clamps invalid and out-of-range cursors to safe ledger bounds', () => {
    const ledger = new ProcessLedger()
    ledger.record({ speciesCode: 'MACLEP', year: 1, type: 'seed_created', amount: 2 })
    ledger.record({ speciesCode: 'MACLEP', year: 2, type: 'seed_established', amount: 3 })

    expect(ledger.totalsSince(-1, 'MACLEP', 999)).toEqual({
      ...EMPTY_TOTALS,
      seed_created: 2,
      seed_established: 3,
    })
    expect(ledger.totalsSince(Number.NaN, 'MACLEP', 1)).toEqual({
      ...EMPTY_TOTALS,
      seed_created: 2,
    })
    expect(ledger.totalsSince(0, 'MACLEP', Number.NaN)).toEqual(EMPTY_TOTALS)
    expect(ledger.totalsSince(Number.POSITIVE_INFINITY, 'MACLEP')).toEqual(EMPTY_TOTALS)
    expect(ledger.totalsSince(2, 'MACLEP', -5)).toEqual(EMPTY_TOTALS)
  })

  it('accumulates reproduction credit and counted events independently by species', () => {
    const ledger = new ProcessLedger()

    ledger.record({ speciesCode: 'MACLEP', year: 1, type: 'reproduction_credit_added', amount: 1.25 })
    ledger.record({ speciesCode: 'MACLEP', year: 2, type: 'reproduction_credit_added', amount: 2.5 })
    ledger.record({ speciesCode: 'MACLEP', year: 2, type: 'seed_created', amount: 4 })
    ledger.record({ speciesCode: 'CYTOCO', year: 2, type: 'seed_created', amount: 7 })

    expect(ledger.total('MACLEP', 'reproduction_credit_added')).toBeCloseTo(3.75)
    expect(ledger.total('MACLEP', 'seed_created')).toBe(4)
    expect(ledger.total('CYTOCO', 'seed_created')).toBe(7)
    expect(ledger.total('UNKNOWN', 'seed_created')).toBe(0)
    expect(ledger.total('MACLEP', 'grid_colonized')).toBe(0)
  })

  it('records every recruitment process counter with a default count of one', () => {
    const ledger = new ProcessLedger()

    ledger.record({ speciesCode: 'MACLEP', year: 3, type: 'seed_created' })
    ledger.record({ speciesCode: 'MACLEP', year: 3, type: 'long_distance_seed' })
    ledger.record({ speciesCode: 'MACLEP', year: 3, type: 'seed_established' })
    ledger.record({ speciesCode: 'MACLEP', year: 3, type: 'grid_colonized' })
    ledger.record({ speciesCode: 'MACLEP', year: 3, type: 'gap_release', amount: 2 })

    expect(ledger.total('MACLEP', 'seed_created')).toBe(1)
    expect(ledger.total('MACLEP', 'long_distance_seed')).toBe(1)
    expect(ledger.total('MACLEP', 'seed_established')).toBe(1)
    expect(ledger.total('MACLEP', 'grid_colonized')).toBe(1)
    expect(ledger.total('MACLEP', 'gap_release')).toBe(2)
  })

  it('rejects non-finite, negative, or fractional counts', () => {
    const ledger = new ProcessLedger()

    expect(() => ledger.record({
      speciesCode: 'MACLEP', year: 1, type: 'reproduction_credit_added', amount: Number.NaN,
    })).toThrow(RangeError)
    expect(() => ledger.record({
      speciesCode: 'MACLEP', year: 1, type: 'reproduction_credit_added', amount: -0.1,
    })).toThrow(RangeError)
    expect(() => ledger.record({
      speciesCode: 'MACLEP', year: 1, type: 'seed_created', amount: 1.5,
    })).toThrow(RangeError)
    expect(ledger.cursor).toBe(0)
  })

  it('returns a detached snapshot that cannot mutate recorded totals', () => {
    const ledger = new ProcessLedger()
    ledger.record({ speciesCode: 'MACLEP', year: 2, type: 'seed_established', amount: 3 })

    const snapshot = ledger.snapshot()
    const mutableSnapshot = snapshot as Array<{ amount: number }>
    mutableSnapshot[0].amount = 99
    mutableSnapshot.push({ amount: 100 })

    expect(ledger.total('MACLEP', 'seed_established')).toBe(3)
    expect(ledger.snapshot()).toEqual([
      { speciesCode: 'MACLEP', year: 2, type: 'seed_established', amount: 3 },
    ])
  })
})
