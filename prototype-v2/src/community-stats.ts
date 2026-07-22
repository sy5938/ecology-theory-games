import type { ForestSimulation, Individual, SpeciesHistorySample } from './simulation'

export interface StageCounts {
  seeds: number
  seedlings: number
  saplings: number
  adults: number
}

export interface SpeciesStatistics {
  speciesCode: string
  speciesName: string
  total: number
  share: number
  communityShare: number
  stages: StageCounts
  averageHealth: number
  averageHeight: number
  averageDbh: number
  basalAreaM2: number
  canopyCount: number
  canopyShare: number
  grossCarbonIncome: number
  annualCarbonSequestered: number
  cumulativeCarbonSequestered: number
}

export interface CommunityStatistics {
  total: number
  stages: StageCounts
  speciesRichness: number
  averageHealth: number
  averageHeight: number
  averageDbh: number
  basalAreaM2: number
  canopyCount: number
  canopyShare: number
  canopyCover: number
  densityPer400m2: number
  grossCarbonIncome: number
  annualCarbonSequestered: number
  cumulativeCarbonSequestered: number
}

export interface DemographicChange {
  startingPopulation: number
  births: number
  deaths: number
  birthsPer100: number
  deathsPer100: number
}

export interface DiversityMetrics {
  shannonDiversity: number
  simpsonDiversity: number
  evenness: number
}

export function calculateDemographicChange(
  startingPopulation: number,
  endingPopulation: number,
  deaths: number,
): DemographicChange {
  const start = Math.max(0, Math.round(startingPopulation))
  const mortality = Math.max(0, Math.round(deaths))
  const births = Math.max(0, Math.round(endingPopulation) - start + mortality)
  return {
    startingPopulation: start,
    births,
    deaths: mortality,
    birthsPer100: start > 0 ? (births / start) * 100 : 0,
    deathsPer100: start > 0 ? (mortality / start) * 100 : 0,
  }
}

export function calculateDiversityMetrics(speciesCounts: number[]): DiversityMetrics {
  const positiveCounts = speciesCounts.filter((count) => count > 0)
  const total = positiveCounts.reduce((sum, count) => sum + count, 0)
  if (total === 0) return { shannonDiversity: 0, simpsonDiversity: 0, evenness: 0 }
  const proportions = positiveCounts.map((count) => count / total)
  const shannonDiversity = -proportions.reduce((sum, proportion) => sum + proportion * Math.log(proportion), 0)
  return {
    shannonDiversity,
    simpsonDiversity: 1 - proportions.reduce((sum, proportion) => sum + proportion ** 2, 0),
    evenness: positiveCounts.length > 1 ? shannonDiversity / Math.log(positiveCounts.length) : 1,
  }
}

const average = (values: number[]): number =>
  values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0

const stagesFor = (individuals: Individual[]): StageCounts => ({
  seeds: individuals.filter((individual) => individual.stage === 'seed').length,
  seedlings: individuals.filter((individual) => individual.stage === 'seedling').length,
  saplings: individuals.filter((individual) => individual.stage === 'sapling').length,
  adults: individuals.filter((individual) => individual.stage === 'adult').length,
})

const latestSpeciesHistory = (
  history: SpeciesHistorySample[],
  speciesCode: string,
): SpeciesHistorySample | undefined => {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index].speciesCode === speciesCode) return history[index]
  }
  return undefined
}

export function calculateSpeciesStatistics(
  simulation: ForestSimulation,
  speciesCode: string,
): SpeciesStatistics | null {
  const state = simulation.states.get(speciesCode)
  if (!state) return null
  const individuals = simulation.population(speciesCode)
  const stems = individuals.filter((individual) => individual.stage !== 'seed')
  const canopyCount = individuals.filter((individual) => individual.canopy).length
  const latestHistory = latestSpeciesHistory(simulation.speciesHistory, speciesCode)
  const share = simulation.individuals.length > 0 ? individuals.length / simulation.individuals.length : 0
  return {
    speciesCode,
    speciesName: state.species.name,
    total: individuals.length,
    share,
    communityShare: share,
    stages: stagesFor(individuals),
    averageHealth: average(individuals.map((individual) => individual.health)),
    averageHeight: average(stems.map((individual) => individual.height)),
    averageDbh: average(stems.map((individual) => individual.dbh)),
    basalAreaM2: simulation.basalArea(individuals),
    canopyCount,
    canopyShare: individuals.length > 0 ? canopyCount / individuals.length : 0,
    grossCarbonIncome: state.income,
    annualCarbonSequestered: latestHistory?.annualCarbonSequestered ?? 0,
    cumulativeCarbonSequestered: state.cumulativeCarbonSequestered,
  }
}

export function calculateCommunityStatistics(simulation: ForestSimulation): CommunityStatistics {
  const individuals = simulation.individuals
  const stems = individuals.filter((individual) => individual.stage !== 'seed')
  const speciesStatistics = simulation.activeSpecies
    .map((species) => calculateSpeciesStatistics(simulation, species.code))
    .filter((statistics): statistics is SpeciesStatistics => statistics !== null)
  const canopyCount = speciesStatistics.reduce((sum, statistics) => sum + statistics.canopyCount, 0)
  return {
    total: speciesStatistics.reduce((sum, statistics) => sum + statistics.total, 0),
    stages: speciesStatistics.reduce<StageCounts>((total, statistics) => ({
      seeds: total.seeds + statistics.stages.seeds,
      seedlings: total.seedlings + statistics.stages.seedlings,
      saplings: total.saplings + statistics.stages.saplings,
      adults: total.adults + statistics.stages.adults,
    }), { seeds: 0, seedlings: 0, saplings: 0, adults: 0 }),
    speciesRichness: speciesStatistics.filter((statistics) => statistics.total > 0).length,
    averageHealth: average(individuals.map((individual) => individual.health)),
    averageHeight: average(stems.map((individual) => individual.height)),
    averageDbh: average(stems.map((individual) => individual.dbh)),
    basalAreaM2: speciesStatistics.reduce((sum, statistics) => sum + statistics.basalAreaM2, 0),
    canopyCount,
    canopyShare: individuals.length > 0 ? canopyCount / individuals.length : 0,
    canopyCover: simulation.canopyCover(),
    densityPer400m2: simulation.densityPerCurrent400m2(),
    grossCarbonIncome: speciesStatistics.reduce((sum, statistics) => sum + statistics.grossCarbonIncome, 0),
    annualCarbonSequestered: speciesStatistics.reduce(
      (sum, statistics) => sum + statistics.annualCarbonSequestered,
      0,
    ),
    cumulativeCarbonSequestered: speciesStatistics.reduce(
      (sum, statistics) => sum + statistics.cumulativeCarbonSequestered,
      0,
    ),
  }
}
