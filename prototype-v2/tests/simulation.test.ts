import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { createExportArchive } from '../src/export-data'
import { competitionFromLoad, sigmoid } from '../src/pressure'
import {
  ForestSimulation,
  gapReleaseMultiplier,
  selfThinningSizeMultiplier,
  type Individual,
  type ScenarioId,
} from '../src/simulation'
import { SPECIES } from '../src/species'

const playerCode = SPECIES[0].code

function makeSimulation(
  scenarioId: ScenarioId = 'closed',
  densityPer400m2 = 30,
  seed = 2026,
): ForestSimulation {
  return new ForestSimulation(SPECIES, playerCode, { scenarioId, densityPer400m2, seed })
}

function advanceOneStep(simulation: ForestSimulation): void {
  for (let tick = 0; tick < 5; tick += 1) simulation.update(0.1)
}

function advanceTo(simulation: ForestSimulation, targetYear: number): void {
  let guard = 0
  while (simulation.forestYear < targetYear && !simulation.paused && guard < 20_000) {
    simulation.update(0.1)
    guard += 1
  }
}

function earlyStageShare(individuals: Individual[]): number {
  return individuals.filter((individual) => individual.stage !== 'adult').length / individuals.length
}

function spatialChiSquare(individuals: Individual[], divisions = 5): number {
  const cells = Array.from({ length: divisions * divisions }, () => 0)
  for (const individual of individuals) {
    const column = Math.min(divisions - 1, Math.floor(individual.x * divisions))
    const row = Math.min(divisions - 1, Math.floor(individual.y * divisions))
    cells[row * divisions + column] += 1
  }
  const expected = individuals.length / cells.length
  return cells.reduce((sum, observed) => sum + ((observed - expected) ** 2) / expected, 0)
}

function nearestNeighborRatio(individuals: Individual[], sampleSize = 180): number {
  const sample = individuals.slice(0, Math.min(sampleSize, individuals.length))
  const meanNearest = sample.reduce((sum, individual) => {
    let nearest = Number.POSITIVE_INFINITY
    for (const other of individuals) {
      if (other.id === individual.id) continue
      nearest = Math.min(nearest, Math.hypot(individual.x - other.x, individual.y - other.y))
    }
    return sum + nearest
  }, 0) / sample.length
  return meanNearest / (0.5 / Math.sqrt(individuals.length))
}

function quadratMoranI(individuals: Individual[], divisions = 10): number {
  const counts = Array.from({ length: divisions * divisions }, () => 0)
  for (const individual of individuals) {
    const x = Math.min(divisions - 1, Math.floor(individual.x * divisions))
    const y = Math.min(divisions - 1, Math.floor(individual.y * divisions))
    counts[y * divisions + x] += 1
  }
  const mean = individuals.length / counts.length
  const denominator = counts.reduce((sum, count) => sum + (count - mean) ** 2, 0)
  let numerator = 0
  let weight = 0
  for (let y = 0; y < divisions; y += 1) {
    for (let x = 0; x < divisions; x += 1) {
      const value = counts[y * divisions + x] - mean
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nextX = x + dx
        const nextY = y + dy
        if (nextX < 0 || nextX >= divisions || nextY < 0 || nextY >= divisions) continue
        numerator += value * (counts[nextY * divisions + nextX] - mean)
        weight += 1
      }
    }
  }
  return (counts.length / weight) * (numerator / denominator)
}

describe('pressure mapping', () => {
  it('maps local load monotonically into a bounded sigmoid risk', () => {
    expect(sigmoid(-100)).toBeGreaterThanOrEqual(0)
    expect(sigmoid(100)).toBeLessThanOrEqual(1)
    expect(competitionFromLoad(1)).toBeLessThan(competitionFromLoad(3))
    expect(competitionFromLoad(3)).toBeLessThan(competitionFromLoad(7))
  })
})

