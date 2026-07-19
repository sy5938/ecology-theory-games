import type { Species, Strategy } from './species'
import { clamp01, competitionFromLoad } from './pressure'

export type Stage = 'seed' | 'seedling' | 'sapling' | 'adult'
export type AllocationKey = 'growth' | 'reproduction' | 'reserve'
export type ScenarioId = 'closed' | 'sparse' | 'colonization'
export type ViewLayer = 'all' | 'canopy' | 'understory'
export type ActiveAbility = 'defense' | 'mast'
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
}

export const SCENARIOS: Record<ScenarioId, ScenarioDefinition> = {
  closed: {
    id: 'closed',
    name: '密闭森林',
    description: '林冠投影覆盖率至少 95%，先在低光与拥挤中活下来。',
    populationHint: '约 360 个体',
    coverHint: '林冠覆盖 ≥95%',
    lightHint: '平均林下光照约 15–30%',
  },
  sparse: {
    id: 'sparse',
    name: '稀疏森林',
    description: '林冠覆盖约 15–30%，高光机会多，扩张与竞争来得更快。',
    populationHint: '约 108 个体',
    coverHint: '林冠覆盖 15–30%',
    lightHint: '平均林下光照约 65–85%',
  },
  colonization: {
    id: 'colonization',
    name: '先锋定殖',
    description: '玩家仅有 6 个未成熟个体，在居民群落中建立下一代。',
    populationHint: '玩家 6 个体',
    coverHint: '无玩家成树',
    lightHint: '稀疏背景，平均光照偏高',
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
  total: number
  seeds: number
  seedlings: number
  saplings: number
  adults: number
  canopy: number
  reserve: number
  income: number
  averageHealth: number
  share: number
}

export interface EventEntry {
  time: number
  message: string
  tone: 'neutral' | 'warning' | 'good' | 'bad'
  category: 'process' | 'disturbance' | 'ability' | 'pest' | 'strategy'
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
  year: number
}

const STAGES: Stage[] = ['seed', 'seedling', 'sapling', 'adult']
const FIXED_REAL_SECONDS = 0.5
const FIXED_STEP_YEARS = 1 / 12
const MAP_WIDTH_METERS = 48
const MAP_HEIGHT_METERS = 32
const GRID_WIDTH = 48
const GRID_HEIGHT = 32
const MAX_INDIVIDUALS = 820
const PRESSURE_RADIUS_METERS = 2
const FIRST_CHECKPOINT_YEAR = 30
export const CANOPY_HEIGHT_METERS = 10
export const RISK_THRESHOLD = 0.6

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
  readonly events: EventEntry[] = []
  readonly deaths: DeathRecord[] = []
  readonly individualSnapshots: IndividualSnapshot[] = []
  readonly seed: number

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

  constructor(
    allSpecies: Species[],
    playerCode: string,
    scenarioOrSeed: ScenarioId | number = 'closed',
    suppliedSeed = Date.now() & 0xffffffff,
  ) {
    this.scenarioId = typeof scenarioOrSeed === 'number' ? 'closed' : scenarioOrSeed
    this.seed = typeof scenarioOrSeed === 'number' ? scenarioOrSeed : suppliedSeed
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
      })
      this.dominanceYears.set(species.code, 0)
    }

    this.seedScenario()
    this.recalculateCanopyAndLight()
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

  get allocation(): Allocation {
    return { ...this.states.get(this.playerCode)!.allocation }
  }

  setAllocation(allocation: Allocation): void {
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
    this.accumulator += Math.min(realDeltaSeconds, 0.1) * this.speed
    while (this.accumulator >= FIXED_REAL_SECONDS) {
      this.step()
      this.accumulator -= FIXED_REAL_SECONDS
      if (this.paused) break
    }
  }

  lightAt(x: number, y: number): number {
    const gx = Math.max(0, Math.min(GRID_WIDTH - 1, Math.floor(x * GRID_WIDTH)))
    const gy = Math.max(0, Math.min(GRID_HEIGHT - 1, Math.floor(y * GRID_HEIGHT)))
    return this.lightGrid[gy * GRID_WIDTH + gx]
  }

  canopyCover(): number {
    const canopy = this.individuals.filter((individual) => individual.canopy)
    if (canopy.length === 0) return 0
    let covered = 0
    for (let gy = 0; gy < GRID_HEIGHT; gy += 1) {
      for (let gx = 0; gx < GRID_WIDTH; gx += 1) {
        const x = (gx + 0.5) / GRID_WIDTH
        const y = (gy + 0.5) / GRID_HEIGHT
        if (canopy.some((tree) => Math.hypot(x - tree.x, y - tree.y) <= this.crownRadius(tree.height))) covered += 1
      }
    }
    return covered / (GRID_WIDTH * GRID_HEIGHT)
  }

  population(code: string): Individual[] {
    return this.individuals.filter((individual) => individual.species.code === code)
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
    if (ability === 'defense') {
      return {
        available: state.reserve >= 18 && this.forestYear >= state.defenseCooldownUntil,
        cost: 18,
        cooldownYears: Math.max(0, state.defenseCooldownUntil - this.forestYear),
        activeYears: Math.max(0, state.defenseUntil - this.forestYear),
      }
    }
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
    state.reserve -= 15
    state.mastCooldownUntil = this.forestYear + 8
    const adults = this.population(this.playerCode).filter((individual) => individual.stage === 'adult')
    const seedCount = Math.min(40, adults.length * 3, MAX_INDIVIDUALS - this.individuals.length)
    for (let count = 0; count < seedCount; count += 1) this.createSeed(state.species, this.random.pick(adults))
    const message = `集中结实：消耗 15 储备，释放 ${seedCount} 粒种子。`
    this.addEvent(message, 'good', 'ability')
    this.revision += 1
    return { ok: true, message }
  }

  continueAfterReport(): void {
    if (this.report?.terminal) return
    this.report = null
    this.paused = false
    this.longTermUnlocked = true
    this.addEvent('进入长期演替期：已解锁 8× 与 16×，后续结算由玩家主动查看。', 'good', 'process')
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
    return this.buildOutcomeReport(false)
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
    if (this.scenarioId === 'closed') {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        this.individuals = []
        this.nextId = 1
        this.seedClosedForest()
        this.recalculateCanopyAndLight()
        if (this.canopyCover() >= 0.95) return
      }
      throw new Error('无法生成林冠覆盖率达到 95% 的密闭森林。')
    }
    if (this.scenarioId === 'sparse') this.seedSparseForest(false)
    else this.seedSparseForest(true)
  }

  private seedClosedForest(): void {
    const tallSpecies = this.activeSpecies.filter((species) => species.maxHeight > CANOPY_HEIGHT_METERS)
    const targetCanopyCount = 120
    const canopyTargets = new Map<string, number>()
    tallSpecies.forEach((species, index) => {
      canopyTargets.set(
        species.code,
        Math.floor(targetCanopyCount / tallSpecies.length) + (index < targetCanopyCount % tallSpecies.length ? 1 : 0),
      )
    })
    const patchCenters = Array.from({ length: 11 }, () => ({
      x: this.random.between(0.06, 0.94),
      y: this.random.between(0.07, 0.93),
    }))
    const naturalPosition = (clusterChance: number): [number, number] => {
      if (this.random.next() >= clusterChance) return [this.random.between(0.015, 0.985), this.random.between(0.02, 0.98)]
      const center = this.random.pick(patchCenters)
      const angle = this.random.between(0, Math.PI * 2)
      const radius = Math.sqrt(this.random.next()) * this.random.between(0.035, 0.14)
      return [
        Math.max(0.015, Math.min(0.985, center.x + Math.cos(angle) * radius)),
        Math.max(0.02, Math.min(0.98, center.y + Math.sin(angle) * radius)),
      ]
    }
    for (const species of this.activeSpecies) {
      const tall = species.maxHeight > CANOPY_HEIGHT_METERS
      const canopyAdults = canopyTargets.get(species.code) ?? 0
      const subcanopyAdults = tall ? (canopyAdults >= 28 ? 6 : 8) : 8
      const saplings = tall ? (canopyAdults >= 28 ? 10 : 12) : 14
      const seedlings = tall ? Math.min(14, 60 - canopyAdults - subcanopyAdults - saplings - 4) : 24
      for (let count = 0; count < canopyAdults; count += 1) {
        const [x, y] = naturalPosition(0.28)
        const height = this.random.between(10.2, Math.max(10.25, Math.min(16, species.maxHeight * 0.94)))
        this.individuals.push(this.makeIndividual(species, 'adult', x, y, height))
      }
      for (let count = 0; count < subcanopyAdults; count += 1) {
        const [x, y] = naturalPosition(0.5)
        const height = tall
          ? this.random.between(Math.min(5.5, species.maxHeight * 0.45), Math.min(9.4, species.maxHeight * 0.78))
          : undefined
        this.individuals.push(this.makeIndividual(species, 'adult', x, y, height))
      }
      for (let count = 0; count < saplings; count += 1) {
        const [x, y] = naturalPosition(0.58)
        this.individuals.push(this.makeIndividual(species, 'sapling', x, y))
      }
      for (let count = 0; count < seedlings; count += 1) {
        const [x, y] = naturalPosition(0.68)
        this.individuals.push(this.makeIndividual(species, 'seedling', x, y))
      }
      while (this.population(species.code).length < 60) this.individuals.push(this.makeIndividual(species, 'seed'))
    }

    for (let guard = 0; guard < 180; guard += 1) {
      this.recalculateCanopyAndLight()
      if (this.canopyCover() >= 0.95) break
      const uncovered: Array<[number, number]> = []
      const canopy = this.individuals.filter((individual) => individual.canopy)
      for (let gy = 0; gy < GRID_HEIGHT; gy += 1) {
        for (let gx = 0; gx < GRID_WIDTH; gx += 1) {
          const x = (gx + 0.5) / GRID_WIDTH
          const y = (gy + 0.5) / GRID_HEIGHT
          if (!canopy.some((tree) => Math.hypot(x - tree.x, y - tree.y) <= this.crownRadius(tree.height))) uncovered.push([gx, gy])
        }
      }
      const candidates = this.individuals.filter(
        (individual) => !individual.canopy && tallSpecies.includes(individual.species),
      )
      if (uncovered.length === 0 || candidates.length === 0) break
      const [gx, gy] = this.random.pick(uncovered)
      const candidate = this.random.pick(candidates)
      candidate.x = Math.max(0.01, Math.min(0.99, (gx + this.random.between(0.2, 0.8)) / GRID_WIDTH))
      candidate.y = Math.max(0.01, Math.min(0.99, (gy + this.random.between(0.2, 0.8)) / GRID_HEIGHT))
      candidate.stage = 'adult'
      candidate.height = this.random.between(10.2, Math.max(10.25, Math.min(16, candidate.species.maxHeight * 0.94)))
      candidate.dbh = candidate.height * this.random.between(1.35, 1.95)
      candidate.ageYears = this.random.between(15, 65)
    }
  }

  private seedSparseForest(colonization: boolean): void {
    const canopySlots = [
      [0.14, 0.22], [0.38, 0.2], [0.64, 0.24], [0.86, 0.2],
      [0.18, 0.72], [0.4, 0.78], [0.66, 0.7], [0.86, 0.76],
    ]
    const canopySpecies = this.activeSpecies.filter(
      (species) => species.maxHeight > CANOPY_HEIGHT_METERS && (!colonization || species.code !== this.playerCode),
    )
    const assignedSlots = new Map<string, Array<[number, number]>>()
    canopySlots.slice(0, Math.min(canopySlots.length, canopySpecies.length * 2)).forEach((slot, index) => {
      const species = canopySpecies[index % canopySpecies.length]
      const slots = assignedSlots.get(species.code) ?? []
      slots.push(slot as [number, number])
      assignedSlots.set(species.code, slots)
    })
    for (const species of this.activeSpecies) {
      if (colonization && species.code === this.playerCode) {
        this.individuals.push(this.makeIndividual(species, 'sapling'))
        for (let count = 0; count < 3; count += 1) this.individuals.push(this.makeIndividual(species, 'seedling'))
        for (let count = 0; count < 2; count += 1) this.individuals.push(this.makeIndividual(species, 'seed'))
        continue
      }
      const speciesSlots = assignedSlots.get(species.code) ?? []
      for (const [baseX, baseY] of speciesSlots) {
        const height = this.random.between(10.3, Math.min(species.maxHeight * 0.78, 12.4))
        this.individuals.push(
          this.makeIndividual(species, 'adult', baseX + this.random.between(-0.015, 0.015), baseY + this.random.between(-0.015, 0.015), height),
        )
      }
      for (let count = speciesSlots.length; count < 2; count += 1) {
        if (species.maxHeight > CANOPY_HEIGHT_METERS) {
          const height = this.random.between(Math.min(5.5, species.maxHeight * 0.42), Math.min(9.6, species.maxHeight * 0.62))
          this.individuals.push(this.makeIndividual(species, 'adult', undefined, undefined, height))
        } else this.individuals.push(this.makeIndividual(species, 'adult'))
      }
      for (let count = 0; count < 4; count += 1) this.individuals.push(this.makeIndividual(species, 'sapling'))
      for (let count = 0; count < 8; count += 1) this.individuals.push(this.makeIndividual(species, 'seedling'))
      for (let count = 0; count < 4; count += 1) this.individuals.push(this.makeIndividual(species, 'seed'))
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
    const heightRanges: Record<Stage, [number, number]> = {
      seed: [0.01, 0.02],
      seedling: [0.08, Math.min(1.2, species.maxHeight * 0.08)],
      sapling: [Math.min(1.1, species.maxHeight * 0.12), species.maxHeight * 0.36],
      adult: [species.maxHeight * 0.48, species.maxHeight * 0.92],
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
      x: x ?? this.random.between(0.02, 0.98),
      y: y ?? this.random.between(0.025, 0.975),
      stage,
      ageYears: this.random.between(minAge, maxAge),
      height,
      dbh: stageIndex === 0 ? 0 : Math.max(0.2, height * this.random.between(1.25, 2.05)),
      health: this.random.between(healthFloor, 0.95),
      canopy: false,
      transplanted: false,
      pathogenPressure: 0,
      competitionPressure: 0,
      insectPressure: 0,
      riskScore: 0,
      deathCause: null,
    }
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
      this.updateDominanceAndPest(this.nextHistoryYear)
      this.nextHistoryYear += 1
    }
    while (this.forestYear + 1e-6 >= this.nextSnapshotYear) {
      this.recordAllIndividuals(this.nextSnapshotYear)
      this.nextSnapshotYear += 2
    }
    if (this.population(this.playerCode).length === 0) {
      this.paused = true
      this.report = this.buildOutcomeReport(true)
      return
    }
    if (!this.firstCheckpointShown && this.forestYear >= FIRST_CHECKPOINT_YEAR) {
      this.firstCheckpointShown = true
      this.paused = true
      this.report = this.buildOutcomeReport(false)
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
        const heightGain = perIndividual * state.species.maxHeight * 0.028 * response * stageBoost * competitionModifier
        individual.height = Math.min(state.species.maxHeight, individual.height + heightGain)
        individual.dbh += heightGain * 1.55
      }
    }
    state.reproductionCredit += reproductionPool
    const adults = population.filter((individual) => individual.stage === 'adult')
    let seedsToCreate = Math.min(6, Math.floor(state.reproductionCredit / 4.2))
    if (this.individuals.length >= MAX_INDIVIDUALS || adults.length === 0) seedsToCreate = 0
    state.reproductionCredit -= seedsToCreate * 4.2
    for (let count = 0; count < seedsToCreate; count += 1) this.createSeed(state.species, this.random.pick(adults))
    if (shortageRatio > 0) {
      for (const individual of population) this.damage(individual, shortageRatio * 0.035, 'carbon')
    } else if (state.reserve > Math.max(5, population.length * 0.18)) {
      const damaged = population.filter((individual) => individual.health < 0.9)
      const repairPerIndividual = 0.0015
      const repairCost = Math.min(state.reserve, damaged.length * repairPerIndividual)
      state.reserve -= repairCost
      for (const individual of damaged) individual.health = Math.min(0.92, individual.health + repairPerIndividual)
    }
  }

  private createSeed(species: Species, mother: Individual): void {
    if (this.individuals.length >= MAX_INDIVIDUALS) return
    const distance = this.dispersalDistance(species.strategy)
    const angle = this.random.between(0, Math.PI * 2)
    const radius = Math.sqrt(this.random.next()) * distance
    const seed = this.makeIndividual(
      species,
      'seed',
      Math.max(0.01, Math.min(0.99, mother.x + Math.cos(angle) * radius)),
      Math.max(0.01, Math.min(0.99, mother.y + Math.sin(angle) * radius)),
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
        const establishment =
          this.establishmentChance(individual.species.strategy, light) *
          (1 - individual.pathogenPressure * 0.65) *
          (1 - individual.competitionPressure * 0.7)
        if (this.random.next() < establishment) {
          individual.stage = 'seedling'
          individual.height = 0.08
          individual.dbh = 0.2
          individual.health = 0.72
          this.recordIndividual(individual, true)
        } else if (individual.ageYears > 4 || this.random.next() < 0.012 + individual.pathogenPressure * 0.018) {
          this.damage(individual, 2, 'seed_failure')
        }
        individual.riskScore = Math.max(individual.pathogenPressure, individual.competitionPressure)
        continue
      }
      const previousStage = individual.stage
      if (individual.stage === 'seedling' && individual.height >= Math.min(1.2, individual.species.maxHeight * 0.09)) individual.stage = 'sapling'
      if (individual.stage === 'sapling' && individual.height >= individual.species.maxHeight * 0.42) individual.stage = 'adult'
      if (individual.stage !== previousStage) this.recordIndividual(individual, true)

      const lightEffect = this.lightHealthEffect(individual.species.strategy, light)
      if (lightEffect < 0) this.damage(individual, -lightEffect, 'light')
      else individual.health = Math.min(0.95, individual.health + lightEffect)
      const defense = this.states.get(individual.species.code)!.defenseUntil > this.forestYear ? 0.5 : 1
      const competitionDamage = { seedling: 0.0025, sapling: 0.0015, adult: 0.0008 }[individual.stage]
      const pathogenDamage = { seedling: 0.0035, sapling: 0.0022, adult: 0.001 }[individual.stage]
      this.damage(individual, individual.competitionPressure * competitionDamage, 'competition')
      this.damage(individual, individual.pathogenPressure * pathogenDamage * defense, 'pathogen')
      if (individual.insectPressure > 0) this.damage(individual, individual.insectPressure * 0.0018 * defense, 'insect')
      if (individual.ageYears > 95 && this.random.next() < 0.008) this.damage(individual, 2, 'senescence')
      if (individual.stage === 'adult' && this.random.next() < 0.00025) this.damage(individual, 2, 'senescence')
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
      const crown = this.crownRadius(tree.height)
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
          this.lightGrid[gridIndex] = Math.max(0.045, this.lightGrid[gridIndex] * (1 - opacity * weight))
        }
      }
    }
    this.lightRevision += 1
  }

  private crownRadius(height: number): number {
    return Math.max(0.09, Math.min(0.15, 0.09 + (height - CANOPY_HEIGHT_METERS) * 0.0025))
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
      this.addEvent(type === 'typhoon' ? '台风预警：局部高树风险上升。' : '暴雨预警：全图个体将受到健康冲击。', 'warning', 'disturbance')
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
      this.addEvent(`台风经过：${deaths} 棵冠层树倒伏，局部林窗形成。`, deaths > 0 ? 'bad' : 'neutral', 'disturbance')
    } else {
      for (const individual of this.individuals) {
        const state = this.states.get(individual.species.code)!
        const buffer = Math.min(0.035, state.reserve / Math.max(1, this.population(individual.species.code).length) * 0.012)
        const base = { seed: 0.04, seedling: 0.09, sapling: 0.06, adult: 0.04 }[individual.stage]
        this.damage(individual, Math.max(0.015, base - buffer), 'rainstorm')
      }
      this.addEvent(`暴雨席卷全图：${this.individuals.length} 个体健康下降。`, 'bad', 'disturbance')
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
        this.addEvent(`专性虫害预警：${species.name} 长期占据优势，三年后可能暴发。`, 'warning', 'pest')
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
    this.addEvent(`专性虫害暴发：${target.name} 死亡 ${deaths} 个体，优势格局被打破。`, 'bad', 'pest')
    this.lastPestOutbreakYear = this.forestYear
    this.pestCooldownUntil = this.forestYear + 15
    this.dominanceYears.set(target.code, 0)
    this.pestWarning = null
  }

  private lightResponse(strategy: Strategy, light: number): number {
    if (strategy === 'sun') return Math.max(0.04, (light - 0.1) * 1.34)
    if (strategy === 'shade') return 0.3 + light * 0.58
    return 0.16 + light * 0.91
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
    if (light < 0.12) return -0.003
    if (light > 0.92) return -0.0025
    if (light >= 0.2 && light <= 0.8) return 0.0005
    return 0
  }

  private establishmentChance(strategy: Strategy, light: number): number {
    if (strategy === 'sun') return light > 0.5 ? 0.075 + light * 0.06 : 0.003
    if (strategy === 'shade') return 0.026 + (1 - Math.abs(light - 0.3)) * 0.042
    return 0.025 + light * 0.048
  }

  private dispersalDistance(strategy: Strategy): number {
    if (strategy === 'sun') return 0.105
    if (strategy === 'shade') return 0.064
    return 0.082
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
    for (const species of this.activeSpecies) {
      const population = this.population(species.code)
      const state = this.states.get(species.code)!
      this.speciesHistory.push({
        time,
        speciesCode: species.code,
        total: population.length,
        seeds: population.filter((individual) => individual.stage === 'seed').length,
        seedlings: population.filter((individual) => individual.stage === 'seedling').length,
        saplings: population.filter((individual) => individual.stage === 'sapling').length,
        adults: population.filter((individual) => individual.stage === 'adult').length,
        canopy: population.filter((individual) => individual.canopy).length,
        reserve: state.reserve,
        income: state.income,
        averageHealth: this.average(population.map((individual) => individual.health)),
        share: population.length / totalCommunity,
      })
    }
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

  private buildOutcomeReport(terminal: boolean): OutcomeReport {
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
    if (terminal) outcome = '终局：玩家物种灭绝'
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
        `碳储备 ${this.playerState.reserve.toFixed(1)} · 当前收入 ${this.playerState.income.toFixed(1)}`,
        `过去 10 年死亡 ${recentDeaths.length} 个体${dominantCause ? `，主要为${this.deathCauseLabel(dominantCause)}` : ''}`,
      ],
      drivers,
      strategyImpacts,
      futureRisks,
      turningPoints: this.events.slice(-8).reverse(),
      terminal,
      year,
    }
  }

  private dominantDeathCause(records: DeathRecord[]): DeathCause | null {
    if (records.length === 0) return null
    const counts = new Map<DeathCause, number>()
    for (const record of records) counts.set(record.cause, (counts.get(record.cause) ?? 0) + 1)
    return [...counts.entries()].sort((first, second) => second[1] - first[1])[0][0]
  }

  private addEvent(message: string, tone: EventEntry['tone'], category: EventEntry['category']): void {
    this.events.push({ time: this.forestYear, message, tone, category })
  }

  private average(values: number[]): number {
    return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
  }
}
