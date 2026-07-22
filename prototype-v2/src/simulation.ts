import type { Species, Strategy } from './species'
import { clamp01, competitionFromLoad } from './pressure'
import {
  calculateDemographicChange,
  calculateCommunityStatistics,
  calculateDiversityMetrics,
  calculateSpeciesStatistics,
  type CommunityStatistics,
  type SpeciesStatistics,
} from './community-stats'
export type { CommunityStatistics, SpeciesStatistics, StageCounts } from './community-stats'

export type Stage = 'seed' | 'seedling' | 'sapling' | 'adult'
export type AllocationKey = 'growth' | 'reproduction' | 'reserve'
export type ScenarioId = 'closed' | 'sparse' | 'colonization'
export type ViewLayer = 'all' | 'canopy' | 'understory'
export type ActiveAbility = 'defense' | 'mast' | 'disperse' | 'nursery'
export type DeathCause =
  | 'light'
  | 'competition'
  | 'pathogen'
  | 'insect'
  | 'typhoon'
  | 'rainstorm'
  | 'carbon'
  | 'senescence'
  | 'seed_failure'

export interface ScenarioDefinition {
  id: ScenarioId
  name: string
  description: string
  populationHint: string
  coverHint: string
  lightHint: string
  defaultDensity: number
}

export const SCENARIOS: Record<ScenarioId, ScenarioDefinition> = {
  closed: {
    id: 'closed',
    name: '密闭森林',
    description: '林冠投影覆盖率至少 95%，先在低光与拥挤中活下来。',
    populationHint: '默认约 750 个体',
    coverHint: '默认高林冠覆盖',
    lightHint: '自定义密度会改变林下光照',
    defaultDensity: 30,
  },
  sparse: {
    id: 'sparse',
    name: '稀疏森林',
    description: '林冠覆盖约 15–30%，高光机会多，扩张与竞争来得更快。',
    populationHint: '默认约 375 个体',
    coverHint: '默认低林冠覆盖',
    lightHint: '自定义密度会改变林下光照',
    defaultDensity: 15,
  },
  colonization: {
    id: 'colonization',
    name: '先锋定殖',
    description: '玩家仅有 6 个未成熟个体，在居民群落中建立下一代。',
    populationHint: '默认背景约 250 + 玩家 6 个体',
    coverHint: '无玩家成树',
    lightHint: '稀疏背景，平均光照偏高',
    defaultDensity: 10,
  },
}

export interface Allocation {
  growth: number
  reproduction: number
  reserve: number
}

export interface Individual {
  id: number
  species: Species
  x: number
  y: number
  stage: Stage
  ageYears: number
  height: number
  dbh: number
  health: number
  canopy: boolean
  transplanted: boolean
  pathogenPressure: number
  competitionPressure: number
  insectPressure: number
  riskScore: number
  deathCause: DeathCause | null
  previousLight: number
  releaseUntil: number
}

export interface SimulationOptions {
  scenarioId?: ScenarioId
  seed?: number
  densityPer400m2?: number
}

export interface TransplantResult {
  ok: boolean
  message: string
}

export interface AbilityResult {
  ok: boolean
  message: string
}

export interface AbilityStatus {
  available: boolean
  cost: number
  cooldownYears: number
  activeYears: number
}

export interface SpeciesState {
  species: Species
  allocation: Allocation
  reserve: number
  income: number
  maintenance: number
  surplus: number
  reproductionCredit: number
  defenseUntil: number
  defenseCooldownUntil: number
  mastCooldownUntil: number
  disperseUntil: number
  disperseCooldownUntil: number
  nurseryUntil: number
  nurseryCooldownUntil: number
  cumulativeCarbonSequestered: number
  carbonAtLastHistory: number
}

export type DisturbanceType = 'typhoon' | 'rainstorm'

export interface DisturbanceWarning {
  type: DisturbanceType
  x: number
  y: number
  radius: number
  happensAt: number
}

export interface PestWarning {
  speciesCode: string
  warningAt: number
  happensAt: number
}

export interface HistorySample {
  time: number
  total: number
  adults: number
  reserve: number
  income: number
  averageHeight: number
  averageHealth: number
  averageLight: number
  averagePathogenPressure: number
  averageCompetitionPressure: number
  averageRisk: number
  canopy: number
}

export interface SpeciesHistorySample {
  time: number
  speciesCode: string
  strategy: Strategy
  startingPopulation: number
  total: number
  births: number
  deaths: number
  birthsPer100: number
  deathsPer100: number
  seeds: number
  seedlings: number
  saplings: number
  adults: number
  canopy: number
  averageHeight: number
  averageDbh: number
  basalAreaM2: number
  reserve: number
  income: number
  averageHealth: number
  share: number
  annualCarbonSequestered: number
  cumulativeCarbonSequestered: number
}

export interface FunctionalTypeHistorySample {
  time: number
  strategy: Strategy
  startingPopulation: number
  total: number
  births: number
  deaths: number
  birthsPer100: number
  deathsPer100: number
  seeds: number
  seedlings: number
  saplings: number
  adults: number
  canopy: number
  speciesRichness: number
  basalAreaM2: number
  annualCarbonSequestered: number
  cumulativeCarbonSequestered: number
}

export interface CommunityHistorySample {
  time: number
  startingPopulation: number
  total: number
  births: number
  deaths: number
  birthsPer100: number
  deathsPer100: number
  seeds: number
  seedlings: number
  saplings: number
  adults: number
  canopy: number
  speciesRichness: number
  canopyCover: number
  grossCarbonIncome: number
  annualCarbonSequestered: number
  cumulativeCarbonSequestered: number
  averageHealth: number
  averageHeight: number
  averageDbh: number
  basalAreaM2: number
  shannonDiversity: number
  simpsonDiversity: number
  evenness: number
}

export interface AnnualCommunityReport {
  year: number
  community: CommunityHistorySample
  species: SpeciesHistorySample[]
  functionalTypes: FunctionalTypeHistorySample[]
}

export interface EventEntry {
  time: number
  message: string
  tone: 'neutral' | 'warning' | 'good' | 'bad'
  category: 'process' | 'disturbance' | 'ability' | 'pest' | 'strategy' | 'summary'
  priority: 'routine' | 'emergency'
}

export interface FiveYearSummary {
  time: number
  dominantCanopySpeciesCode: string | null
  dominantCanopySpeciesName: string | null
  dominantCanopyCount: number
  dominantCanopyShare: number
  playerPopulation: number
  playerPopulationChange: number
  playerPopulationChangePercent: number | null
}

export interface DeathRecord {
  individualId: number
  time: number
  x: number
  y: number
  speciesCode: string
  speciesName: string
  stage: Stage
  height: number
  dbh: number
  cause: DeathCause
}

export interface IndividualSnapshot {
  time: number
  individualId: number
  x: number
  y: number
  speciesCode: string
  speciesName: string
  strategy: Strategy
  stage: Stage
  alive: boolean
  height: number
  dbh: number
  health: number
  localLight: number
  competitionPressure: number
  pathogenPressure: number
  insectPressure: number
  carbonReserve: number
  deathCause: DeathCause | ''
}

export interface OutcomeReport {
  title: string
  outcome: string
  summary: string
  details: string[]
  drivers: string[]
  strategyImpacts: string[]
  futureRisks: string[]
  turningPoints: EventEntry[]
  terminal: boolean
  canContinue: boolean
  kind: 'checkpoint' | 'player-extinct' | 'community-extinct'
  year: number
}

const STAGES: Stage[] = ['seed', 'seedling', 'sapling', 'adult']
const FIXED_REAL_SECONDS = 0.5
const FIXED_STEP_YEARS = 1 / 12
const MAP_WIDTH_METERS = 100
const MAP_HEIGHT_METERS = 100
const GRID_WIDTH = 100
const GRID_HEIGHT = 100
const PRESSURE_RADIUS_METERS = 2
const FIRST_CHECKPOINT_YEAR = 100
export const CANOPY_HEIGHT_METERS = 10
export const RISK_THRESHOLD = 0.6
export const MIN_DENSITY_PER_400_M2 = 10
export const MAX_DENSITY_PER_400_M2 = 400
export const PLOTS_PER_MAP = 25

export function selfThinningSizeMultiplier(stage: Exclude<Stage, 'seed'>, dbh: number): number {
  const stageWeight = { seedling: 1, sapling: 0.6, adult: 0.18 }[stage]
  const referenceDbh = { seedling: 2, sapling: 8, adult: 20 }[stage]
  const smallStemPenalty = Math.max(0, Math.min(1, 1 - dbh / referenceDbh))
  return stageWeight * (0.55 + smallStemPenalty * 0.9)
}

export function gapReleaseMultiplier(strategy: Strategy, active: boolean): number {
  if (!active) return 1
  if (strategy === 'shade') return 2
  if (strategy === 'broad') return 1.4
  return 1
}

class SeededRandom {
  private value: number