describe('density-driven scenario generator', () => {
  it('keeps default scenario canopy structure within its advertised range', () => {
    for (const seed of [11, 101, 2026, 7788, 9911]) {
      const closed = makeSimulation('closed', 30, seed)
      const sparse = makeSimulation('sparse', 15, seed)
      expect(closed.initialCanopyCover).toBeGreaterThanOrEqual(0.95)
      expect(sparse.initialCanopyCover).toBeGreaterThanOrEqual(0.15)
      expect(sparse.initialCanopyCover).toBeLessThanOrEqual(0.32)
    }
  })

  it.each([
    [10, 250],
    [40, 1_000],
    [100, 2_500],
    [400, 10_000],
  ])('turns density %i per 400 m² into %i individuals', (density, total) => {
    const simulation = makeSimulation('closed', density)
    expect(simulation.densityPer400m2).toBe(density)
    expect(simulation.initialCommunitySize).toBe(total)
    expect(simulation.individuals).toHaveLength(total)
    expect(simulation.maxIndividuals).toBe(Math.max(20_000, Math.ceil(total * 1.5)))
  })

  it('adds exactly six non-adult player individuals to the colonization background', () => {
    const simulation = makeSimulation('colonization', 10)
    const playerPopulation = simulation.population(playerCode)
    expect(simulation.initialCommunitySize).toBe(256)
    expect(playerPopulation).toHaveLength(6)
    expect(playerPopulation.some((individual) => individual.stage === 'adult')).toBe(false)
  })

  it.each([10, 40, 100, 400])('samples density %i coordinates as conditional homogeneous Poisson points', (density) => {
    const simulation = makeSimulation('closed', density, 987654)
    expect(simulation.individuals.every(({ x, y }) => x >= 0 && x < 1 && y >= 0 && y < 1)).toBe(true)
    // With fixed N, a homogeneous Poisson process is equivalent to independent uniform x/y samples.
    expect(spatialChiSquare(simulation.individuals)).toBeLessThan(60)
    expect(nearestNeighborRatio(simulation.individuals)).toBeGreaterThan(0.72)
    expect(nearestNeighborRatio(simulation.individuals)).toBeLessThan(1.35)
    expect(Math.abs(quadratMoranI(simulation.individuals))).toBeLessThan(0.2)
    const uniqueCoordinates = new Set(simulation.individuals.map(({ x, y }) => `${x}:${y}`))
    expect(uniqueCoordinates.size).toBe(simulation.individuals.length)
  })

  it('shifts high-density forests toward smaller stems and earlier stages', () => {
    const densities = [10, 40, 100, 400]
    const simulations = densities.map((density) => makeSimulation('closed', density, 11))
    const averageDbh = simulations.map((simulation) => simulation.averageDbh())
    const earlyShares = simulations.map((simulation) => earlyStageShare(simulation.individuals))

    expect(averageDbh[0]).toBeGreaterThan(averageDbh[1])
    expect(averageDbh[1]).toBeGreaterThan(averageDbh[2])
    expect(averageDbh[2]).toBeGreaterThan(averageDbh[3])
    expect(earlyShares[0]).toBeLessThan(earlyShares[1])
    expect(earlyShares[1]).toBeLessThan(earlyShares[2])
    expect(earlyShares[2]).toBeLessThan(earlyShares[3])
  })

  it('self-thins a high-density stand while surviving stems gain diameter', () => {
    const simulation = makeSimulation('closed', 400, 1122)
    const initialTotal = simulation.individuals.length
    const initialDbh = simulation.averageDbh()
    advanceTo(simulation, 10)

    expect(simulation.forestYear).toBeGreaterThanOrEqual(10)
    expect(simulation.individuals.length).toBeLessThan(initialTotal)
    expect(simulation.averageDbh()).toBeGreaterThan(initialDbh)
    expect(simulation.deaths.some((death) => death.cause === 'competition')).toBe(true)
  }, 15_000)

  it('assigns stronger self-thinning pressure to smaller stems within a stage', () => {
    expect(selfThinningSizeMultiplier('seedling', 0.5)).toBeGreaterThan(selfThinningSizeMultiplier('seedling', 2))
    expect(selfThinningSizeMultiplier('sapling', 2)).toBeGreaterThan(selfThinningSizeMultiplier('sapling', 8))
    expect(selfThinningSizeMultiplier('adult', 10)).toBeLessThan(selfThinningSizeMultiplier('sapling', 2))
  })

  it('time-slices 16× evolution and exports the highest-density state without blocking', async () => {
    const simulation = makeSimulation('closed', 400, 9911)
    simulation.speed = 16
    const startedAt = performance.now()
    simulation.update(0.1)
    const updateElapsed = performance.now() - startedAt

    expect(simulation.forestYear).toBeCloseTo(2 / 12, 8)
    expect(updateElapsed).toBeLessThan(1_000)
    const archive = await createExportArchive(simulation)
    expect(archive.size).toBeGreaterThan(10_000)
  }, 15_000)
})

