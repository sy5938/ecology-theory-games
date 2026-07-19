import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { createExportArchive } from '../src/export-data'
import { competitionFromLoad, sigmoid } from '../src/pressure'
import { ForestSimulation } from '../src/simulation'
import { SPECIES } from '../src/species'

const playerCode = SPECIES[0].code

function advanceTo(simulation: ForestSimulation, targetYear: number): void {
  let guard = 0
  while (simulation.forestYear < targetYear && !simulation.paused && guard < 20_000) {
    simulation.update(0.1)
    guard += 1
  }
}

describe('pressure mapping', () => {
  it('maps local load monotonically into a bounded sigmoid risk', () => {
    expect(sigmoid(-100)).toBeGreaterThanOrEqual(0)
    expect(sigmoid(100)).toBeLessThanOrEqual(1)
    expect(competitionFromLoad(1)).toBeLessThan(competitionFromLoad(3))
    expect(competitionFromLoad(3)).toBeLessThan(competitionFromLoad(7))
  })
})

describe('scenario generator', () => {
  it.each([11, 2026, 987654])('accepts a genuinely closed canopy for seed %i', (seed) => {
    const simulation = new ForestSimulation(SPECIES, playerCode, 'closed', seed)
    expect(simulation.individuals).toHaveLength(360)
    expect(simulation.initialCanopyCover).toBeGreaterThanOrEqual(0.95)
    expect(simulation.activeSpecies.filter((species) => species.maxHeight > 10).length).toBeGreaterThanOrEqual(4)
    const averageUnderstoryLight = Array.from(simulation.lightGrid).reduce((sum, light) => sum + light, 0) / simulation.lightGrid.length
    expect(averageUnderstoryLight).toBeGreaterThanOrEqual(0.15)
    expect(averageUnderstoryLight).toBeLessThanOrEqual(0.35)
    const canopy = simulation.individuals.filter((individual) => individual.canopy)
    const onOldLattice = canopy.filter((individual) => {
      const column = Math.round(individual.x * 12 - 0.5)
      const row = Math.round(individual.y * 8 - 0.5)
      const latticeX = (column + 0.5) / 12
      const latticeY = (row + 0.5) / 8
      return Math.hypot(individual.x - latticeX, individual.y - latticeY) < 0.012
    }).length
    expect(onOldLattice / canopy.length).toBeLessThan(0.35)
  })

  it.each([11, 2026, 987654])('keeps sparse cover in the promised band for seed %i', (seed) => {
    const simulation = new ForestSimulation(SPECIES, playerCode, 'sparse', seed)
    expect(simulation.individuals).toHaveLength(108)
    expect(simulation.initialCanopyCover).toBeGreaterThanOrEqual(0.15)
    expect(simulation.initialCanopyCover).toBeLessThanOrEqual(0.3)
  })

  it('starts colonization with exactly six non-adult player individuals', () => {
    const simulation = new ForestSimulation(SPECIES, playerCode, 'colonization', 2026)
    const playerPopulation = simulation.population(playerCode)
    expect(playerPopulation).toHaveLength(6)
    expect(playerPopulation.some((individual) => individual.stage === 'adult')).toBe(false)
  })
})

describe('forest-year checkpoint and export', () => {
  it('forces only the year-30 checkpoint and unlocks long-term speeds', () => {
    const simulation = new ForestSimulation(SPECIES, playerCode, 'closed', 2026)
    advanceTo(simulation, 30)
    expect(simulation.paused).toBe(true)
    expect(simulation.report?.title).toBe('第 30 年森林演替结算')
    expect(simulation.history.at(-1)?.averageHealth).toBeGreaterThanOrEqual(0.65)
    expect(simulation.history.at(-1)?.averageHealth).toBeLessThanOrEqual(0.85)

    simulation.continueAfterReport()
    simulation.speed = 16
    advanceTo(simulation, 40)
    expect(simulation.longTermUnlocked).toBe(true)
    expect(simulation.paused).toBe(false)
    expect(simulation.report).toBeNull()
    expect(simulation.createOutcomeReport().title).toBe('第 40 年森林演替结算')
  })

  it('exports all five datasets as a readable ZIP', async () => {
    const simulation = new ForestSimulation(SPECIES, playerCode, 'closed', 2026)
    simulation.individuals[0].health = 0
    simulation.individuals[0].deathCause = 'competition'
    for (let step = 0; step < 5; step += 1) simulation.update(0.1)
    const archive = unzipSync(new Uint8Array(await createExportArchive(simulation).arrayBuffer()))
    expect(Object.keys(archive).sort()).toEqual([
      'events.csv',
      'individual_snapshots.csv',
      'metadata.json',
      'report.json',
      'species_history.csv',
    ])
    const snapshots = strFromU8(archive['individual_snapshots.csv'])
    expect(snapshots).toContain('competition_pressure')
    expect(snapshots).toContain(',true,')
    expect(snapshots).toContain(',false,')
    expect(JSON.parse(strFromU8(archive['metadata.json'])).scenario).toBe('closed')
  })
})

describe('dominance-dependent pest pressure', () => {
  it('warns three years ahead and breaks a sustained oligopoly', () => {
    const simulation = new ForestSimulation(SPECIES, playerCode, 'sparse', 2026)
    for (const individual of simulation.individuals) {
      if (individual.species.code !== playerCode) {
        individual.health = 0
        individual.deathCause = 'competition'
      }
    }

    advanceTo(simulation, 5.1)
    expect(simulation.pestWarning?.speciesCode).toBe(playerCode)
    expect(simulation.pestWarning!.happensAt - simulation.pestWarning!.warningAt).toBe(3)

    advanceTo(simulation, 8.2)
    expect(simulation.pestWarning).toBeNull()
    expect(simulation.events.some((event) => event.category === 'pest' && event.message.includes('暴发'))).toBe(true)
    expect(simulation.deaths.filter((death) => death.cause === 'insect').length).toBeGreaterThan(0)
  })
})
