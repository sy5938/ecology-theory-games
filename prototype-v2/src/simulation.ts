import type { Species, Strategy } from './species'

export type Stage = 'seed' | 'seedling' | 'sapling' | 'adult'
export type AllocationKey = 'growth' | 'reproduction' | 'reserve'

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
}

export interface TransplantResult {
  ok: boolean
  message: string
}

interface SpeciesState {
  species: Species
  allocation: Allocation
  reserve: number
  income: number
  maintenance: number
  surplus: number
  reproductionCredit: number
}

export interface DisturbanceWarning {
  x: number
  y: number
  radius: number
  happensAt: number
}

export interface HistorySample {
  time: number
  total: number
  adults: number
  reserve: number
  income: number
}

export interface EventEntry {
  time: number
  message: string
  tone: 'neutral' | 'warning' | 'good' | 'bad'
}

export interface OutcomeReport {
  title: string
  summary: string
  details: string[]
  terminal: boolean
}

const STAGES: Stage[] = ['seed', 'seedling', 'sapling', 'adult']
const FIXED_STEP_SECONDS = 0.5
const MAP_WIDTH = 48
const MAP_HEIGHT = 32
const MAX_INDIVIDUALS = 820

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
  readonly width = MAP_WIDTH
  readonly height = MAP_HEIGHT
  readonly playerCode: string
  readonly activeSpecies: Species[]
  readonly states = new Map<string, SpeciesState>()
  readonly history: HistorySample[] = []
  readonly events: EventEntry[] = []

  individuals: Individual[] = []
  lightGrid = new Float32Array(MAP_WIDTH * MAP_HEIGHT)
  warning: DisturbanceWarning | null = null
  report: OutcomeReport | null = null
  timeSeconds = 0
  speed = 1
  paused = false
  revision = 0

  private readonly random: SeededRandom
  private nextId = 1
  private accumulator = 0
  private nextHistoryAt = 0
  private nextCheckpointAt = 180
  private nextDisturbanceAt: number
  private warningIssued = false

  constructor(allSpecies: Species[], playerCode: string, seed = Date.now() & 0xffffffff) {
    this.random = new SeededRandom(seed)
    this.playerCode = playerCode
    this.activeSpecies = this.chooseSpecies(allSpecies, playerCode)
    this.nextDisturbanceAt = this.random.between(38, 55)

    for (const species of this.activeSpecies) {
      this.states.set(species.code, {
        species,
        allocation: this.defaultAllocation(species.strategy),
        reserve: species.code === playerCode ? 28 : this.random.between(20, 34),
        income: 0,
        maintenance: 0,
        surplus: 0,
        reproductionCredit: this.random.between(0, 3),
      })
    }

    this.seedClosedCanopyForest()
    this.recalculateCanopyAndLight()
    this.addEvent('密闭林冠群落开始演化。先观察，再调整投资。', 'neutral')
    this.sampleHistory()
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
    )
  }

  update(realDeltaSeconds: number): void {
    if (this.paused || this.report?.terminal) return
    this.accumulator += Math.min(realDeltaSeconds, 0.1) * this.speed
    while (this.accumulator >= FIXED_STEP_SECONDS) {
      this.step(FIXED_STEP_SECONDS)
      this.accumulator -= FIXED_STEP_SECONDS
    }
  }

  lightAt(x: number, y: number): number {
    const gx = Math.max(0, Math.min(MAP_WIDTH - 1, Math.floor(x * MAP_WIDTH)))
    const gy = Math.max(0, Math.min(MAP_HEIGHT - 1, Math.floor(y * MAP_HEIGHT)))
    return this.lightGrid[gy * MAP_WIDTH + gx]
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
      this.addEvent(result.message, 'warning')
      return result
    }

    const nextX = Math.max(0.015, Math.min(0.985, x))
    const nextY = Math.max(0.02, Math.min(0.98, y))
    const occupied = this.individuals.some(
      (other) => other.id !== id && Math.hypot(other.x - nextX, other.y - nextY) < 0.012,
    )
    if (occupied) {
      const result = { ok: false, message: '落点过于拥挤，请选择更空旷的位置。' }
      this.addEvent(result.message, 'warning')
      return result
    }

    const oldLight = this.lightAt(individual.x, individual.y)
    individual.x = nextX
    individual.y = nextY
    individual.transplanted = true
    individual.health = Math.max(0.35, individual.health - 0.04)
    const newLight = this.lightAt(nextX, nextY)
    const message = `移栽 ${individual.species.name}：光照 ${Math.round(oldLight * 100)}% → ${Math.round(newLight * 100)}%，健康付出 4%。`
    this.addEvent(message, newLight >= oldLight ? 'good' : 'neutral')
    this.revision += 1
    return { ok: true, message }
  }

  continueAfterReport(): void {
    if (this.report?.terminal) return
    this.report = null
    this.paused = false
    this.nextCheckpointAt += 180
    this.addEvent('继续演化：下一次结算将在三分钟后出现。', 'neutral')
  }

  stageLabel(stage: Stage): string {
    return { seed: '种子', seedling: '幼苗', sapling: '幼树', adult: '成树' }[stage]
  }

  private chooseSpecies(allSpecies: Species[], playerCode: string): Species[] {
    const player = allSpecies.find((species) => species.code === playerCode) ?? allSpecies[0]
    const selected = [player]
    const strategies: Strategy[] = ['sun', 'shade', 'broad']

    for (const strategy of strategies) {
      if (selected.some((species) => species.strategy === strategy)) continue
      const candidates = allSpecies.filter(
        (species) => species.strategy === strategy && !selected.includes(species),
      )
      selected.push(this.random.pick(candidates))
    }

    while (selected.length < 6) {
      const candidates = allSpecies.filter((species) => !selected.includes(species))
      selected.push(this.random.pick(candidates))
    }
    return selected
  }

  private defaultAllocation(strategy: Strategy): Allocation {
    if (strategy === 'sun') return { growth: 0.52, reproduction: 0.34, reserve: 0.14 }
    if (strategy === 'shade') return { growth: 0.25, reproduction: 0.22, reserve: 0.53 }
    return { growth: 0.38, reproduction: 0.3, reserve: 0.32 }
  }

  private seedClosedCanopyForest(): void {
    for (const species of this.activeSpecies) {
      for (let index = 0; index < 42; index += 1) {
        const stage: Stage = index < 10 ? 'adult' : index < 20 ? 'sapling' : index < 34 ? 'seedling' : 'seed'
        this.individuals.push(this.makeIndividual(species, stage))
      }
    }
  }

  private makeIndividual(species: Species, stage: Stage, x?: number, y?: number): Individual {
    const stageIndex = STAGES.indexOf(stage)
    const heightRanges: Record<Stage, [number, number]> = {
      seed: [0.01, 0.02],
      seedling: [0.08, Math.min(1.2, species.maxHeight * 0.08)],
      sapling: [Math.min(1.1, species.maxHeight * 0.12), species.maxHeight * 0.36],
      adult: [species.maxHeight * 0.48, species.maxHeight * 0.92],
    }
    const [minHeight, maxHeight] = heightRanges[stage]
    const ageRanges: Record<Stage, [number, number]> = {
      seed: [0, 2],
      seedling: [0.5, 4],
      sapling: [3, 12],
      adult: [12, 75],
    }
    const [minAge, maxAge] = ageRanges[stage]
    const height = this.random.between(minHeight, Math.max(minHeight + 0.01, maxHeight))
    return {
      id: this.nextId++,
      species,
      x: x ?? this.random.between(0.025, 0.975),
      y: y ?? this.random.between(0.035, 0.965),
      stage,
      ageYears: this.random.between(minAge, maxAge),
      height,
      dbh: stageIndex === 0 ? 0 : Math.max(0.2, height * this.random.between(1.25, 2.05)),
      health: this.random.between(0.82, 1),
      canopy: false,
      transplanted: false,
    }
  }

  private step(deltaSeconds: number): void {
    this.timeSeconds += deltaSeconds
    this.updateWarningAndDisturbance()
    this.updateAiAllocations()
    this.recalculateCanopyAndLight()

    for (const state of this.states.values()) {
      this.applyBudgetAndGrowth(state, deltaSeconds)
    }

    this.applyEstablishmentAndMortality(deltaSeconds)
    this.individuals = this.individuals.filter((individual) => individual.health > 0)
    this.recalculateCanopyAndLight()
    this.revision += 1

    if (this.timeSeconds >= this.nextHistoryAt) {
      this.sampleHistory()
      this.nextHistoryAt = Math.floor(this.timeSeconds) + 1
    }

    if (this.population(this.playerCode).length === 0) {
      this.paused = true
      this.report = {
        title: '种群灭绝',
        summary: `${this.playerSpecies.name} 没有留下任何存活阶段。`,
        details: ['碳收入已经无法覆盖基础维持。', '重新开始后可尝试更早增加储备。'],
        terminal: true,
      }
      return
    }

    if (this.timeSeconds >= this.nextCheckpointAt && !this.report) {
      this.paused = true
      this.report = this.buildOutcomeReport()
    }
  }

  private updateAiAllocations(): void {
    for (const state of this.states.values()) {
      if (state.species.code === this.playerCode) continue
      const individuals = this.population(state.species.code)
      const avgLight =
        individuals.length === 0
          ? 0
          : individuals.reduce((sum, individual) => sum + this.lightAt(individual.x, individual.y), 0) /
            individuals.length

      if (this.warning) {
        state.allocation =
          state.species.strategy === 'sun'
            ? { growth: 0.2, reproduction: 0.16, reserve: 0.64 }
            : { growth: 0.18, reproduction: 0.14, reserve: 0.68 }
      } else if (state.species.strategy === 'sun') {
        state.allocation =
          avgLight > 0.52
            ? { growth: 0.56, reproduction: 0.34, reserve: 0.1 }
            : { growth: 0.24, reproduction: 0.18, reserve: 0.58 }
      } else if (state.species.strategy === 'shade') {
        state.allocation =
          avgLight < 0.38
            ? { growth: 0.22, reproduction: 0.2, reserve: 0.58 }
            : { growth: 0.34, reproduction: 0.27, reserve: 0.39 }
      } else {
        state.allocation = { growth: 0.38, reproduction: 0.3, reserve: 0.32 }
      }
    }
  }

  private applyBudgetAndGrowth(state: SpeciesState, deltaSeconds: number): void {
    const population = this.population(state.species.code)
    const active = population.filter((individual) => individual.stage !== 'seed')
    const monthFactor = deltaSeconds / FIXED_STEP_SECONDS

    state.income = active.reduce((sum, individual) => {
      const light = this.lightAt(individual.x, individual.y)
      const leafScale = { seedling: 0.13, sapling: 0.48, adult: 1 }[individual.stage as Exclude<Stage, 'seed'>]
      const structure = 0.45 + 0.55 * Math.min(1, individual.height / (individual.species.maxHeight * 0.55))
      return sum + leafScale * structure * this.lightResponse(state.species.strategy, light) * 0.92
    }, 0) * monthFactor

    state.maintenance = population.reduce(
      (sum, individual) => sum + { seed: 0.003, seedling: 0.028, sapling: 0.115, adult: 0.28 }[individual.stage],
      0,
    ) * monthFactor

    let available = state.income - state.maintenance
    let shortageRatio = 0
    if (available < 0) {
      const deficit = -available
      const covered = Math.min(deficit, state.reserve)
      state.reserve -= covered
      const uncovered = deficit - covered
      shortageRatio = state.maintenance > 0 ? uncovered / state.maintenance : 0
      available = 0
    }

    state.surplus = available
    const growthPool = available * state.allocation.growth
    const reproductionPool = available * state.allocation.reproduction
    state.reserve = Math.min(240, state.reserve + available * state.allocation.reserve)

    if (active.length > 0 && growthPool > 0) {
      const perIndividual = growthPool / active.length
      for (const individual of active) {
        const light = this.lightAt(individual.x, individual.y)
        const response = this.lightResponse(state.species.strategy, light)
        const stageBoost = individual.stage === 'adult' ? 0.28 : individual.stage === 'sapling' ? 0.75 : 1
        const heightGain = perIndividual * state.species.maxHeight * 0.028 * response * stageBoost
        individual.height = Math.min(state.species.maxHeight, individual.height + heightGain)
        individual.dbh += heightGain * 1.55
      }
    }

    state.reproductionCredit += reproductionPool
    const adults = population.filter((individual) => individual.stage === 'adult')
    let seedsToCreate = Math.min(6, Math.floor(state.reproductionCredit / 4.2))
    if (this.individuals.length >= MAX_INDIVIDUALS || adults.length === 0) seedsToCreate = 0
    state.reproductionCredit -= seedsToCreate * 4.2
    for (let count = 0; count < seedsToCreate; count += 1) {
      const mother = this.random.pick(adults)
      const distance = this.dispersalDistance(state.species.strategy)
      const angle = this.random.between(0, Math.PI * 2)
      const radius = Math.sqrt(this.random.next()) * distance
      const x = Math.max(0.01, Math.min(0.99, mother.x + Math.cos(angle) * radius))
      const y = Math.max(0.01, Math.min(0.99, mother.y + Math.sin(angle) * radius))
      this.individuals.push(this.makeIndividual(state.species, 'seed', x, y))
    }

    if (shortageRatio > 0) {
      for (const individual of population) {
        individual.health -= shortageRatio * (individual.stage === 'adult' ? 0.03 : 0.05)
      }
    } else if (state.reserve > Math.max(5, population.length * 0.18)) {
      const damaged = population.filter((individual) => individual.health < 0.96)
      const repairCost = Math.min(state.reserve, damaged.length * 0.016)
      state.reserve -= repairCost
      for (const individual of damaged) individual.health = Math.min(1, individual.health + 0.016)
    }
  }

  private applyEstablishmentAndMortality(deltaSeconds: number): void {
    const monthFactor = deltaSeconds / FIXED_STEP_SECONDS
    for (const individual of this.individuals) {
      individual.ageYears += monthFactor / 12
      const light = this.lightAt(individual.x, individual.y)
      const sameSpeciesNeighbors = this.individuals.filter(
        (other) =>
          other.id !== individual.id &&
          other.species.code === individual.species.code &&
          Math.hypot(other.x - individual.x, other.y - individual.y) < 0.042,
      ).length

      if (individual.stage === 'seed') {
        const establish = this.establishmentChance(individual.species.strategy, light)
        if (this.random.next() < establish * monthFactor) {
          individual.stage = 'seedling'
          individual.height = 0.08
          individual.dbh = 0.2
          individual.health = 0.82
        } else if (individual.ageYears > 4 || this.random.next() < 0.012 * monthFactor) {
          individual.health = 0
        }
        continue
      }

      if (individual.stage === 'seedling' && individual.height >= Math.min(1.2, individual.species.maxHeight * 0.09)) {
        individual.stage = 'sapling'
      }
      if (individual.stage === 'sapling' && individual.height >= individual.species.maxHeight * 0.42) {
        individual.stage = 'adult'
      }

      const strategy = individual.species.strategy
      if (strategy === 'sun' && light < 0.23) individual.health -= (0.006 + (0.23 - light) * 0.032) * monthFactor
      if (strategy === 'shade' && light > 0.92) individual.health -= 0.004 * monthFactor
      if (strategy === 'broad' && light < 0.09) individual.health -= 0.006 * monthFactor

      if (sameSpeciesNeighbors > 6) {
        const vulnerability = individual.stage === 'seedling' ? 1.25 : individual.stage === 'sapling' ? 0.8 : 0.4
        individual.health -= (sameSpeciesNeighbors - 6) * 0.0015 * vulnerability * monthFactor
      }

      if (individual.ageYears > 95 && this.random.next() < 0.008 * monthFactor) individual.health = 0
      if (individual.stage === 'adult' && this.random.next() < 0.00025 * monthFactor) individual.health = 0
    }
  }

  private recalculateCanopyAndLight(): void {
    const adults = this.individuals.filter((individual) => individual.stage === 'adult')
    for (const individual of this.individuals) individual.canopy = false
    for (const individual of adults) {
      const blocked = adults.some(
        (other) =>
          other.id !== individual.id &&
          other.height > individual.height * 1.06 &&
          Math.hypot(other.x - individual.x, other.y - individual.y) < 0.085,
      )
      individual.canopy = !blocked
    }

    const canopy = adults.filter((individual) => individual.canopy)
    for (let gy = 0; gy < MAP_HEIGHT; gy += 1) {
      for (let gx = 0; gx < MAP_WIDTH; gx += 1) {
        const x = (gx + 0.5) / MAP_WIDTH
        const y = (gy + 0.5) / MAP_HEIGHT
        let light = 0.93 - x * 0.055 + Math.sin(gx * 1.71 + gy * 0.63) * 0.018
        for (const tree of canopy) {
          const crown = 0.055 + 0.06 * Math.sqrt(tree.height / tree.species.maxHeight)
          const distance = Math.hypot(x - tree.x, y - tree.y)
          if (distance >= crown) continue
          const weight = 1 - distance / crown
          const opacity = 0.56 + 0.34 * (tree.height / tree.species.maxHeight)
          light *= 1 - opacity * weight
        }
        this.lightGrid[gy * MAP_WIDTH + gx] = Math.max(0.055, Math.min(0.96, light))
      }
    }
  }

  private updateWarningAndDisturbance(): void {
    if (!this.warningIssued && this.timeSeconds >= this.nextDisturbanceAt - 10) {
      this.warning = {
        x: this.random.between(0.18, 0.82),
        y: this.random.between(0.2, 0.8),
        radius: this.random.between(0.13, 0.19),
        happensAt: this.nextDisturbanceAt,
      }
      this.warningIssued = true
      this.addEvent('台风预警：模糊影响区已经出现。没有专用按钮，只能重新平衡。', 'warning')
    }

    if (this.warning && this.timeSeconds >= this.warning.happensAt) {
      const warning = this.warning
      const affected = this.individuals.filter(
        (individual) =>
          individual.stage === 'adult' &&
          individual.canopy &&
          Math.hypot(individual.x - warning.x, individual.y - warning.y) < warning.radius,
      )
      let deaths = 0
      for (const individual of affected) {
        const state = this.states.get(individual.species.code)!
        const populationSize = Math.max(1, this.population(individual.species.code).length)
        const reserveBuffer = Math.min(0.16, state.reserve / populationSize / 35)
        const heightRisk = 0.28 * (individual.height / individual.species.maxHeight)
        if (this.random.next() < 0.32 + heightRisk - reserveBuffer) {
          individual.health = 0
          deaths += 1
        } else {
          individual.health = Math.max(0.22, individual.health - 0.28)
        }
      }
      this.addEvent(`台风经过：${deaths} 棵林冠树倒伏，局部林下光照升高。`, deaths > 0 ? 'bad' : 'neutral')
      this.warning = null
      this.warningIssued = false
      this.nextDisturbanceAt = this.timeSeconds + this.random.between(48, 72)
    }
  }

  private lightResponse(strategy: Strategy, light: number): number {
    if (strategy === 'sun') return Math.max(0.06, (light - 0.1) * 1.34)
    if (strategy === 'shade') return 0.31 + light * 0.58
    return 0.18 + light * 0.91
  }

  private establishmentChance(strategy: Strategy, light: number): number {
    if (strategy === 'sun') return light > 0.5 ? 0.075 + light * 0.06 : 0.004
    if (strategy === 'shade') return 0.026 + (1 - Math.abs(light - 0.3)) * 0.042
    return 0.025 + light * 0.048
  }

  private dispersalDistance(strategy: Strategy): number {
    if (strategy === 'sun') return 0.105
    if (strategy === 'shade') return 0.064
    return 0.082
  }

  private sampleHistory(): void {
    const population = this.population(this.playerCode)
    const state = this.states.get(this.playerCode)!
    this.history.push({
      time: this.timeSeconds,
      total: population.length,
      adults: population.filter((individual) => individual.stage === 'adult').length,
      reserve: state.reserve,
      income: state.income,
    })
    if (this.history.length > 360) this.history.shift()
  }

  private buildOutcomeReport(): OutcomeReport {
    const playerPopulation = this.population(this.playerCode)
    const total = this.individuals.length
    const share = total > 0 ? playerPopulation.length / total : 0
    const adults = playerPopulation.filter((individual) => individual.stage === 'adult').length
    const activeSpecies = this.activeSpecies.filter((species) => this.population(species.code).length > 0).length
    const recent = this.history.slice(-20)
    const trend = recent.length > 1 ? recent[recent.length - 1].total - recent[0].total : 0

    let title = '多物种共存'
    if (share >= 0.48) title = '玩家物种占优势'
    else if (share < 0.08) title = '低位维持'
    else if (trend > 8) title = '扩张阶段'
    else if (trend < -8) title = '衰退阶段'

    return {
      title,
      summary: `${this.playerSpecies.name} 占群落个体 ${Math.round(share * 100)}%，当前仍有 ${activeSpecies} 个物种存活。`,
      details: [
        `存活个体 ${playerPopulation.length} · 成树 ${adults}`,
        `碳储备 ${this.playerState.reserve.toFixed(1)} · 当前碳收入 ${this.playerState.income.toFixed(1)}`,
        trend === 0 ? '最近走势基本稳定。' : `最近走势 ${trend > 0 ? '+' : ''}${trend} 个体。`,
      ],
      terminal: false,
    }
  }

  private addEvent(message: string, tone: EventEntry['tone']): void {
    this.events.unshift({ time: this.timeSeconds, message, tone })
    if (this.events.length > 12) this.events.pop()
  }
}