  constructor(seed: number) {
    this.value = seed || 1
  }

  next(): number {
    this.value ^= this.value << 13
    this.value ^= this.value >>> 17
    this.value ^= this.value << 5
    return (this.value >>> 0) / 4294967296
  }

  between(min: number, max: number): number {
    return min + (max - min) * this.next()
  }

  pick<T>(items: T[]): T {
    return items[Math.floor(this.next() * items.length)]
  }
}

export class ForestSimulation {
  readonly width = GRID_WIDTH
  readonly height = GRID_HEIGHT
  readonly mapWidthMeters = MAP_WIDTH_METERS
  readonly mapHeightMeters = MAP_HEIGHT_METERS
  readonly playerCode: string
  readonly scenarioId: ScenarioId
  readonly activeSpecies: Species[]
  readonly states = new Map<string, SpeciesState>()
  readonly history: HistorySample[] = []
  readonly speciesHistory: SpeciesHistorySample[] = []
  readonly functionalTypeHistory: FunctionalTypeHistorySample[] = []
  readonly communityHistory: CommunityHistorySample[] = []
  readonly events: EventEntry[] = []
  readonly emergencyEvents: EventEntry[] = []
  readonly fiveYearSummaries: FiveYearSummary[] = []
  readonly deaths: DeathRecord[] = []
  readonly individualSnapshots: IndividualSnapshot[] = []
  readonly seed: number
  readonly densityPer400m2: number
  readonly initialCommunitySize: number
  readonly maxIndividuals: number

  individuals: Individual[] = []
  lightGrid = new Float32Array(GRID_WIDTH * GRID_HEIGHT)
  warning: DisturbanceWarning | null = null
  pestWarning: PestWarning | null = null
  report: OutcomeReport | null = null
  forestYear = 0
  speed = 1
  paused = false
  revision = 0
  lightRevision = 0
  longTermUnlocked = false
  initialCanopyCover = 0

  private readonly random: SeededRandom
  private nextId = 1
  private accumulator = 0
  private nextHistoryYear = 1
  private nextSnapshotYear = 2
  private firstCheckpointShown = false
  private nextDisturbanceAt: number
  private warningIssued = false
  private pestCooldownUntil = 0
  private readonly dominanceYears = new Map<string, number>()
  private lastPestOutbreakYear = -Infinity
  private playerExtinctionShown = false
  private communityExtinctionShown = false
  private canopyCoverValue = 0

  constructor(
    allSpecies: Species[],
    playerCode: string,
    optionsOrScenario: SimulationOptions | ScenarioId | number = {},
    suppliedSeed = Date.now() & 0xffffffff,
  ) {
    const options: SimulationOptions = typeof optionsOrScenario === 'object'
      ? optionsOrScenario
      : typeof optionsOrScenario === 'number'
        ? { scenarioId: 'closed', seed: optionsOrScenario }
        : { scenarioId: optionsOrScenario, seed: suppliedSeed }
    this.scenarioId = options.scenarioId ?? 'closed'
    this.seed = options.seed ?? suppliedSeed
    this.densityPer400m2 = Math.round(Math.max(
      MIN_DENSITY_PER_400_M2,
      Math.min(MAX_DENSITY_PER_400_M2, options.densityPer400m2 ?? SCENARIOS[this.scenarioId].defaultDensity),
    ))
    this.random = new SeededRandom(this.seed)
    this.playerCode = playerCode
    this.activeSpecies = this.chooseSpecies(allSpecies, playerCode)
    this.nextDisturbanceAt = this.random.between(6, 9)

    for (const species of this.activeSpecies) {
      this.states.set(species.code, {
        species,
        allocation: this.defaultAllocation(species.strategy),
        reserve: species.code === playerCode ? 28 : this.random.between(20, 34),
        income: 0,
        maintenance: 0,
        surplus: 0,
        reproductionCredit: this.random.between(0, 3),
        defenseUntil: 0,
        defenseCooldownUntil: 0,
        mastCooldownUntil: 0,
        disperseUntil: 0,
        disperseCooldownUntil: 0,
        nurseryUntil: 0,
        nurseryCooldownUntil: 0,
        cumulativeCarbonSequestered: 0,
        carbonAtLastHistory: 0,
      })
      this.dominanceYears.set(species.code, 0)
    }

    this.seedScenario()
    this.initialCommunitySize = this.individuals.length
    this.maxIndividuals = Math.max(20_000, Math.ceil(this.initialCommunitySize * 1.5))
    this.recalculateCanopyAndLight()
    for (const individual of this.individuals) individual.previousLight = this.lightAt(individual.x, individual.y)
    this.initialCanopyCover = this.canopyCover()
    this.addEvent(
      `${SCENARIOS[this.scenarioId].name}开始演替：${this.individuals.length} 个体，林冠覆盖 ${Math.round(this.initialCanopyCover * 100)}%。`,
      'neutral',
      'process',
    )
    this.recordAllIndividuals()
    this.sampleHistory(0)
  }

  get playerSpecies(): Species {
    return this.states.get(this.playerCode)!.species
  }

  get playerState(): Readonly<SpeciesState> {
    return this.states.get(this.playerCode)!
  }

  playerStatistics(): SpeciesStatistics {
    return this.speciesStatistics(this.playerCode)!
  }

  speciesStatistics(speciesCode: string): SpeciesStatistics | null {
    return calculateSpeciesStatistics(this, speciesCode)
  }

  communityStatistics(): CommunityStatistics {
    return calculateCommunityStatistics(this)
  }

  annualCommunityReport(year: number): AnnualCommunityReport | null {
    if (!Number.isInteger(year) || year < 0) return null
    const community = this.communityHistory.find((sample) => sample.time === year)
    if (!community) return null
    return {
      year,
      community,
      species: this.speciesHistory.filter((sample) => sample.time === year),
      functionalTypes: this.functionalTypeHistory.filter((sample) => sample.time === year),
    }
  }

  get allocation(): Allocation {
    return { ...this.states.get(this.playerCode)!.allocation }
  }

  setAllocation(allocation: Allocation): void {
    if (this.population(this.playerCode).length === 0) return
    const total = allocation.growth + allocation.reproduction + allocation.reserve
    if (total <= 0) return
    this.states.get(this.playerCode)!.allocation = {
      growth: allocation.growth / total,
      reproduction: allocation.reproduction / total,
      reserve: allocation.reserve / total,
    }
    this.addEvent(
      `重新平衡：生长 ${Math.round((allocation.growth / total) * 100)}% · 繁殖 ${Math.round((allocation.reproduction / total) * 100)}% · 储备 ${Math.round((allocation.reserve / total) * 100)}%`,
      'neutral',
      'strategy',
    )
  }

  update(realDeltaSeconds: number): void {
    if (this.paused || this.report?.terminal) return
    const maxStepsPerFrame = this.individuals.length >= 5_000 ? 2 : 6
    this.accumulator = Math.min(
      this.accumulator + Math.min(realDeltaSeconds, 0.1) * this.speed,
      FIXED_REAL_SECONDS * (maxStepsPerFrame + 1),
    )
    let steps = 0
    while (this.accumulator >= FIXED_REAL_SECONDS && steps < maxStepsPerFrame) {
      this.step()
      this.accumulator -= FIXED_REAL_SECONDS
      steps += 1
      if (this.paused) break
    }
  }

  lightAt(x: number, y: number): number {
    const gx = Math.max(0, Math.min(GRID_WIDTH - 1, Math.floor(x * GRID_WIDTH)))
    const gy = Math.max(0, Math.min(GRID_HEIGHT - 1, Math.floor(y * GRID_HEIGHT)))
    return this.lightGrid[gy * GRID_WIDTH + gx]
  }

  canopyCover(): number {
    return this.canopyCoverValue
  }

  population(code: string): Individual[] {
    return this.individuals.filter((individual) => individual.species.code === code)
  }

  averageDbh(individuals: Individual[] = this.individuals): number {
    const stems = individuals.filter((individual) => individual.stage !== 'seed')
    return stems.length > 0 ? stems.reduce((sum, individual) => sum + individual.dbh, 0) / stems.length : 0
  }

  basalArea(individuals: Individual[] = this.individuals): number {
    return individuals.reduce((sum, individual) => sum + Math.PI * (individual.dbh / 200) ** 2, 0)
  }

  densityPerCurrent400m2(): number {
    return this.individuals.length / PLOTS_PER_MAP
  }

  findIndividual(id: number): Individual | undefined {
    return this.individuals.find((individual) => individual.id === id)
  }

  canTransplant(individual: Individual): boolean {
    return (
      individual.species.code === this.playerCode &&
      (individual.stage === 'seedling' || individual.stage === 'sapling') &&
      !individual.transplanted
    )
  }