describe('successional strategy contrast', () => {
  it.each([101, 2026, 7788, 9911])('lets a pioneer population form multiple established patches within five years (seed %i)', (seed) => {
    const pioneer = SPECIES.find((species) => species.code === 'SASTZU')!
    const simulation = new ForestSimulation(SPECIES, pioneer.code, {
      scenarioId: 'colonization', densityPer400m2: 10, seed,
    })
    advanceTo(simulation, 5)
    const population = simulation.population(pioneer.code)
    const established = population.filter((individual) => individual.stage !== 'seed')
    const occupiedTenMeterCells = new Set(established.map(({ x, y }) => `${Math.floor(x * 10)}:${Math.floor(y * 10)}`))

    expect(population.length).toBeGreaterThan(20)
    expect(established.length).toBeGreaterThan(12)
    expect(occupiedTenMeterCells.size).toBeGreaterThan(8)
  })

  it('gives shade-tolerant juveniles low-light protection and a three-year release after canopy death', () => {
    const shadeSpecies = SPECIES.find((species) => species.strategy === 'shade' && species.maxHeight > 10)!
    const simulation = new ForestSimulation(SPECIES, shadeSpecies.code, {
      scenarioId: 'closed', densityPer400m2: 30, seed: 7788,
    })
    const shadeSapling = simulation.individuals
      .filter((individual) => individual.species.strategy === 'shade' && individual.stage === 'sapling')
      .sort((first, second) => simulation.lightAt(first.x, first.y) - simulation.lightAt(second.x, second.y))[0]
    const sunPeer = simulation.individuals.find((individual) => individual.species.strategy === 'sun' && individual.stage === 'sapling')!
    sunPeer.x = shadeSapling.x
    sunPeer.y = shadeSapling.y
    expect(simulation.lightHealthEffectAt(shadeSapling)).toBeGreaterThan(simulation.lightHealthEffectAt(sunPeer))

    const lightBeforeGap = simulation.lightAt(shadeSapling.x, shadeSapling.y)
    for (const individual of simulation.individuals.filter((candidate) => candidate.canopy)) {
      individual.health = 0
      individual.deathCause = 'typhoon'
    }
    advanceOneStep(simulation)
    const lightAfterGap = simulation.lightAt(shadeSapling.x, shadeSapling.y)
    expect(lightAfterGap - lightBeforeGap).toBeGreaterThanOrEqual(0.2)
    advanceOneStep(simulation)
    expect(shadeSapling.releaseUntil - simulation.forestYear).toBeGreaterThan(2.9)
    expect(gapReleaseMultiplier('shade', true)).toBe(2)
    expect(gapReleaseMultiplier('broad', true)).toBe(1.4)
    expect(gapReleaseMultiplier('sun', true)).toBe(1)
  })
})

describe('maturity and outcome rules', () => {
  it('uses the same five-metre-or-60-percent reproductive maturity rule for every species', () => {
    const simulation = makeSimulation('colonization', 10)
    for (const species of SPECIES) {
      expect(simulation.maturityHeight(species)).toBeCloseTo(Math.min(5, species.maxHeight * 0.6), 8)
    }

    const sapling = simulation.population(playerCode).find((individual) => individual.stage === 'sapling')!
    sapling.height = simulation.maturityHeight(sapling.species)
    advanceOneStep(simulation)
    expect(sapling.stage).toBe('adult')
    expect(sapling.height).toBeLessThanOrEqual(5.1)
  })

  it('pauses on player extinction and resumes in observation mode', () => {
    const simulation = makeSimulation('closed', 10)
    for (const individual of simulation.population(playerCode)) {
      individual.health = 0
      individual.deathCause = 'competition'
    }
    advanceOneStep(simulation)

    expect(simulation.report).toMatchObject({ kind: 'player-extinct', terminal: false, canContinue: true })
    expect(simulation.paused).toBe(true)
    simulation.continueAfterReport()
    expect(simulation.report).toBeNull()
    expect(simulation.paused).toBe(false)
    const year = simulation.forestYear
    advanceOneStep(simulation)
    expect(simulation.forestYear).toBeGreaterThan(year)
    expect(simulation.population(playerCode)).toHaveLength(0)
  })

  it('keeps total community extinction terminal', () => {
    const simulation = makeSimulation('sparse', 10)
    for (const individual of simulation.individuals) {
      individual.health = 0
      individual.deathCause = 'competition'
    }
    advanceOneStep(simulation)

    expect(simulation.report).toMatchObject({ kind: 'community-extinct', terminal: true, canContinue: false })
    simulation.continueAfterReport()
    expect(simulation.paused).toBe(true)
    expect(simulation.report?.kind).toBe('community-extinct')
  })
})

