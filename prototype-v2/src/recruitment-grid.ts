export type GridOccupationSource = 'initial' | 'transplant' | 'establishment'

export interface GridRegistration {
  newlyOccupied: boolean
  gridColonized: boolean
}

const cellIndex = (coordinate: number, divisions: number): number => (
  Math.min(divisions - 1, Math.max(0, Math.floor(coordinate * divisions)))
)

export class RecruitmentGrid {
  private readonly cellsBySpecies = new Map<string, Set<number>>()

  constructor(private readonly divisions = 10) {
    if (!Number.isInteger(divisions) || divisions <= 0) {
      throw new RangeError('Grid divisions must be a positive integer.')
    }
  }

  register(
    speciesCode: string,
    x: number,
    y: number,
    source: GridOccupationSource,
  ): GridRegistration {
    let cells = this.cellsBySpecies.get(speciesCode)
    if (!cells) {
      cells = new Set<number>()
      this.cellsBySpecies.set(speciesCode, cells)
    }
    const cell = cellIndex(y, this.divisions) * this.divisions + cellIndex(x, this.divisions)
    const newlyOccupied = !cells.has(cell)
    cells.add(cell)
    return {
      newlyOccupied,
      gridColonized: newlyOccupied && source === 'establishment',
    }
  }

  occupiedCount(speciesCode: string): number {
    return this.cellsBySpecies.get(speciesCode)?.size ?? 0
  }
}