  transplant(id: number, x: number, y: number): TransplantResult {
    const individual = this.findIndividual(id)
    if (!individual || !this.canTransplant(individual)) {
      const result = { ok: false, message: '只能移栽自己的幼苗或幼树，且每株只能移动一次。' }
      this.addEvent(result.message, 'warning', 'ability')
      return result
    }
    const nextX = clamp01(x)
    const nextY = clamp01(y)
    const occupied = this.individuals.some(
      (other) =>
        other.id !== id &&
        Math.hypot((other.x - nextX) * MAP_WIDTH_METERS, (other.y - nextY) * MAP_HEIGHT_METERS) < 0.55,
    )
    if (occupied) {
      const result = { ok: false, message: '落点过于拥挤，请选择更空旷的位置。' }
      this.addEvent(result.message, 'warning', 'ability')
      return result
    }
    const oldLight = this.lightAt(individual.x, individual.y)
    individual.x = Math.max(0.01, Math.min(0.99, nextX))
    individual.y = Math.max(0.01, Math.min(0.99, nextY))
    individual.transplanted = true
    individual.health = Math.max(0.3, individual.health - 0.04)
    const newLight = this.lightAt(individual.x, individual.y)
    const message = `移栽 ${individual.species.name}：光照 ${Math.round(oldLight * 100)}% → ${Math.round(newLight * 100)}%，健康付出 4%。`
    this.addEvent(message, newLight >= oldLight ? 'good' : 'neutral', 'ability')
    this.recordIndividual(individual, true)
    this.revision += 1
    return { ok: true, message }
  }

  abilityStatus(ability: ActiveAbility): AbilityStatus {
    const state = this.states.get(this.playerCode)!
    if (this.population(this.playerCode).length === 0) {
      return { available: false, cost: 0, cooldownYears: 0, activeYears: 0 }
    }
    if (ability === 'defense') {
      return {
        available: state.reserve >= 18 && this.forestYear >= state.defenseCooldownUntil,
        cost: 18,
        cooldownYears: Math.max(0, state.defenseCooldownUntil - this.forestYear),
        activeYears: Math.max(0, state.defenseUntil - this.forestYear),
      }
    }
    if (ability === 'mast') {
      return {
        available:
          state.reserve >= 15 &&
          this.forestYear >= state.mastCooldownUntil &&
          this.population(this.playerCode).some((individual) => individual.stage === 'adult'),
        cost: 15,
        cooldownYears: Math.max(0, state.mastCooldownUntil - this.forestYear),
        activeYears: 0,
      }
    }
    if (ability === 'disperse') {
      return {
        available: state.reserve >= 12 && this.forestYear >= state.disperseCooldownUntil,
        cost: 12,
        cooldownYears: Math.max(0, state.disperseCooldownUntil - this.forestYear),
        activeYears: Math.max(0, state.disperseUntil - this.forestYear),
      }
    }
    return {
      available: state.reserve >= 15 && this.forestYear >= state.nurseryCooldownUntil,
      cost: 15,
      cooldownYears: Math.max(0, state.nurseryCooldownUntil - this.forestYear),
      activeYears: Math.max(0, state.nurseryUntil - this.forestYear),
    }
  }

  activateAbility(ability: ActiveAbility): AbilityResult {
    const state = this.states.get(this.playerCode)!
    const status = this.abilityStatus(ability)
    if (!status.available) {
      const message = status.cooldownYears > 0 ? `能力仍需冷却 ${status.cooldownYears.toFixed(1)} 年。` : '碳储备或成树数量不足。'
      this.addEvent(message, 'warning', 'ability')
      return { ok: false, message }
    }
    if (ability === 'defense') {
      state.reserve -= 18
      state.defenseUntil = this.forestYear + 5
      state.defenseCooldownUntil = this.forestYear + 10
      const message = '诱导防御启动：未来 5 年病原菌和虫害伤害减半。'
      this.addEvent(message, 'good', 'ability')
      return { ok: true, message }
    }
    if (ability === 'disperse') {
      state.reserve -= 12
      state.disperseUntil = this.forestYear + 3
      state.disperseCooldownUntil = this.forestYear + 8
      const message = '远距播散启动：未来 3 年长距离种子比例提高。'
      this.addEvent(message, 'good', 'ability')
      return { ok: true, message }
    }
    if (ability === 'nursery') {
      state.reserve -= 15
      state.nurseryUntil = this.forestYear + 3
      state.nurseryCooldownUntil = this.forestYear + 8
      const message = '幼苗保育启动：未来 3 年建立率提高、幼苗损伤降低。'
      this.addEvent(message, 'good', 'ability')
      return { ok: true, message }
    }
    state.reserve -= 15
    state.mastCooldownUntil = this.forestYear + 8
    const adults = this.population(this.playerCode).filter((individual) => individual.stage === 'adult')
    const seedCount = Math.min(40, adults.length * 3, this.maxIndividuals - this.individuals.length)
    for (let count = 0; count < seedCount; count += 1) this.createSeed(state.species, this.random.pick(adults))
    const message = `集中结实：消耗 15 储备，释放 ${seedCount} 粒种子。`
    this.addEvent(message, 'good', 'ability')
    this.revision += 1
    return { ok: true, message }
  }

  continueAfterReport(): void {
    if (this.report?.kind === 'community-extinct') return
    this.report = null
    this.paused = false
    if (this.population(this.playerCode).length === 0) {
      this.longTermUnlocked = true
      this.addEvent('玩家物种已经灭绝，继续以观察模式观看其余群落演替。', 'neutral', 'process')
    } else if (!this.longTermUnlocked) {
      this.longTermUnlocked = true
      this.addEvent('进入长期演替期：已解锁 8× 与 16×，后续结算由玩家主动查看。', 'good', 'process')
    }
  }

  stageLabel(stage: Stage): string {
    return { seed: '种子', seedling: '幼苗', sapling: '幼树', adult: '成树' }[stage]
  }

  deathCauseLabel(cause: DeathCause): string {
    return {
      light: '光照胁迫',
      competition: '竞争压力',
      pathogen: '同种病原菌',
      insect: '专性虫害',
      typhoon: '台风倒伏',
      rainstorm: '暴雨损伤',
      carbon: '碳短缺',
      senescence: '衰老',
      seed_failure: '种子建立失败',
    }[cause]
  }

  createOutcomeReport(): OutcomeReport {
    if (this.individuals.length === 0) return this.buildOutcomeReport('community-extinct')
    if (this.population(this.playerCode).length === 0) return this.buildOutcomeReport('player-extinct')
    return this.buildOutcomeReport('checkpoint')
  }

  lightHealthEffectAt(individual: Individual): number {
    return this.lightHealthEffect(individual.species.strategy, this.lightAt(individual.x, individual.y))
  }

  private chooseSpecies(allSpecies: Species[], playerCode: string): Species[] {
    const player = allSpecies.find((species) => species.code === playerCode) ?? allSpecies[0]
    const selected = [player]
    const strategies: Strategy[] = ['sun', 'shade', 'broad']
    for (const strategy of strategies) {
      if (selected.some((species) => species.strategy === strategy)) continue
      const candidates = allSpecies.filter(
        (species) => species.strategy === strategy && species.maxHeight > CANOPY_HEIGHT_METERS && !selected.includes(species),
      )
      selected.push(this.random.pick(candidates))
    }
    while (selected.filter((species) => species.maxHeight > CANOPY_HEIGHT_METERS).length < 4) {
      const candidates = allSpecies.filter(
        (species) => species.maxHeight > CANOPY_HEIGHT_METERS && !selected.includes(species),
      )
      selected.push(this.random.pick(candidates))
    }
    while (selected.length < 6) {
      const candidates = allSpecies.filter((species) => !selected.includes(species))
      selected.push(this.random.pick(candidates))
    }
    return selected.slice(0, 6)
  }

  private defaultAllocation(strategy: Strategy): Allocation {
    if (strategy === 'sun') return { growth: 0.52, reproduction: 0.34, reserve: 0.14 }
    if (strategy === 'shade') return { growth: 0.25, reproduction: 0.22, reserve: 0.53 }
    return { growth: 0.38, reproduction: 0.3, reserve: 0.32 }
  }

  private seedScenario(): void {
    const backgroundCount = this.densityPer400m2 * PLOTS_PER_MAP
    if (this.scenarioId === 'colonization') {
      const player = this.playerSpecies
      this.individuals.push(this.makeIndividual(player, 'sapling', undefined, undefined, this.maturityHeight(player) * 0.9))
      for (let count = 0; count < 3; count += 1) this.individuals.push(this.makeIndividual(player, 'seedling'))
      for (let count = 0; count < 2; count += 1) this.individuals.push(this.makeIndividual(player, 'seed'))
      this.seedPopulation(this.activeSpecies.filter((species) => species.code !== this.playerCode), backgroundCount, 'colonization')
      return
    }
    this.seedPopulation(this.activeSpecies, backgroundCount, this.scenarioId)
  }