describe('community statistics and carbon sequestration', () => {
  it('keeps species, player and community statistics additive', () => {
    const simulation = makeSimulation('closed', 10)
    advanceOneStep(simulation)
    const speciesStatistics = simulation.activeSpecies.map((species) => simulation.speciesStatistics(species.code)!)
    const playerStatistics = simulation.playerStatistics()
    const communityStatistics = simulation.communityStatistics()

    expect(playerStatistics).toEqual(simulation.speciesStatistics(playerCode))
    expect(speciesStatistics.reduce((sum, statistics) => sum + statistics.total, 0)).toBe(communityStatistics.total)
    expect(communityStatistics.total).toBe(simulation.individuals.length)
    expect(Object.values(communityStatistics.stages).reduce((sum, count) => sum + count, 0)).toBe(communityStatistics.total)
    expect(speciesStatistics.reduce((sum, statistics) => sum + statistics.basalAreaM2, 0))
      .toBeCloseTo(communityStatistics.basalAreaM2, 10)
    expect(speciesStatistics.reduce((sum, statistics) => sum + statistics.grossCarbonIncome, 0))
      .toBeCloseTo(communityStatistics.grossCarbonIncome, 10)
    expect(speciesStatistics.reduce((sum, statistics) => sum + statistics.cumulativeCarbonSequestered, 0))
      .toBeCloseTo(communityStatistics.cumulativeCarbonSequestered, 10)
    for (const state of simulation.states.values()) {
      expect(state.cumulativeCarbonSequestered).toBeCloseTo(state.income, 10)
    }
  })

  it('records integer-year annual and cumulative carbon as exact species sums', () => {
    const simulation = makeSimulation('sparse', 10)
    advanceTo(simulation, 1)
    const firstYearSpecies = simulation.speciesHistory.filter((record) => record.time === 1)
    const firstYearCommunity = simulation.communityHistory.find((record) => record.time === 1)!

    expect(firstYearSpecies).toHaveLength(simulation.activeSpecies.length)
    expect(firstYearCommunity.total).toBe(firstYearSpecies.reduce((sum, record) => sum + record.total, 0))
    expect(firstYearCommunity.annualCarbonSequestered).toBeCloseTo(
      firstYearSpecies.reduce((sum, record) => sum + record.annualCarbonSequestered, 0),
      10,
    )
    expect(firstYearCommunity.cumulativeCarbonSequestered).toBeCloseTo(
      firstYearSpecies.reduce((sum, record) => sum + record.cumulativeCarbonSequestered, 0),
      10,
    )
    expect(firstYearCommunity.annualCarbonSequestered).toBeCloseTo(
      firstYearCommunity.cumulativeCarbonSequestered,
      10,
    )

    advanceTo(simulation, 2)
    const secondYearCommunity = simulation.communityHistory.find((record) => record.time === 2)!
    expect(secondYearCommunity.annualCarbonSequestered).toBeCloseTo(
      secondYearCommunity.cumulativeCarbonSequestered - firstYearCommunity.cumulativeCarbonSequestered,
      10,
    )
    expect(secondYearCommunity.cumulativeCarbonSequestered)
      .toBeGreaterThan(firstYearCommunity.cumulativeCarbonSequestered)
  })

  it('records additive annual demography by species and functional type', () => {
    const simulation = makeSimulation('sparse', 10)
    for (const individual of simulation.individuals.slice(0, 4)) {
      individual.health = 0
      individual.deathCause = 'competition'
    }
    advanceTo(simulation, 1)

    const report = simulation.annualCommunityReport(1)!
    expect(report.year).toBe(1)
    expect(report.species).toHaveLength(simulation.activeSpecies.length)
    expect(report.functionalTypes).toHaveLength(3)
    expect(simulation.annualCommunityReport(1.5)).toBeNull()
    expect(simulation.annualCommunityReport(99)).toBeNull()

    for (const sample of report.species) {
      const initial = simulation.speciesHistory.find((record) => (
        record.time === 0 && record.speciesCode === sample.speciesCode
      ))!
      expect(sample.startingPopulation).toBe(initial.total)
      expect(sample.births).toBe(sample.total - sample.startingPopulation + sample.deaths)
      expect(sample.birthsPer100).toBeCloseTo((sample.births / sample.startingPopulation) * 100, 10)
      expect(sample.deathsPer100).toBeCloseTo((sample.deaths / sample.startingPopulation) * 100, 10)
      expect(sample.seeds + sample.seedlings + sample.saplings + sample.adults).toBe(sample.total)
      expect(sample.basalAreaM2).toBeGreaterThanOrEqual(0)
      expect(sample.averageHeight).toBeGreaterThanOrEqual(0)
      expect(sample.averageDbh).toBeGreaterThanOrEqual(0)
    }

    for (const functionalType of report.functionalTypes) {
      const species = report.species.filter((sample) => sample.strategy === functionalType.strategy)
      expect(functionalType.total).toBe(species.reduce((sum, sample) => sum + sample.total, 0))
      expect(functionalType.births).toBe(species.reduce((sum, sample) => sum + sample.births, 0))
      expect(functionalType.deaths).toBe(species.reduce((sum, sample) => sum + sample.deaths, 0))
      expect(functionalType.basalAreaM2).toBeCloseTo(
        species.reduce((sum, sample) => sum + sample.basalAreaM2, 0),
        10,
      )
      expect(functionalType.annualCarbonSequestered).toBeCloseTo(
        species.reduce((sum, sample) => sum + sample.annualCarbonSequestered, 0),
        10,
      )
    }

    expect(report.community.total).toBe(report.species.reduce((sum, sample) => sum + sample.total, 0))
    expect(report.community.births).toBe(report.species.reduce((sum, sample) => sum + sample.births, 0))
    expect(report.community.deaths).toBe(report.species.reduce((sum, sample) => sum + sample.deaths, 0))
    expect(report.community.deaths).toBeGreaterThanOrEqual(4)
    expect(report.community.shannonDiversity).toBeGreaterThan(0)
    expect(report.community.simpsonDiversity).toBeGreaterThan(0)
    expect(report.community.evenness).toBeGreaterThan(0)
    expect(report.community.evenness).toBeLessThanOrEqual(1)
  })
})

