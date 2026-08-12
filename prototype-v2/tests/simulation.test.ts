import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { createExportArchive } from '../src/export-data'
import { competitionFromLoad, sigmoid } from '../src/pressure'
import {
  ForestSimulation,
  OPPORTUNITY_CARDS,
  SCENARIOS,
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

function resolveOpportunity(simulation: ForestSimulation): void {
  const card = simulation.opportunityChoices[0]
  const result = card ? simulation.selectOpportunityCard(card) : simulation.passOpportunityCards()
  expect(result.ok).toBe(true)
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

describe('V4 species profiles and scenario missions', () => {
  it('loads a complete, differentiated and provenance-labelled profile for every roster species', () => {
    expect(SPECIES).toHaveLength(12)
    expect(new Set(SPECIES.map((species) => species.profile.archetype)).size).toBe(12)
    for (const species of SPECIES) {
      expect(species.profile.lightCompensation).toBeGreaterThan(0)
      expect(species.profile.lightSaturation).toBeGreaterThan(species.profile.lightCompensation)
      expect(species.profile.playStrength.length).toBeGreaterThan(4)
      expect(species.profile.tradeoff.length).toBeGreaterThan(4)
      expect(species.profile.provenance).toContain('游戏校准')
    }
  })

  it('publishes a measurable mission for every existing scenario', () => {
    for (const scenario of ['closed', 'sparse', 'colonization'] as ScenarioId[]) {
      const simulation = makeSimulation(scenario, 10, 2026)
      const mission = simulation.missionStatus()
      expect(mission.title.length).toBeGreaterThan(4)
      expect(mission.instruction).toContain(`第 ${mission.targetYear} 年`)
      expect(mission.progress).toBeGreaterThanOrEqual(0)
      expect(mission.progress).toBeLessThanOrEqual(1)
      expect(mission.progressLabel.length).toBeGreaterThan(4)
    }
  })

  it('keeps background herbivory visible before any outbreak', () => {
    const simulation = makeSimulation('sparse', 10, 7788)
    advanceOneStep(simulation)
    const established = simulation.individuals.filter((individual) => individual.stage !== 'seed')
    expect(established.some((individual) => individual.insectPressure > 0)).toBe(true)
    expect(established.every((individual) => individual.insectPressure <= 1)).toBe(true)
  })

  it.each([101, 2026, 7788])('keeps a shade-tolerant player able to invest under closed canopy (seed %i)', (seed) => {
    const shade = SPECIES.find((species) => species.code === 'MACLEP')!
    const simulation = new ForestSimulation(SPECIES, shade.code, {
      scenarioId: 'closed', densityPer400m2: 30, seed,
    })
    advanceOneStep(simulation)
    expect(simulation.playerState.surplus).toBeGreaterThan(0.05)
  })
})

describe('five-year strategy game loop', () => {
  it('locks a committed strategy and charges reserve only for warning-driven early replanning', () => {
    const simulation = makeSimulation('closed', 10, 2026)
    resolveOpportunity(simulation)
    const first = simulation.commitPlayerStrategy({ growth: 0.7, reproduction: 0.2, reserve: 0.1 })
    expect(first.ok).toBe(true)
    expect(simulation.strategyLockedUntil).toBeCloseTo(5, 8)
    expect(simulation.strategyCommitStatus()).toMatchObject({ available: false, early: false })
    simulation.processLedger.record({
      speciesCode: simulation.playerCode,
      year: simulation.forestYear,
      type: 'seed_created',
      amount: 2,
    })

    simulation.warning = {
      type: 'typhoon',
      x: 0.5,
      y: 0.5,
      radius: 0.2,
      happensAt: 1,
      intensity: 0.8,
      heading: 0,
    }
    const reserveBefore = simulation.playerState.reserve
    const early = simulation.commitPlayerStrategy({ growth: 0.2, reproduction: 0.2, reserve: 0.6 })
    expect(early).toMatchObject({ ok: true, cost: 6 })
    expect(simulation.playerState.reserve).toBeCloseTo(reserveBefore - 6, 8)
    expect(simulation.strategyReviews.at(-1)?.endedEarly).toBe(true)
    expect(simulation.strategyReviews.at(-1)?.processTotals.seed_created).toBe(2)
    expect(simulation.currentOpportunityRecord).toMatchObject({ cycle: 2, choices: [], passed: true })
    const interruptedTotals = simulation.strategyReviews.at(-1)!.processTotals
    simulation.processLedger.record({
      speciesCode: simulation.playerCode,
      year: simulation.forestYear,
      type: 'seed_created',
      amount: 3,
    })
    expect(interruptedTotals.seed_created).toBe(2)
  })

  it('publishes a causal review after each completed five-year commitment', () => {
    const simulation = makeSimulation('sparse', 10, 7788)
    resolveOpportunity(simulation)
    const cycleStartCursor = simulation.processLedger.cursor
    simulation.commitPlayerStrategy({ growth: 0.4, reproduction: 0.3, reserve: 0.3 }, 'resilience')
    advanceTo(simulation, 5.2)
    expect(simulation.strategyReview).toMatchObject({
      cycle: 1,
      endedEarly: false,
      startedAt: 0,
      plannedUntil: 5,
      prediction: { key: 'resilience' },
      predictionMet: expect.any(Boolean),
    })
    expect(simulation.strategyReview!.after.population).toBeGreaterThan(0)
    expect(simulation.strategyReview!.evidence).toHaveLength(6)
    expect(simulation.strategyReview!.evidence.join(' ')).toContain('主因判断')
    expect(simulation.strategyReview!.evidence.join(' ')).toContain('人口账')
    expect(simulation.strategyReview!.evidence.join(' ')).toContain('林窗账')
    expect(simulation.strategyReview!.evidence.join(' ')).toContain('机缘账')
    expect(simulation.strategyReview!.evidence.join(' ')).toContain('招募过程账')
    expect(simulation.strategyReview!.processTotals.reproduction_credit_added).toBeGreaterThan(0)
    expect(simulation.strategyReview!.processTotals.long_distance_seed)
      .toBeLessThanOrEqual(simulation.strategyReview!.processTotals.seed_created)
    expect(simulation.strategyReview!.processTotals.grid_colonized)
      .toBeLessThanOrEqual(simulation.strategyReview!.processTotals.seed_established)
    expect(simulation.strategyReview!.processTotals).toEqual(
      simulation.processLedger.totalsSince(cycleStartCursor, simulation.playerCode),
    )
    expect(simulation.strategyReviews).toHaveLength(1)
    expect(simulation.strategyCommitStatus().available).toBe(true)
  })

  it('labels carried-seed establishment as an independent period flow instead of a causal funnel', () => {
    const pioneer = SPECIES.find((species) => species.code === 'SASTZU')!
    const simulation = new ForestSimulation(SPECIES, pioneer.code, {
      scenarioId: 'colonization', densityPer400m2: 10, seed: 2,
    })
    expect(simulation.passOpportunityCards().ok).toBe(true)
    expect(simulation.commitPlayerStrategy({ growth: 0.5, reproduction: 0, reserve: 0.5 }).ok).toBe(true)

    advanceTo(simulation, 5.2)

    expect(simulation.strategyReview!.processTotals).toMatchObject({
      reproduction_credit_added: 0,
      seed_created: 0,
      seed_established: 1,
      grid_colonized: 1,
    })
    const processEvidence = simulation.strategyReview!.evidence.at(-1)!
    expect(processEvidence).toContain('本周期独立流量')
    expect(processEvidence).toContain('建立可来自期初或上周期种子')
    expect(processEvidence).not.toContain('→')
  })

  it('does not award the closed-forest objective merely for waiting', () => {
    const simulation = makeSimulation('closed', 30, 2026)
    const initialProgress = simulation.missionStatus().progress
    simulation.forestYear = 29
    expect(simulation.missionStatus().progress).toBe(initialProgress)
    expect(simulation.missionStatus().progress).toBeLessThanOrEqual(0.5)
    expect(simulation.missionStatus().progressLabel).toContain('完成释放')
  })

  it('integrates stored carbon by elapsed years instead of filling the reserve every monthly tick', () => {
    const shade = SPECIES.find((species) => species.strategy === 'shade' && species.maxHeight > 10)!
    const simulation = new ForestSimulation(SPECIES, shade.code, {
      scenarioId: 'closed', densityPer400m2: 30, seed: 2026,
    })
    resolveOpportunity(simulation)
    simulation.commitPlayerStrategy({ growth: 0.25, reproduction: 0.15, reserve: 0.6 }, 'resilience')
    advanceTo(simulation, 5)
    expect(simulation.playerState.reserve).toBeGreaterThan(28)
    expect(simulation.playerState.reserve).toBeLessThan(80)
    expect(18 / simulation.playerState.reserve).toBeGreaterThan(0.2)
  })

  it('stops at the scenario target year with a scored mission result', () => {
    const simulation = makeSimulation('sparse', 10, 2026)
    resolveOpportunity(simulation)
    simulation.commitPlayerStrategy({ growth: 0.7, reproduction: 0.2, reserve: 0.1 }, 'canopy')
    simulation.forestYear = SCENARIOS.sparse.targetYear - 0.04
    advanceOneStep(simulation)
    expect(simulation.paused).toBe(true)
    expect(simulation.report).toMatchObject({
      kind: 'mission',
      canContinue: true,
      mission: { score: expect.any(Number), grade: expect.any(String) },
    })
    expect(simulation.report?.title).toContain('情景结算')
    expect(simulation.report?.strategyImpacts.join(' ')).toContain('最终周期预测')
  })
})

describe('ecological opportunity cards', () => {
  it('draws a deterministic three-card choice from a seed-isolated random stream', () => {
    const first = makeSimulation('closed', 10, 4242)
    const second = makeSimulation('closed', 10, 4242)
    expect(first.opportunityChoices).toHaveLength(3)
    expect(new Set(first.opportunityChoices).size).toBe(3)
    expect(first.opportunityChoices).toEqual(second.opportunityChoices)
  })

  it('requires an explicit card choice or pass before strategy commitment', () => {
    const simulation = makeSimulation('closed', 10, 2026)
    const blocked = simulation.commitPlayerStrategy({ growth: 0.4, reproduction: 0.3, reserve: 0.3 })
    expect(blocked).toMatchObject({ ok: false })
    expect(blocked.message).toContain('生态机缘')

    expect(simulation.passOpportunityCards()).toMatchObject({ ok: true })
    expect(simulation.commitPlayerStrategy({ growth: 0.4, reproduction: 0.3, reserve: 0.3 })).toMatchObject({ ok: true })
  })

  it('spends reserve once when the held card is played and rejects a second use', () => {
    const simulation = makeSimulation('closed', 10, 7788)
    const cardId = simulation.opportunityChoices[0]
    expect(simulation.selectOpportunityCard(cardId)).toMatchObject({ ok: true })
    expect(simulation.commitPlayerStrategy({ growth: 0.4, reproduction: 0.3, reserve: 0.3 })).toMatchObject({ ok: true })
    const reserveBefore = simulation.playerState.reserve
    expect(simulation.activateOpportunityCard()).toMatchObject({ ok: true })
    expect(simulation.playerState.reserve).toBeCloseTo(reserveBefore - OPPORTUNITY_CARDS[cardId].cost, 8)
    expect(simulation.activateOpportunityCard()).toMatchObject({ ok: false })
    expect(simulation.currentOpportunityRecord).toMatchObject({ selected: cardId, used: true, expired: false })
  })

  it.each(Object.keys(OPPORTUNITY_CARDS) as Array<keyof typeof OPPORTUNITY_CARDS>)(
    'can draw and activate the %s mechanism card',
    (cardId) => {
      let simulation: ForestSimulation | null = null
      for (let seed = 1; seed <= 60; seed += 1) {
        const candidate = makeSimulation('closed', 10, seed)
        if (candidate.opportunityChoices.includes(cardId)) {
          simulation = candidate
          break
        }
      }
      expect(simulation, `${cardId} should appear within the deterministic seed sample`).not.toBeNull()
      expect(simulation!.selectOpportunityCard(cardId)).toMatchObject({ ok: true })
      expect(simulation!.commitPlayerStrategy({ growth: 0.4, reproduction: 0.3, reserve: 0.3 })).toMatchObject({ ok: true })
      const reserveBefore = simulation!.playerState.reserve
      expect(simulation!.activateOpportunityCard()).toMatchObject({ ok: true })
      expect(simulation!.playerState.reserve).toBeCloseTo(reserveBefore - OPPORTUNITY_CARDS[cardId].cost, 8)
      if (cardId === 'gap') expect(simulation!.playerState.gapBoostUntil).toBeCloseTo(5, 8)
      if (cardId === 'recovery') expect(simulation!.playerState.recoveryBoostUntil).toBeCloseTo(5, 8)
    },
  )

  it('expires a selected but unused card and writes it into the five-year review', () => {
    const simulation = makeSimulation('sparse', 10, 9911)
    const cardId = simulation.opportunityChoices[0]
    expect(simulation.selectOpportunityCard(cardId)).toMatchObject({ ok: true })
    expect(simulation.commitPlayerStrategy({ growth: 0.4, reproduction: 0.3, reserve: 0.3 })).toMatchObject({ ok: true })
    advanceTo(simulation, 5.2)

    expect(simulation.strategyReview?.opportunity).toMatchObject({
      selected: cardId,
      used: false,
      expired: true,
    })
    expect(simulation.strategyReview?.evidence.join(' ')).toContain('未使用')
    expect(simulation.opportunityChoices).toHaveLength(3)
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
    const processTotals = simulation.processLedger.totalsSince(0, pioneer.code)

    expect(population.length).toBeGreaterThan(12)
    expect(established.length).toBeGreaterThan(8)
    expect(occupiedTenMeterCells.size).toBeGreaterThan(6)
    expect(processTotals.reproduction_credit_added).toBeGreaterThan(0)
    expect(processTotals.seed_created).toBeGreaterThan(0)
    expect(processTotals.seed_established).toBeGreaterThan(0)
    expect(processTotals.grid_colonized).toBeGreaterThan(0)
    expect(processTotals.long_distance_seed).toBeLessThanOrEqual(processTotals.seed_created)
    expect(processTotals.grid_colonized).toBeLessThanOrEqual(processTotals.seed_established)
  })

  it('gives shade-tolerant juveniles low-light protection and a three-year release after canopy death', () => {
    const shadeSpecies = SPECIES.find((species) => species.strategy === 'shade' && species.maxHeight > 10)!
    const simulation = new ForestSimulation(SPECIES, shadeSpecies.code, {
      scenarioId: 'closed', densityPer400m2: 30, seed: 7788,
    })
    const shadeSapling = simulation.individuals
      .filter((individual) => individual.species.code === shadeSpecies.code && individual.stage === 'sapling')
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
    const firstReleaseCount = simulation.processLedger.total(shadeSpecies.code, 'gap_release')
    expect(firstReleaseCount).toBe(simulation.releasedPlayerCount)
    expect(firstReleaseCount).toBeGreaterThan(0)
    shadeSapling.previousLight = Math.max(0, simulation.lightAt(shadeSapling.x, shadeSapling.y) - 0.25)
    advanceOneStep(simulation)
    expect(simulation.processLedger.total(shadeSpecies.code, 'gap_release')).toBe(firstReleaseCount)
    expect(gapReleaseMultiplier('shade', true)).toBe(2)
    expect(gapReleaseMultiplier('broad', true)).toBe(1.4)
    expect(gapReleaseMultiplier('sun', true)).toBe(1)
  })

  it('does not count transplant-driven light gain as a natural gap release', () => {
    const shadeSpecies = SPECIES.find((species) => species.code === 'MACLEP')!
    const simulation = new ForestSimulation(SPECIES, shadeSpecies.code, {
      scenarioId: 'closed', densityPer400m2: 30, seed: 7788,
    })
    const juvenile = simulation.individuals
      .filter((individual) => simulation.canTransplant(individual) && individual.stage === 'sapling')
      .sort((first, second) => simulation.lightAt(first.x, first.y) - simulation.lightAt(second.x, second.y))[0]
    const destination = Array.from({ length: 19 * 19 }, (_, index) => ({
      x: 0.05 + (index % 19) * 0.05,
      y: 0.05 + Math.floor(index / 19) * 0.05,
    }))
      .filter(({ x, y }) => simulation.individuals.every((individual) => (
        Math.hypot((individual.x - x) * 100, (individual.y - y) * 100) >= 0.55
      )))
      .sort((first, second) => simulation.lightAt(second.x, second.y) - simulation.lightAt(first.x, first.y))[0]
    if (!juvenile || !destination) throw new Error('Expected a transplantable sapling and an open destination.')
    const oldLight = simulation.lightAt(juvenile.x, juvenile.y)
    expect(simulation.lightAt(destination.x, destination.y) - oldLight).toBeGreaterThanOrEqual(0.2)
    const releasesBefore = simulation.processLedger.total(shadeSpecies.code, 'gap_release')
    const colonizedBefore = simulation.processLedger.total(shadeSpecies.code, 'grid_colonized')

    expect(simulation.transplant(juvenile.id, destination.x, destination.y).ok).toBe(true)
    advanceOneStep(simulation)

    expect(juvenile.releaseUntil).toBeLessThanOrEqual(simulation.forestYear)
    expect(simulation.processLedger.total(shadeSpecies.code, 'gap_release')).toBe(releasesBefore)
    expect(simulation.processLedger.total(shadeSpecies.code, 'grid_colonized')).toBe(colonizedBefore)
  })

  it.each([101, 2026, 7788])('lets a shade-tolerant population keep a multi-stage bank under closed canopy (seed %i)', (seed) => {
    const shadeSpecies = SPECIES.find((species) => species.code === 'MACLEP')!
    const simulation = new ForestSimulation(SPECIES, shadeSpecies.code, {
      scenarioId: 'closed', densityPer400m2: 30, seed,
    })
    simulation.setAllocation({ growth: 0.34, reproduction: 0.33, reserve: 0.33 })
    advanceTo(simulation, 30)
    const population = simulation.population(shadeSpecies.code)
    expect(population.length).toBeGreaterThan(25)
    expect(new Set(population.map((individual) => individual.stage)).size).toBeGreaterThanOrEqual(2)
    expect(population.some((individual) => individual.stage === 'seedling' || individual.stage === 'sapling')).toBe(true)
  })
})

describe('structured disturbance outcomes', () => {
  it('turns a severe typhoon into persistent crown damage and a spatially limited death record', () => {
    const simulation = makeSimulation('sparse', 10, 2026)
    simulation.warning = {
      type: 'typhoon',
      x: 0.5,
      y: 0.5,
      radius: 0.45,
      happensAt: 0,
      intensity: 1,
      heading: 0,
    }
    advanceOneStep(simulation)
    const damaged = simulation.individuals.filter(
      (individual) => individual.structuralDamage > 0 || individual.defoliationUntil > simulation.forestYear,
    )
    const typhoonDeaths = simulation.deaths.filter((death) => death.cause === 'typhoon')
    const event = [...simulation.events].reverse().find((entry) => entry.category === 'disturbance')
    expect(damaged.length).toBeGreaterThan(0)
    expect(typhoonDeaths.length).toBeGreaterThan(0)
    expect(typhoonDeaths.length).toBeLessThan(simulation.initialCommunitySize)
    expect(event?.message).toContain('落叶')
    expect(event?.message).toContain('断枝')
    expect(event?.message).toContain('倒伏')
  })
})

describe('maturity and outcome rules', () => {
  it('uses species-specific reproductive maturity while keeping it within playable bounds', () => {
    const simulation = makeSimulation('colonization', 10)
    for (const species of SPECIES) {
      expect(simulation.maturityHeight(species)).toBeCloseTo(
        Math.max(0.8, Math.min(5, species.maxHeight * species.profile.maturityFraction)),
        8,
      )
    }
    expect(new Set(SPECIES.map((species) => simulation.maturityHeight(species).toFixed(2))).size).toBeGreaterThanOrEqual(5)

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
      expect(state.cumulativeCarbonSequestered).toBeCloseTo(state.income / 12, 10)
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

    expect(simulation.deaths.filter((death) => death.speciesCode === playerCode)).toHaveLength(playerPopulation.length)
    expect(simulation.events).toHaveLength(eventsBefore + 1)
    expect(simulation.emergencyEvents).toHaveLength(1)
    expect(simulation.emergencyEvents[0]).toMatchObject({ priority: 'emergency', category: 'process' })
    expect(simulation.emergencyEvents[0].message).toContain('玩家物种已经灭绝')
  })
})

describe('forest-year checkpoint and export', () => {
  it('runs the scenario ending before the optional year-100 sandbox checkpoint', () => {
    const simulation = makeSimulation('closed', 10)
    simulation.forestYear = SCENARIOS.closed.targetYear - 0.04
    advanceOneStep(simulation)
    expect(simulation.report).toMatchObject({ kind: 'mission', canContinue: true })
    simulation.continueAfterReport()

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
      'opportunity_history.csv',
      'report.json',
      'species_history.csv',
      'species_profiles.csv',
      'strategy_reviews.csv',
    ])
    const snapshots = strFromU8(archive['individual_snapshots.csv'])
    expect(snapshots).toContain('competition_pressure')
    expect(snapshots).toContain(',true,')
    expect(snapshots).toContain(',false,')
    const speciesHistory = strFromU8(archive['species_history.csv'])
    const communityHistory = strFromU8(archive['community_history.csv'])
    const functionalHistory = strFromU8(archive['functional_type_history.csv'])
    const speciesProfiles = strFromU8(archive['species_profiles.csv'])
    const strategyReviews = strFromU8(archive['strategy_reviews.csv'])
    const opportunityHistory = strFromU8(archive['opportunity_history.csv'])
    expect(speciesHistory).toContain('births_per_100')
    expect(speciesHistory).toContain('annual_carbon_sequestered')
    expect(speciesHistory).toContain('cumulative_carbon_sequestered')
    expect(communityHistory).toContain('species_richness')
    expect(communityHistory).toContain('gross_carbon_income')
    expect(communityHistory).toContain('shannon_diversity')
    expect(functionalHistory).toContain('deaths_per_100')
    expect(speciesProfiles).toContain('light_compensation')
    expect(speciesProfiles).toContain('provenance')
    expect(strategyReviews).toContain('prediction_met')
    expect(strategyReviews).toContain('opportunity_selected')
    expect(strategyReviews).toContain('causal_evidence')
    expect(opportunityHistory).toContain('choices')
    expect(opportunityHistory).toContain('expired')

    const metadata = JSON.parse(strFromU8(archive['metadata.json']))
    expect(metadata).toMatchObject({
      schemaVersion: '4.4',
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
    expect(metadata.mission.title).toBe('守住幼苗库，等到林窗释放')
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