  private seedPopulation(speciesPool: Species[], total: number, scenario: ScenarioId): void {
    const defaultDensity = SCENARIOS[scenario].defaultDensity
    const defaultAdultShare = scenario === 'closed' ? 0.52 : scenario === 'sparse' ? 0.08 : 0.06
    const defaultTotal = defaultDensity * PLOTS_PER_MAP
    const adults = Math.min(
      Math.floor(total * 0.65),
      Math.max(1, Math.round(defaultTotal * defaultAdultShare * Math.sqrt(this.densityPer400m2 / defaultDensity))),
    )
    const remaining = total - adults
    const saplingShare = scenario === 'closed' ? 0.26 : 0.24
    const seedlingShare = scenario === 'closed' ? 0.5 : 0.52
    const saplings = Math.round(remaining * saplingShare)
    const seedlings = Math.round(remaining * seedlingShare)
    const seeds = remaining - saplings - seedlings
    this.seedStage(speciesPool, 'adult', adults, scenario)
    this.seedStage(speciesPool, 'sapling', saplings, scenario)
    this.seedStage(speciesPool, 'seedling', seedlings, scenario)
    this.seedStage(speciesPool, 'seed', seeds, scenario)
  }

  private seedStage(speciesPool: Species[], stage: Stage, count: number, scenario: ScenarioId): void {
    const offset = Math.floor(this.random.next() * speciesPool.length)
    for (let index = 0; index < count; index += 1) {
      const species = speciesPool[(index + offset) % speciesPool.length]
      let forcedHeight: number | undefined
      if (stage === 'adult') {
        const maturity = this.maturityHeight(species)
        if (scenario === 'closed' && species.maxHeight > CANOPY_HEIGHT_METERS) {
          forcedHeight = this.random.between(10.2, Math.max(10.25, Math.min(16, species.maxHeight * 0.94)))
        } else if (
          species.maxHeight > CANOPY_HEIGHT_METERS &&
          this.random.next() < (scenario === 'sparse' ? 0.9 : 0.4)
        ) {
          forcedHeight = this.random.between(10.1, Math.max(10.15, Math.min(13, species.maxHeight * 0.82)))
        } else {
          forcedHeight = this.random.between(maturity, Math.max(maturity + 0.05, Math.min(9.5, species.maxHeight * 0.9)))
        }
      }
      this.individuals.push(this.makeIndividual(species, stage, undefined, undefined, forcedHeight))
    }
  }

  private makeIndividual(
    species: Species,
    stage: Stage,
    x?: number,
    y?: number,
    forcedHeight?: number,
  ): Individual {
    const stageIndex = STAGES.indexOf(stage)
    const saplingThreshold = Math.min(1, species.maxHeight * 0.1)
    const maturityThreshold = this.maturityHeight(species)
    const heightRanges: Record<Stage, [number, number]> = {
      seed: [0.01, 0.02],
      seedling: [0.08, Math.max(0.09, saplingThreshold * 0.96)],
      sapling: [saplingThreshold, Math.max(saplingThreshold + 0.05, maturityThreshold * 0.96)],
      adult: [maturityThreshold, Math.max(maturityThreshold + 0.05, species.maxHeight * 0.92)],
    }
    const ageRanges: Record<Stage, [number, number]> = {
      seed: [0, 2], seedling: [0.5, 4], sapling: [3, 12], adult: [12, 75],
    }
    const [minHeight, maxHeight] = heightRanges[stage]
    const [minAge, maxAge] = ageRanges[stage]
    const height = forcedHeight ?? this.random.between(minHeight, Math.max(minHeight + 0.01, maxHeight))
    const healthFloor = this.scenarioId === 'closed' ? 0.65 : 0.7
    return {
      id: this.nextId++,
      species,
      x: x ?? this.random.next(),
      y: y ?? this.random.next(),
      stage,
      ageYears: this.random.between(minAge, maxAge),
      height,
      dbh: stageIndex === 0
        ? 0
        : Math.max(0.2, height * this.random.between(1.25, 2.05) * this.initialDbhScale()),
      health: this.random.between(healthFloor, 0.95),
      canopy: false,
      transplanted: false,
      pathogenPressure: 0,
      competitionPressure: 0,
      insectPressure: 0,
      riskScore: 0,
      deathCause: null,
      previousLight: 0.7,
      releaseUntil: 0,
    }
  }

  maturityHeight(species: Species): number {
    return Math.min(5, species.maxHeight * 0.6)
  }

  private initialDbhScale(): number {
    return Math.max(0.32, Math.min(1.5, Math.sqrt(40 / this.densityPer400m2)))
  }

  private step(): void {
    this.forestYear += FIXED_STEP_YEARS
    this.updateWarningAndDisturbance()
    this.collectDead()
    this.updatePestPressure()
    this.updateAiAllocations()
    for (const state of this.states.values()) this.applyBudgetAndGrowth(state)
    this.applyEstablishmentAndMortality()
    this.collectDead()
    this.recalculateCanopyAndLight()
    this.revision += 1

    while (this.forestYear + 1e-6 >= this.nextHistoryYear) {
      this.sampleHistory(this.nextHistoryYear)
      if (this.nextHistoryYear % 5 === 0) this.recordFiveYearSummary(this.nextHistoryYear)
      this.updateDominanceAndPest(this.nextHistoryYear)
      this.nextHistoryYear += 1
    }
    while (this.forestYear + 1e-6 >= this.nextSnapshotYear) {
      this.recordAllIndividuals(this.nextSnapshotYear)
      this.nextSnapshotYear += 2
    }
    if (this.individuals.length === 0 && !this.communityExtinctionShown) {
      this.communityExtinctionShown = true
      this.addEvent('整个群落已经灭绝，演替无法继续。', 'bad', 'process', 'emergency')
      this.paused = true
      this.report = this.buildOutcomeReport('community-extinct')
      return
    }
    if (this.population(this.playerCode).length === 0 && !this.playerExtinctionShown) {
      this.playerExtinctionShown = true
      this.addEvent('玩家物种已经灭绝，可以继续观察其余群落演替。', 'bad', 'process', 'emergency')
      this.paused = true
      this.report = this.buildOutcomeReport('player-extinct')
      return
    }
    if (!this.firstCheckpointShown && this.forestYear >= FIRST_CHECKPOINT_YEAR) {
      this.firstCheckpointShown = true
      this.paused = true
      this.report = this.buildOutcomeReport('checkpoint')
    }
  }

  private updateAiAllocations(): void {
    for (const state of this.states.values()) {
      if (state.species.code === this.playerCode) continue
      const population = this.population(state.species.code)
      const averageLight = this.average(population.map((individual) => this.lightAt(individual.x, individual.y)))
      if (this.warning || this.pestWarning?.speciesCode === state.species.code) {
        state.allocation = { growth: 0.18, reproduction: 0.14, reserve: 0.68 }
      } else if (state.species.strategy === 'sun') {
        state.allocation = averageLight > 0.52
          ? { growth: 0.56, reproduction: 0.34, reserve: 0.1 }
          : { growth: 0.24, reproduction: 0.18, reserve: 0.58 }
      } else if (state.species.strategy === 'shade') {
        state.allocation = averageLight < 0.38
          ? { growth: 0.22, reproduction: 0.2, reserve: 0.58 }
          : { growth: 0.34, reproduction: 0.27, reserve: 0.39 }
      } else state.allocation = { growth: 0.38, reproduction: 0.3, reserve: 0.32 }
    }
  }