describe('five-year summaries and event priority', () => {
  it('records one canopy and player-population summary every five years', () => {
    const simulation = makeSimulation('closed', 30, 2026)
    advanceTo(simulation, 10)

    expect(simulation.fiveYearSummaries.map((summary) => summary.time)).toEqual([5, 10])
    for (const summary of simulation.fiveYearSummaries) {
      const current = simulation.history.find((sample) => sample.time === summary.time)!
      const previous = simulation.history.find((sample) => sample.time === summary.time - 5)!
      const canopyAtYear = simulation.speciesHistory.filter((sample) => sample.time === summary.time)
      const dominant = canopyAtYear.sort((first, second) => second.canopy - first.canopy)[0]
      const totalCanopy = canopyAtYear.reduce((sum, sample) => sum + sample.canopy, 0)

      expect(summary.playerPopulation).toBe(current.total)
      expect(summary.playerPopulationChange).toBe(current.total - previous.total)
      expect(summary.dominantCanopyCount).toBe(dominant.canopy)
      expect(summary.dominantCanopyShare).toBeCloseTo(dominant.canopy / totalCanopy, 10)
    }
    expect(simulation.events.filter((event) => event.category === 'summary')).toHaveLength(2)
    expect(simulation.events.filter((event) => event.category === 'summary').every((event) => event.priority === 'routine')).toBe(true)
  })

  it('keeps ordinary deaths in death records without flooding the event stream', () => {
    const simulation = makeSimulation('sparse', 10, 7788)
    const eventsBefore = simulation.events.length
    const emergencyBefore = simulation.emergencyEvents.length
    const forcedIds = simulation.individuals.slice(0, 20).map((individual) => individual.id)
    for (const individual of simulation.individuals.slice(0, 20)) {
      individual.health = 0
      individual.deathCause = 'competition'
    }
    advanceOneStep(simulation)

    expect(simulation.deaths.length).toBeGreaterThanOrEqual(20)
    expect(forcedIds.every((id) => simulation.deaths.some((death) => death.individualId === id))).toBe(true)
    expect(simulation.events).toHaveLength(eventsBefore)
    expect(simulation.emergencyEvents).toHaveLength(emergencyBefore)
  })

  it('publishes extinction as one emergency event rather than one event per death', () => {
    const simulation = makeSimulation('closed', 10, 9911)
    const playerPopulation = simulation.population(playerCode)
    const eventsBefore = simulation.events.length
    for (const individual of playerPopulation) {
      individual.health = 0
      individual.deathCause = 'competition'
    }
    advanceOneStep(simulation)

    expect(simulation.deaths).toHaveLength(playerPopulation.length)
    expect(simulation.events).toHaveLength(eventsBefore + 1)
    expect(simulation.emergencyEvents).toHaveLength(1)
    expect(simulation.emergencyEvents[0]).toMatchObject({ priority: 'emergency', category: 'process' })
    expect(simulation.emergencyEvents[0].message).toContain('玩家物种已经灭绝')
  })
})

