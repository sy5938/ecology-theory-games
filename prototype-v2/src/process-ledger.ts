export const PROCESS_EVENT_TYPES = [
  'reproduction_credit_added',
  'seed_created',
  'long_distance_seed',
  'seed_established',
  'grid_colonized',
  'gap_release',
] as const

export type ProcessEventType = typeof PROCESS_EVENT_TYPES[number]

export type CountedProcessEventType = Exclude<ProcessEventType, 'reproduction_credit_added'>

interface ProcessLedgerEntryBase {
  speciesCode: string
  year: number
}

export type ProcessLedgerEntry = ProcessLedgerEntryBase & (
  | { type: 'reproduction_credit_added', amount: number }
  | { type: CountedProcessEventType, amount?: number }
)

export interface ProcessLedgerRecord extends ProcessLedgerEntryBase {
  type: ProcessEventType
  amount: number
}

export interface ProcessLedgerTotals {
  reproduction_credit_added: number
  seed_created: number
  long_distance_seed: number
  seed_established: number
  grid_colonized: number
  gap_release: number
}

const emptyTotals = (): ProcessLedgerTotals => ({
  reproduction_credit_added: 0,
  seed_created: 0,
  long_distance_seed: 0,
  seed_established: 0,
  grid_colonized: 0,
  gap_release: 0,
})

const clampCursor = (value: number, upperBound: number): number => {
  if (!Number.isFinite(value)) return value === Number.POSITIVE_INFINITY ? upperBound : 0
  return Math.min(upperBound, Math.max(0, Math.trunc(value)))
}

export class ProcessLedger {
  private readonly entries: ProcessLedgerRecord[] = []

  get cursor(): number {
    return this.entries.length
  }

  record(entry: ProcessLedgerEntry): void {
    const amount = entry.amount ?? 1
    if (!Number.isFinite(amount) || amount < 0) {
      throw new RangeError('Process ledger amounts must be finite and non-negative.')
    }
    if (entry.type !== 'reproduction_credit_added' && !Number.isInteger(amount)) {
      throw new RangeError('Counted process ledger amounts must be integers.')
    }
    this.entries.push({ ...entry, amount })
  }

  snapshot(): ReadonlyArray<Readonly<ProcessLedgerRecord>> {
    return this.entries.map((entry) => ({ ...entry }))
  }

  total(speciesCode: string, type: ProcessEventType): number {
    return this.entries.reduce(
      (sum, entry) => entry.speciesCode === speciesCode && entry.type === type ? sum + entry.amount : sum,
      0,
    )
  }

  totalsSince(
    startCursor: number,
    speciesCode: string,
    endCursor: number = this.cursor,
  ): ProcessLedgerTotals {
    const totals = emptyTotals()
    const start = clampCursor(startCursor, this.cursor)
    const end = clampCursor(endCursor, this.cursor)
    for (const entry of this.entries.slice(start, end)) {
      if (entry.speciesCode === speciesCode) totals[entry.type] += entry.amount
    }
    return totals
  }
}