  private applyBudgetAndGrowth(state: SpeciesState): void {
    const population = this.population(state.species.code)
    const active = population.filter((individual) => individual.stage !== 'seed')
    state.income = active.reduce((sum, individual) => {
      const light = this.lightAt(individual.x, individual.y)
      const leafScale = { seedling: 0.13, sapling: 0.48, adult: 1 }[individual.stage as Exclude<Stage, 'seed'>]
      const structure = 0.45 + 0.55 * Math.min(1, individual.height / (individual.species.maxHeight * 0.55))
      return sum + leafScale * structure * this.lightResponse(state.species.strategy, light) * 0.92
    }, 0)
    state.cumulativeCarbonSequestered += state.income
    state.maintenance = population.reduce(
      (sum, individual) => sum + { seed: 0.003, seedling: 0.028, sapling: 0.115, adult: 0.28 }[individual.stage],
      0,
    )
    let available = state.income - state.maintenance
    let shortageRatio = 0
    if (available < 0) {
      const deficit = -available
      const covered = Math.min(deficit, state.reserve)
      state.reserve -= covered
      shortageRatio = state.maintenance > 0 ? (deficit - covered) / state.maintenance : 0
      available = 0
    }
    state.surplus = available
    const growthPool = available * state.allocation.growth
    const reproductionPool = available * state.allocation.reproduction
    state.reserve = Math.min(300, state.reserve + available * state.allocation.reserve)
    if (active.length > 0 && growthPool > 0) {
      const perIndividual = growthPool / active.length
      for (const individual of active) {
        const response = this.lightResponse(state.species.strategy, this.lightAt(individual.x, individual.y))
        const stageBoost = individual.stage === 'adult' ? 0.28 : individual.stage === 'sapling' ? 0.75 : 1
        const competitionModifier = 1 - individual.competitionPressure * 0.55
        const releaseBoost = gapReleaseMultiplier(
          individual.species.strategy,
          individual.releaseUntil > this.forestYear,
        )
        const pioneerBoost = state.species.strategy === 'sun' && individual.stage !== 'adult' ? 1.35 : 1
        const heightGain = perIndividual * state.species.maxHeight * 0.028 * response * stageBoost * competitionModifier * releaseBoost * pioneerBoost
        individual.height = Math.min(state.species.maxHeight, individual.height + heightGain)
        individual.dbh += heightGain * 1.55
      }
    }
    const fecundity = state.species.strategy === 'sun' ? 2.6 : state.species.strategy === 'shade' ? 0.8 : 1
    state.reproductionCredit += reproductionPool * fecundity
    const adults = population.filter((individual) => individual.stage === 'adult')
    const seedCost = state.species.strategy === 'sun' ? 1.6 : state.species.strategy === 'shade' ? 5 : 3.5
    const monthlyCap = state.species.strategy === 'sun' ? 10 : 6
    let seedsToCreate = Math.min(monthlyCap, Math.floor(state.reproductionCredit / seedCost))
    if (this.individuals.length >= this.maxIndividuals || adults.length === 0) seedsToCreate = 0
    state.reproductionCredit -= seedsToCreate * seedCost
    for (let count = 0; count < seedsToCreate; count += 1) this.createSeed(state.species, this.random.pick(adults))
    if (shortageRatio > 0) {
      const shortageTolerance = state.species.strategy === 'shade' ? 0.45 : state.species.strategy === 'broad' ? 0.6 : 1
      for (const individual of population) this.damage(individual, shortageRatio * 0.035 * shortageTolerance, 'carbon')
    } else if (state.reserve > Math.max(5, population.length * 0.18)) {
      const damaged = population.filter((individual) => individual.health < 0.9)
      const repairPerIndividual = 0.0015
      const repairCost = Math.min(state.reserve, damaged.length * repairPerIndividual)
      state.reserve -= repairCost
      for (const individual of damaged) individual.health = Math.min(0.92, individual.health + repairPerIndividual)
    }
  }