describe('forest-year checkpoint and export', () => {
  it('forces only the year-100 checkpoint and unlocks long-term speeds', () => {
    const simulation = makeSimulation('closed', 10)
    simulation.speed = 16
    simulation.forestYear = 99.76
    simulation.update(0.1)
    expect(simulation.paused).toBe(true)
    expect(simulation.report).toMatchObject({ kind: 'checkpoint', canContinue: true })
    expect(simulation.report?.title).toBe('第 100 年森林演替结算')

    simulation.continueAfterReport()
    simulation.speed = 16
    simulation.forestYear = 109.76
    simulation.update(0.1)
    expect(simulation.longTermUnlocked).toBe(true)
    expect(simulation.paused).toBe(false)
    expect(simulation.report).toBeNull()
    expect(simulation.createOutcomeReport().title).toBe('第 110 年森林演替结算')
  })

  it('exports datasets and spatial metadata as a readable ZIP', async () => {
    const simulation = makeSimulation('closed', 10)
    simulation.individuals[0].health = 0
    simulation.individuals[0].deathCause = 'competition'
    advanceOneStep(simulation)
    const archive = unzipSync(new Uint8Array(await createExportArchive(simulation).arrayBuffer()))
    expect(Object.keys(archive).sort()).toEqual([
      'community_history.csv',
      'events.csv',
      'functional_type_history.csv',
      'individual_snapshots.csv',
      'metadata.json',
      'report.json',
      'species_history.csv',
    ])
    const snapshots = strFromU8(archive['individual_snapshots.csv'])
    expect(snapshots).toContain('competition_pressure')
    expect(snapshots).toContain(',true,')
    expect(snapshots).toContain(',false,')
    const speciesHistory = strFromU8(archive['species_history.csv'])
    const communityHistory = strFromU8(archive['community_history.csv'])
    const functionalHistory = strFromU8(archive['functional_type_history.csv'])
    expect(speciesHistory).toContain('births_per_100')
    expect(speciesHistory).toContain('annual_carbon_sequestered')
    expect(speciesHistory).toContain('cumulative_carbon_sequestered')
    expect(communityHistory).toContain('species_richness')
    expect(communityHistory).toContain('gross_carbon_income')
    expect(communityHistory).toContain('shannon_diversity')
    expect(functionalHistory).toContain('deaths_per_100')

    const metadata = JSON.parse(strFromU8(archive['metadata.json']))
    expect(metadata).toMatchObject({
      schemaVersion: '4.1',
      scenario: 'closed',
      initialDensityPer400m2: 10,
      initialCommunitySize: 250,
      coordinateOrigin: 'lower-left',
      coordinateUnits: 'meters',
      mapMeters: { width: 100, height: 100 },
      carbonUnits: 'game-carbon-units',
    })
    expect(metadata.averageDbhCm).toBeGreaterThan(0)
    expect(metadata.basalAreaM2).toBeGreaterThan(0)
  })
})

describe('dominance-dependent pest pressure', () => {
  it('warns three years ahead and breaks a sustained oligopoly', () => {
    const simulation = makeSimulation('sparse', 10)
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