  private createSeed(species: Species, mother: Individual): void {
    if (this.individuals.length >= this.maxIndividuals) return
    const state = this.states.get(species.code)!
    const baseTailChance = species.strategy === 'sun' ? 0.42 : species.strategy === 'shade' ? 0.08 : 0.18
    const tailChance = Math.min(0.8, baseTailChance * (state.disperseUntil > this.forestYear ? 2 : 1))
    const localMean = species.strategy === 'sun' ? 7 : species.strategy === 'shade' ? 4 : 5
    const longMean = species.strategy === 'sun' ? 24 : species.strategy === 'shade' ? 12 : 17
    let nextX = mother.x
    let nextY = mother.y
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const meanMeters = this.random.next() < tailChance ? longMean : localMean
      const angle = this.random.between(0, Math.PI * 2)
      const radiusMeters = -Math.log(Math.max(1e-8, 1 - this.random.next())) * meanMeters
      nextX = mother.x + (Math.cos(angle) * radiusMeters) / MAP_WIDTH_METERS
      nextY = mother.y + (Math.sin(angle) * radiusMeters) / MAP_HEIGHT_METERS
      if (nextX >= 0 && nextX < 1 && nextY >= 0 && nextY < 1) break
    }
    if (nextX < 0 || nextX >= 1 || nextY < 0 || nextY >= 1) return
    const seed = this.makeIndividual(
      species,
      'seed',
      nextX,
      nextY,
    )
    this.individuals.push(seed)
    this.recordIndividual(seed, true)
  }

  private applyEstablishmentAndMortality(): void {
    const index = this.buildSpatialIndex()
    for (const individual of this.individuals) {
      individual.ageYears += FIXED_STEP_YEARS
      const light = this.lightAt(individual.x, individual.y)
      const neighbors = this.neighbors(individual, index)
      const sameSpecies = neighbors.filter((other) => other.species.code === individual.species.code).length
      individual.pathogenPressure = clamp01((sameSpecies - 4) / 8)
      const neighborLoad = neighbors.reduce((load, other) => {
        const distance = this.distanceMeters(individual, other)
        const distanceWeight = Math.max(0, 1 - distance / PRESSURE_RADIUS_METERS)
        const sizeRatio = Math.max(0.25, Math.min(3, other.height / Math.max(0.25, individual.height)))
        return load + distanceWeight * (0.4 + 0.6 * sizeRatio)
      }, 0)
      individual.competitionPressure = competitionFromLoad(neighborLoad)
      if (individual.stage === 'seed') {
        const state = this.states.get(individual.species.code)!
        const nursery = state.nurseryUntil > this.forestYear ? 1.5 : 1
        const seedSelfThinning = Math.min(0.35, Math.max(0, neighbors.length - 4) * 0.0025)
        const establishment =
          this.establishmentChance(individual.species.strategy, light) *
          (1 - individual.pathogenPressure * 0.65) *
          (1 - individual.competitionPressure * 0.7) * nursery
        if (this.random.next() < establishment) {
          individual.stage = 'seedling'
          individual.height = 0.08
          individual.dbh = 0.2
          individual.health = 0.72
          this.recordIndividual(individual, true)
        } else if (this.random.next() < seedSelfThinning) {
          this.damage(individual, 2, 'competition')
        } else if (individual.ageYears > 4 || this.random.next() < 0.012 + individual.pathogenPressure * 0.018) {
          this.damage(individual, 2, 'seed_failure')
        }
        individual.riskScore = Math.max(individual.pathogenPressure, individual.competitionPressure)
        continue
      }
      const previousStage = individual.stage
      if (individual.stage === 'seedling' && individual.height >= Math.min(1, individual.species.maxHeight * 0.1)) individual.stage = 'sapling'
      if (individual.stage === 'sapling' && individual.height >= this.maturityHeight(individual.species)) individual.stage = 'adult'
      if (individual.stage !== previousStage) this.recordIndividual(individual, true)

      const strategySurvival = individual.species.strategy === 'shade'
        ? individual.canopy ? 0.25 : 0.48
        : individual.species.strategy === 'broad' ? 0.65 : 1
      const lightEffect = this.lightHealthEffect(individual.species.strategy, light)
      if (lightEffect < 0) this.damage(individual, -lightEffect * strategySurvival, 'light')
      else individual.health = Math.min(0.95, individual.health + lightEffect)
      const defense = this.states.get(individual.species.code)!.defenseUntil > this.forestYear ? 0.5 : 1
      const nurseryProtection = this.states.get(individual.species.code)!.nurseryUntil > this.forestYear && individual.stage === 'seedling' ? 0.6 : 1
      const competitionDamage = { seedling: 0.0025, sapling: 0.0015, adult: 0.0008 }[individual.stage]
      const pathogenDamage = { seedling: 0.0035, sapling: 0.0022, adult: 0.001 }[individual.stage]
      const localBasalArea = neighbors.reduce((sum, other) => sum + Math.PI * (other.dbh / 200) ** 2, 0)
      const sizeDisadvantage = selfThinningSizeMultiplier(individual.stage, individual.dbh)
      const selfThinning = (
        Math.max(0, neighbors.length - 6) * 0.0012 +
        Math.max(0, localBasalArea - 0.12) * 0.004
      ) * sizeDisadvantage
      this.damage(individual, (individual.competitionPressure * competitionDamage + selfThinning) * strategySurvival * nurseryProtection, 'competition')
      this.damage(individual, individual.pathogenPressure * pathogenDamage * defense * strategySurvival * nurseryProtection, 'pathogen')
      if (individual.insectPressure > 0) this.damage(individual, individual.insectPressure * 0.0018 * defense, 'insect')
      if (individual.ageYears > 95 && this.random.next() < 0.008 * strategySurvival) this.damage(individual, 2, 'senescence')
      if (individual.stage === 'adult' && this.random.next() < 0.00025 * strategySurvival) this.damage(individual, 2, 'senescence')
      if (individual.stage === 'sapling' && light - individual.previousLight >= 0.2) individual.releaseUntil = this.forestYear + 3
      individual.previousLight = light
      const lightRisk = lightEffect < 0 ? clamp01(-lightEffect / 0.006) : 0
      const healthRisk = clamp01((0.72 - individual.health) / 0.42)
      individual.riskScore = Math.max(
        healthRisk,
        lightRisk,
        individual.competitionPressure,
        individual.pathogenPressure,
        individual.insectPressure,
      )
    }
  }

  private buildSpatialIndex(): Map<string, Individual[]> {
    const index = new Map<string, Individual[]>()
    for (const individual of this.individuals) {
      const key = this.spatialKey(individual.x, individual.y)
      const bucket = index.get(key)
      if (bucket) bucket.push(individual)
      else index.set(key, [individual])
    }
    return index
  }

  private spatialKey(x: number, y: number): string {
    return `${Math.floor((x * MAP_WIDTH_METERS) / PRESSURE_RADIUS_METERS)}:${Math.floor((y * MAP_HEIGHT_METERS) / PRESSURE_RADIUS_METERS)}`
  }

  private neighbors(individual: Individual, index: Map<string, Individual[]>): Individual[] {
    const cellX = Math.floor((individual.x * MAP_WIDTH_METERS) / PRESSURE_RADIUS_METERS)
    const cellY = Math.floor((individual.y * MAP_HEIGHT_METERS) / PRESSURE_RADIUS_METERS)
    const result: Individual[] = []
    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        const bucket = index.get(`${cellX + offsetX}:${cellY + offsetY}`)
        if (!bucket) continue
        for (const other of bucket) {
          if (other.id !== individual.id && other.stage !== 'seed' && this.distanceMeters(individual, other) < PRESSURE_RADIUS_METERS) result.push(other)
        }
      }
    }
    return result
  }

  private distanceMeters(first: Individual, second: Individual): number {
    return Math.hypot((first.x - second.x) * MAP_WIDTH_METERS, (first.y - second.y) * MAP_HEIGHT_METERS)
  }

  private recalculateCanopyAndLight(): void {
    for (const individual of this.individuals) individual.canopy = individual.height >= CANOPY_HEIGHT_METERS
    const coveredCells = new Uint8Array(GRID_WIDTH * GRID_HEIGHT)
    for (let gy = 0; gy < GRID_HEIGHT; gy += 1) {
      for (let gx = 0; gx < GRID_WIDTH; gx += 1) {
        const x = (gx + 0.5) / GRID_WIDTH
        this.lightGrid[gy * GRID_WIDTH + gx] = Math.max(
          0.05,
          Math.min(0.96, 0.93 - x * 0.055 + Math.sin(gx * 1.71 + gy * 0.63) * 0.018),
        )
      }
    }
    for (const tree of this.individuals) {
      if (!tree.canopy) continue
      const crown = this.crownRadius(tree)
      const baseOpacity = this.scenarioId === 'closed' ? 0.85 : 0.55
      const opacity = Math.max(baseOpacity, Math.min(0.93, baseOpacity + (tree.height - CANOPY_HEIGHT_METERS) * 0.018))
      const minX = Math.max(0, Math.floor((tree.x - crown) * GRID_WIDTH))
      const maxX = Math.min(GRID_WIDTH - 1, Math.ceil((tree.x + crown) * GRID_WIDTH))
      const minY = Math.max(0, Math.floor((tree.y - crown) * GRID_HEIGHT))
      const maxY = Math.min(GRID_HEIGHT - 1, Math.ceil((tree.y + crown) * GRID_HEIGHT))
      const crownSquared = crown * crown
      for (let gy = minY; gy <= maxY; gy += 1) {
        for (let gx = minX; gx <= maxX; gx += 1) {
          const dx = (gx + 0.5) / GRID_WIDTH - tree.x
          const dy = (gy + 0.5) / GRID_HEIGHT - tree.y
          const distanceSquared = dx * dx + dy * dy
          if (distanceSquared >= crownSquared) continue
          const weight = 1 - Math.sqrt(distanceSquared) / crown
          const gridIndex = gy * GRID_WIDTH + gx
          coveredCells[gridIndex] = 1
          this.lightGrid[gridIndex] = Math.max(0.045, this.lightGrid[gridIndex] * (1 - opacity * weight))
        }
      }
    }
    let covered = 0
    for (const value of coveredCells) covered += value
    this.canopyCoverValue = covered / coveredCells.length
    this.lightRevision += 1
  }

  private crownRadius(individual: Individual): number {
    const meters = Math.max(3.5, Math.min(7, 2.5 + individual.height * 0.18 + individual.dbh * 0.08))
    return meters / MAP_WIDTH_METERS
  }

  private updateWarningAndDisturbance(): void {
    if (!this.warningIssued && this.forestYear >= this.nextDisturbanceAt - 1.5) {
      const type: DisturbanceType = this.random.next() < 0.56 ? 'typhoon' : 'rainstorm'
      this.warning = {
        type,
        x: type === 'typhoon' ? this.random.between(0.18, 0.82) : 0.5,
        y: type === 'typhoon' ? this.random.between(0.2, 0.8) : 0.5,
        radius: type === 'typhoon' ? this.random.between(0.13, 0.19) : 1,
        happensAt: this.nextDisturbanceAt,
      }
      this.warningIssued = true
      this.addEvent(type === 'typhoon' ? '台风预警：局部高树风险上升。' : '暴雨预警：全图个体将受到健康冲击。', 'warning', 'disturbance', 'emergency')
    }
    if (!this.warning || this.forestYear < this.warning.happensAt) return
    const warning = this.warning
    if (warning.type === 'typhoon') {
      const affected = this.individuals.filter(
        (individual) => individual.canopy && Math.hypot(individual.x - warning.x, individual.y - warning.y) < warning.radius,
      )
      let deaths = 0
      for (const individual of affected) {
        const state = this.states.get(individual.species.code)!
        const buffer = Math.min(0.16, state.reserve / Math.max(1, this.population(individual.species.code).length) / 35)
        const heightRisk = Math.min(0.32, Math.max(0, (individual.height - CANOPY_HEIGHT_METERS) * 0.012))
        if (this.random.next() < 0.28 + heightRisk - buffer) {
          this.damage(individual, 2, 'typhoon')
          deaths += 1
        } else this.damage(individual, 0.24, 'typhoon')
      }
      this.addEvent(`台风经过：${deaths} 棵冠层树倒伏，局部林窗形成。`, deaths > 0 ? 'bad' : 'neutral', 'disturbance', 'emergency')
    } else {
      for (const individual of this.individuals) {
        const state = this.states.get(individual.species.code)!
        const buffer = Math.min(0.035, state.reserve / Math.max(1, this.population(individual.species.code).length) * 0.012)
        const base = { seed: 0.04, seedling: 0.09, sapling: 0.06, adult: 0.04 }[individual.stage]
        this.damage(individual, Math.max(0.015, base - buffer), 'rainstorm')
      }
      this.addEvent(`暴雨席卷全图：${this.individuals.length} 个体健康下降。`, 'bad', 'disturbance', 'emergency')
    }
    this.warning = null
    this.warningIssued = false
    this.nextDisturbanceAt = this.forestYear + this.random.between(7, 11)
  }

  private updateDominanceAndPest(year: number): void {
    if (year < this.pestCooldownUntil || this.pestWarning) return
    const established = this.individuals.filter((individual) => individual.stage !== 'seed')
    if (established.length === 0) return
    for (const species of this.activeSpecies) {
      const share = established.filter((individual) => individual.species.code === species.code).length / established.length
      const previous = this.dominanceYears.get(species.code) ?? 0
      this.dominanceYears.set(species.code, share >= 0.45 ? previous + 1 : 0)
      if ((this.dominanceYears.get(species.code) ?? 0) >= 5) {
        this.pestWarning = { speciesCode: species.code, warningAt: year, happensAt: year + 3 }
        this.addEvent(`专性虫害预警：${species.name} 长期占据优势，三年后可能暴发。`, 'warning', 'pest', 'emergency')
        break
      }
    }
  }

  private updatePestPressure(): void {
    for (const individual of this.individuals) individual.insectPressure = 0
    if (!this.pestWarning) return
    const target = this.states.get(this.pestWarning.speciesCode)!.species
    const progress = clamp01((this.forestYear - this.pestWarning.warningAt) / 3)
    for (const individual of this.population(target.code)) individual.insectPressure = 0.35 + progress * 0.65
    if (this.forestYear < this.pestWarning.happensAt) return
    const state = this.states.get(target.code)!
    const defended = state.defenseUntil > this.forestYear
    const fraction = this.random.between(0.25, 0.45) * (defended ? 0.5 : 1)
    let deaths = 0
    for (const individual of this.population(target.code).filter((item) => item.stage !== 'seed')) {
      if (this.random.next() < fraction) {
        this.damage(individual, 2, 'insect')
        deaths += 1
      } else this.damage(individual, defended ? 0.15 : 0.3, 'insect')
    }
    this.addEvent(`专性虫害暴发：${target.name} 死亡 ${deaths} 个体，优势格局被打破。`, 'bad', 'pest', 'emergency')
    this.lastPestOutbreakYear = this.forestYear
    this.pestCooldownUntil = this.forestYear + 15
    this.dominanceYears.set(target.code, 0)
    this.pestWarning = null
  }

  private lightResponse(strategy: Strategy, light: number): number {
    if (strategy === 'sun') return Math.max(0.04, (light - 0.1) * 1.34)
    if (strategy === 'shade') return 0.3 + light * 0.58
    return 0.28 + light * 0.95
  }

  private lightHealthEffect(strategy: Strategy, light: number): number {
    if (strategy === 'sun') {
      if (light < 0.35) return -(0.0015 + (0.35 - light) * 0.015)
      if (light > 0.58) return 0.0008
      return 0
    }
    if (strategy === 'shade') {
      if (light > 0.82) return -(0.0015 + (light - 0.82) * 0.018)
      if (light < 0.07) return -0.0025
      if (light <= 0.68) return 0.0006
      return 0
    }
    if (light < 0.07) return -0.0015
    if (light > 0.97) return -0.0015
    if (light >= 0.1 && light <= 0.9) return 0.0006
    return 0
  }

  private establishmentChance(strategy: Strategy, light: number): number {
    if (strategy === 'sun') return light > 0.5 ? 0.075 + light * 0.06 : 0.003
    if (strategy === 'shade') return 0.026 + (1 - Math.abs(light - 0.3)) * 0.042
    return 0.025 + light * 0.048
  }

  private damage(individual: Individual, amount: number, cause: DeathCause): void {
    if (individual.health <= 0 || amount <= 0) return
    individual.health -= amount
    if (individual.health <= 0) individual.deathCause = cause
  }

  private collectDead(): void {
    const dead = this.individuals.filter((individual) => individual.health <= 0)
    if (dead.length === 0) return
    for (const individual of dead) {
      const cause = individual.deathCause ?? 'carbon'
      this.deaths.push({
        individualId: individual.id,
        time: this.forestYear,
        x: individual.x,
        y: individual.y,
        speciesCode: individual.species.code,
        speciesName: individual.species.name,
        stage: individual.stage,
        height: individual.height,
        dbh: individual.dbh,
        cause,
      })
      this.recordIndividual(individual, false, this.forestYear, cause)
    }
    this.individuals = this.individuals.filter((individual) => individual.health > 0)
  }

  private sampleHistory(time = this.forestYear): void {
    const totalCommunity = Math.max(1, this.individuals.length)
    const speciesSamples: SpeciesHistorySample[] = []
    for (const species of this.activeSpecies) {
      const population = this.population(species.code)
      const stems = population.filter((individual) => individual.stage !== 'seed')
      const state = this.states.get(species.code)!
      const previousSample = [...this.speciesHistory].reverse().find((sample) => sample.speciesCode === species.code)
      const previousTime = previousSample?.time ?? time
      const deaths = time === 0 ? 0 : this.deaths.filter((death) => (
        death.speciesCode === species.code && death.time > previousTime + 1e-9 && death.time <= time + 1e-6
      )).length
      const demographics = calculateDemographicChange(
        previousSample?.total ?? population.length,
        population.length,
        deaths,
      )
      const annualCarbonSequestered = state.cumulativeCarbonSequestered - state.carbonAtLastHistory
      const sample: SpeciesHistorySample = {
        time,
        speciesCode: species.code,
        strategy: species.strategy,
        ...demographics,
        total: population.length,
        seeds: population.length - stems.length,
        seedlings: stems.filter((individual) => individual.stage === 'seedling').length,
        saplings: stems.filter((individual) => individual.stage === 'sapling').length,
        adults: stems.filter((individual) => individual.stage === 'adult').length,
        canopy: population.filter((individual) => individual.canopy).length,
        averageHeight: this.average(stems.map((individual) => individual.height)),
        averageDbh: this.average(stems.map((individual) => individual.dbh)),
        basalAreaM2: this.basalArea(population),
        reserve: state.reserve,
        income: state.income,
        averageHealth: this.average(population.map((individual) => individual.health)),
        share: population.length / totalCommunity,
        annualCarbonSequestered,
        cumulativeCarbonSequestered: state.cumulativeCarbonSequestered,
      }
      state.carbonAtLastHistory = state.cumulativeCarbonSequestered
      this.speciesHistory.push(sample)
      speciesSamples.push(sample)
    }
    for (const strategy of ['sun', 'shade', 'broad'] as Strategy[]) {
      const samples = speciesSamples.filter((sample) => sample.strategy === strategy)
      const startingPopulation = samples.reduce((sum, sample) => sum + sample.startingPopulation, 0)
      const births = samples.reduce((sum, sample) => sum + sample.births, 0)
      const deaths = samples.reduce((sum, sample) => sum + sample.deaths, 0)
      this.functionalTypeHistory.push({
        time,
        strategy,
        startingPopulation,
        total: samples.reduce((sum, sample) => sum + sample.total, 0),
        births,
        deaths,
        birthsPer100: startingPopulation > 0 ? (births / startingPopulation) * 100 : 0,
        deathsPer100: startingPopulation > 0 ? (deaths / startingPopulation) * 100 : 0,
        seeds: samples.reduce((sum, sample) => sum + sample.seeds, 0),
        seedlings: samples.reduce((sum, sample) => sum + sample.seedlings, 0),
        saplings: samples.reduce((sum, sample) => sum + sample.saplings, 0),
        adults: samples.reduce((sum, sample) => sum + sample.adults, 0),
        canopy: samples.reduce((sum, sample) => sum + sample.canopy, 0),
        speciesRichness: samples.filter((sample) => sample.total > 0).length,
        basalAreaM2: samples.reduce((sum, sample) => sum + sample.basalAreaM2, 0),
        annualCarbonSequestered: samples.reduce((sum, sample) => sum + sample.annualCarbonSequestered, 0),
        cumulativeCarbonSequestered: samples.reduce((sum, sample) => sum + sample.cumulativeCarbonSequestered, 0),
      })
    }
    const stems = this.individuals.filter((individual) => individual.stage !== 'seed')
    const startingPopulation = speciesSamples.reduce((sum, sample) => sum + sample.startingPopulation, 0)
    const births = speciesSamples.reduce((sum, sample) => sum + sample.births, 0)
    const deaths = speciesSamples.reduce((sum, sample) => sum + sample.deaths, 0)
    const diversity = calculateDiversityMetrics(speciesSamples.map((sample) => sample.total))
    this.communityHistory.push({
      time,
      startingPopulation,
      total: speciesSamples.reduce((sum, sample) => sum + sample.total, 0),
      births,
      deaths,
      birthsPer100: startingPopulation > 0 ? (births / startingPopulation) * 100 : 0,
      deathsPer100: startingPopulation > 0 ? (deaths / startingPopulation) * 100 : 0,
      seeds: speciesSamples.reduce((sum, sample) => sum + sample.seeds, 0),
      seedlings: speciesSamples.reduce((sum, sample) => sum + sample.seedlings, 0),
      saplings: speciesSamples.reduce((sum, sample) => sum + sample.saplings, 0),
      adults: speciesSamples.reduce((sum, sample) => sum + sample.adults, 0),
      canopy: speciesSamples.reduce((sum, sample) => sum + sample.canopy, 0),
      speciesRichness: speciesSamples.filter((sample) => sample.total > 0).length,
      canopyCover: this.canopyCover(),
      grossCarbonIncome: speciesSamples.reduce((sum, sample) => sum + sample.income, 0),
      annualCarbonSequestered: speciesSamples.reduce(
        (sum, sample) => sum + sample.annualCarbonSequestered,
        0,
      ),
      cumulativeCarbonSequestered: speciesSamples.reduce(
        (sum, sample) => sum + sample.cumulativeCarbonSequestered,
        0,
      ),
      averageHealth: this.average(this.individuals.map((individual) => individual.health)),
      averageHeight: this.average(stems.map((individual) => individual.height)),
      averageDbh: this.average(stems.map((individual) => individual.dbh)),
      basalAreaM2: this.basalArea(),
      ...diversity,
    })
    const population = this.population(this.playerCode)
    const state = this.states.get(this.playerCode)!
    const nonSeeds = population.filter((individual) => individual.stage !== 'seed')
    this.history.push({
      time,
      total: population.length,
      adults: population.filter((individual) => individual.stage === 'adult').length,
      reserve: state.reserve,
      income: state.income,
      averageHeight: this.average(nonSeeds.map((individual) => individual.height)),
      averageHealth: this.average(population.map((individual) => individual.health)),
      averageLight: this.average(population.map((individual) => this.lightAt(individual.x, individual.y))),
      averagePathogenPressure: this.average(population.map((individual) => individual.pathogenPressure)),
      averageCompetitionPressure: this.average(population.map((individual) => individual.competitionPressure)),
      averageRisk: this.average(population.map((individual) => individual.riskScore)),
      canopy: population.filter((individual) => individual.canopy).length,
    })
  }

  private recordFiveYearSummary(time: number): void {
    const currentPlayer = this.history.find((sample) => sample.time === time)
    const previousPlayer = this.history.find((sample) => sample.time === time - 5)
    if (!currentPlayer || !previousPlayer) return

    const canopySamples = this.speciesHistory
      .filter((sample) => sample.time === time && sample.canopy > 0)
      .sort((first, second) => second.canopy - first.canopy)
    const dominant = canopySamples[0]
    const totalCanopy = canopySamples.reduce((sum, sample) => sum + sample.canopy, 0)
    const dominantSpecies = dominant
      ? this.activeSpecies.find((species) => species.code === dominant.speciesCode) ?? null
      : null
    const playerPopulationChange = currentPlayer.total - previousPlayer.total
    const playerPopulationChangePercent = previousPlayer.total > 0
      ? playerPopulationChange / previousPlayer.total
      : null
    const summary: FiveYearSummary = {
      time,
      dominantCanopySpeciesCode: dominantSpecies?.code ?? null,
      dominantCanopySpeciesName: dominantSpecies?.name ?? null,
      dominantCanopyCount: dominant?.canopy ?? 0,
      dominantCanopyShare: totalCanopy > 0 ? (dominant?.canopy ?? 0) / totalCanopy : 0,
      playerPopulation: currentPlayer.total,
      playerPopulationChange,
      playerPopulationChangePercent,
    }
    this.fiveYearSummaries.push(summary)

    const canopyText = dominantSpecies
      ? `冠层优势物种为${dominantSpecies.name}（${Math.round(summary.dominantCanopyShare * 100)}%）`
      : '目前尚未形成冠层优势物种'
    const changeText = previousPlayer.total > 0
      ? `${playerPopulationChange >= 0 ? '+' : ''}${playerPopulationChange}（${playerPopulationChangePercent! >= 0 ? '+' : ''}${Math.round(playerPopulationChangePercent! * 100)}%）`
      : `从 0 增至 ${currentPlayer.total}`
    this.addEvent(
      `第 ${time} 年摘要：${canopyText}；玩家种群过去 5 年变化 ${changeText}。`,
      playerPopulationChange > 0 ? 'good' : playerPopulationChange < 0 ? 'warning' : 'neutral',
      'summary',
      'routine',
      time,
    )
  }

  private recordAllIndividuals(time = this.forestYear): void {
    for (const individual of this.individuals) this.recordIndividual(individual, true, time)
  }

  private recordIndividual(
    individual: Individual,
    alive: boolean,
    time = this.forestYear,
    deathCause: DeathCause | '' = '',
  ): void {
    this.individualSnapshots.push({
      time,
      individualId: individual.id,
      x: individual.x,
      y: individual.y,
      speciesCode: individual.species.code,
      speciesName: individual.species.name,
      strategy: individual.species.strategy,
      stage: individual.stage,
      alive,
      height: individual.height,
      dbh: individual.dbh,
      health: Math.max(0, individual.health),
      localLight: this.lightAt(individual.x, individual.y),
      competitionPressure: individual.competitionPressure,
      pathogenPressure: individual.pathogenPressure,
      insectPressure: individual.insectPressure,
      carbonReserve: this.states.get(individual.species.code)?.reserve ?? 0,
      deathCause,
    })
  }

  private buildOutcomeReport(kind: OutcomeReport['kind']): OutcomeReport {
    const year = Math.max(0, Math.round(this.forestYear))
    const playerPopulation = this.population(this.playerCode)
    const total = this.individuals.length
    const share = total > 0 ? playerPopulation.length / total : 0
    const activeSpecies = this.activeSpecies.filter((species) => this.population(species.code).length > 0).length
    const latest = this.history[this.history.length - 1]
    const tenYearsAgo = [...this.history].reverse().find((sample) => sample.time <= this.forestYear - 10) ?? this.history[0]
    const trend = latest && tenYearsAgo ? latest.total - tenYearsAgo.total : 0
    const recentDeaths = this.deaths.filter((death) => death.time >= this.forestYear - 10)
    const insectDeaths = recentDeaths.filter((death) => death.cause === 'insect').length
    let outcome = '当前格局：多物种共存'
    if (kind === 'community-extinct') outcome = '终局：整个群落灭绝'
    else if (kind === 'player-extinct') outcome = '玩家物种灭绝 · 可继续观察'
    else if (insectDeaths > 5 && this.lastPestOutbreakYear >= this.forestYear - 10) outcome = '关键转折：优势种虫害暴发'
    else if (share >= 0.48) outcome = '当前格局：玩家物种占优势'
    else if (share < 0.08) outcome = '当前格局：低位维持'
    else if (trend > 8) outcome = '当前格局：种群快速扩张'
    else if (trend < -8) outcome = '当前格局：种群持续衰退'
    const dominantCause = this.dominantDeathCause(recentDeaths)
    const drivers = [
      latest && latest.averageLight < 0.3 ? '低光正在限制收入与喜阳个体健康。' : '当前平均光照尚能支撑结构生长。',
      latest && latest.averageCompetitionPressure > 0.45 ? '邻域竞争已成为主要增长阻力。' : '竞争压力整体仍在可控范围。',
      dominantCause ? `过去 10 年最常见死亡原因：${this.deathCauseLabel(dominantCause)}。` : '过去 10 年没有形成单一主导死亡原因。',
    ]
    const futureRisks = [
      this.pestWarning ? `${this.states.get(this.pestWarning.speciesCode)!.species.name} 的专性虫害将在约 ${Math.max(0, this.pestWarning.happensAt - this.forestYear).toFixed(1)} 年后暴发。` : '持续寡头化会积累专性虫害风险。',
      latest && latest.averageRisk >= 0.45 ? '风险个体比例偏高，应检查光照、竞争和病原压力。' : '当前综合风险中等，可继续观察下一次扰动。',
    ]
    const allocation = this.playerState.allocation
    const strategyImpacts = [
      `当前投资：生长 ${Math.round(allocation.growth * 100)}% · 繁殖 ${Math.round(allocation.reproduction * 100)}% · 储备 ${Math.round(allocation.reserve * 100)}%。`,
      allocation.growth >= Math.max(allocation.reproduction, allocation.reserve)
        ? '策略偏向抢占高度，已有个体结构增长更快，但对逆境的缓冲较少。'
        : allocation.reproduction >= allocation.reserve
          ? '策略偏向扩散下一代，种子输入更高，但短期林冠竞争力较弱。'
          : '策略偏向储备，短期扩张较慢，但能更好缓冲低光和扰动。',
      this.playerState.defenseUntil > this.forestYear
        ? `诱导防御仍可持续 ${(this.playerState.defenseUntil - this.forestYear).toFixed(1)} 年。`
        : `当前碳储备 ${this.playerState.reserve.toFixed(1)}，可用于未来主动能力或资源短缺。`,
    ]
    return {
      title: `第 ${year} 年森林演替结算`,
      outcome,
      summary: `${this.playerSpecies.name} 占群落个体 ${Math.round(share * 100)}%，当前有 ${activeSpecies}/6 个物种存活。`,
      details: [
        `存活个体 ${playerPopulation.length} · 过去 10 年 ${trend >= 0 ? '+' : ''}${trend}`,
        `平均健康 ${Math.round((latest?.averageHealth ?? 0) * 100)}% · 平均光照 ${Math.round((latest?.averageLight ?? 0) * 100)}%`,
        `竞争压力 ${Math.round((latest?.averageCompetitionPressure ?? 0) * 100)}% · 病原菌压力 ${Math.round((latest?.averagePathogenPressure ?? 0) * 100)}%`,
        `冠层个体 ${latest?.canopy ?? 0} · 当前全图林冠覆盖 ${Math.round(this.canopyCover() * 100)}%`,
        `平均胸径 ${this.averageDbh().toFixed(1)} cm · 胸高断面积 ${this.basalArea().toFixed(2)} m²`,
        `碳储备 ${this.playerState.reserve.toFixed(1)} · 当前收入 ${this.playerState.income.toFixed(1)}`,
        `过去 10 年死亡 ${recentDeaths.length} 个体${dominantCause ? `，主要为${this.deathCauseLabel(dominantCause)}` : ''}`,
      ],
      drivers,
      strategyImpacts,
      futureRisks,
      turningPoints: this.events.slice(-8).reverse(),
      terminal: kind === 'community-extinct',
      canContinue: kind !== 'community-extinct',
      kind,
      year,
    }
  }

  private dominantDeathCause(records: DeathRecord[]): DeathCause | null {
    if (records.length === 0) return null
    const counts = new Map<DeathCause, number>()
    for (const record of records) counts.set(record.cause, (counts.get(record.cause) ?? 0) + 1)
    return [...counts.entries()].sort((first, second) => second[1] - first[1])[0][0]
  }

  private addEvent(
    message: string,
    tone: EventEntry['tone'],
    category: EventEntry['category'],
    priority: EventEntry['priority'] = 'routine',
    time = this.forestYear,
  ): void {
    const event = { time, message, tone, category, priority }
    this.events.push(event)
    if (priority === 'emergency') this.emergencyEvents.push(event)
  }

  private average(values: number[]): number {
    return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
  }
}
