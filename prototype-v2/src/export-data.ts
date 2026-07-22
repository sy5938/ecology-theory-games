import { strToU8, zipSync } from 'fflate'
import { SCENARIOS, type ForestSimulation } from './simulation'

const csvCell = (value: string | number | boolean): string => {
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

const csv = (header: string[], rows: Array<Array<string | number | boolean>>): string =>
  `\ufeff${header.map(csvCell).join(',')}\n${rows.map((row) => row.map(csvCell).join(',')).join('\n')}`

export function createExportArchive(simulation: ForestSimulation): Blob {
  const snapshots = csv(
    [
      'time_year', 'individual_id', 'x_m', 'y_m', 'species_code', 'species_name', 'strategy', 'stage',
      'alive', 'height_m', 'dbh_cm', 'health', 'local_light', 'competition_pressure', 'pathogen_pressure',
      'insect_pressure', 'carbon_reserve', 'death_cause',
    ],
    simulation.individualSnapshots.map((record) => [
      record.time.toFixed(2),
      record.individualId,
      (record.x * simulation.mapWidthMeters).toFixed(3),
      (record.y * simulation.mapHeightMeters).toFixed(3),
      record.speciesCode,
      record.speciesName,
      record.strategy,
      record.stage,
      record.alive,
      record.height.toFixed(3),
      record.dbh.toFixed(3),
      record.health.toFixed(4),
      record.localLight.toFixed(4),
      record.competitionPressure.toFixed(4),
      record.pathogenPressure.toFixed(4),
      record.insectPressure.toFixed(4),
      record.carbonReserve.toFixed(3),
      record.deathCause,
    ]),
  )
  const speciesHistory = csv(
    [
      'time_year', 'species_code', 'strategy', 'starting_population', 'total', 'births', 'deaths',
      'births_per_100', 'deaths_per_100', 'seeds', 'seedlings', 'saplings', 'adults', 'canopy',
      'average_height_m', 'average_dbh_cm', 'basal_area_m2',
      'carbon_reserve', 'gross_carbon_income', 'annual_carbon_sequestered',
      'cumulative_carbon_sequestered', 'average_health', 'community_share',
    ],
    simulation.speciesHistory.map((record) => [
      record.time.toFixed(2), record.speciesCode, record.strategy, record.startingPopulation, record.total,
      record.births, record.deaths, record.birthsPer100.toFixed(4), record.deathsPer100.toFixed(4),
      record.seeds, record.seedlings, record.saplings, record.adults, record.canopy,
      record.averageHeight.toFixed(3), record.averageDbh.toFixed(3), record.basalAreaM2.toFixed(4),
      record.reserve.toFixed(3), record.income.toFixed(3),
      record.annualCarbonSequestered.toFixed(3), record.cumulativeCarbonSequestered.toFixed(3),
      record.averageHealth.toFixed(4), record.share.toFixed(4),
    ]),
  )
  const functionalTypeHistory = csv(
    [
      'time_year', 'strategy', 'starting_population', 'total', 'births', 'deaths', 'births_per_100',
      'deaths_per_100', 'seeds', 'seedlings', 'saplings', 'adults', 'canopy', 'species_richness',
      'basal_area_m2', 'annual_carbon_sequestered', 'cumulative_carbon_sequestered',
    ],
    simulation.functionalTypeHistory.map((record) => [
      record.time.toFixed(2), record.strategy, record.startingPopulation, record.total, record.births,
      record.deaths, record.birthsPer100.toFixed(4), record.deathsPer100.toFixed(4), record.seeds,
      record.seedlings, record.saplings, record.adults, record.canopy, record.speciesRichness,
      record.basalAreaM2.toFixed(4), record.annualCarbonSequestered.toFixed(3),
      record.cumulativeCarbonSequestered.toFixed(3),
    ]),
  )
  const communityHistory = csv(
    [
      'time_year', 'starting_population', 'total', 'births', 'deaths', 'births_per_100', 'deaths_per_100',
      'seeds', 'seedlings', 'saplings', 'adults', 'canopy', 'species_richness',
      'canopy_cover', 'gross_carbon_income', 'annual_carbon_sequestered',
      'cumulative_carbon_sequestered', 'average_health', 'average_height_m', 'average_dbh_cm',
      'basal_area_m2', 'shannon_diversity', 'simpson_diversity', 'evenness',
    ],
    simulation.communityHistory.map((record) => [
      record.time.toFixed(2), record.startingPopulation, record.total, record.births, record.deaths,
      record.birthsPer100.toFixed(4), record.deathsPer100.toFixed(4), record.seeds, record.seedlings,
      record.saplings, record.adults,
      record.canopy, record.speciesRichness, record.canopyCover.toFixed(4), record.grossCarbonIncome.toFixed(3),
      record.annualCarbonSequestered.toFixed(3), record.cumulativeCarbonSequestered.toFixed(3),
      record.averageHealth.toFixed(4), record.averageHeight.toFixed(3), record.averageDbh.toFixed(3),
      record.basalAreaM2.toFixed(4), record.shannonDiversity.toFixed(4), record.simpsonDiversity.toFixed(4),
      record.evenness.toFixed(4),
    ]),
  )
  const events = csv(
    ['time_year', 'priority', 'category', 'tone', 'message'],
    simulation.events.map((event) => [event.time.toFixed(2), event.priority, event.category, event.tone, event.message]),
  )
  const report = simulation.report ?? simulation.createOutcomeReport()
  const metadata = {
    schemaVersion: '4.1',
    prototype: '像森林一样思考 V3',
    scenario: simulation.scenarioId,
    scenarioName: SCENARIOS[simulation.scenarioId].name,
    playerSpecies: simulation.playerSpecies,
    activeSpecies: simulation.activeSpecies,
    randomSeed: simulation.seed,
    exportedAtYear: simulation.forestYear,
    initialDensityPer400m2: simulation.densityPer400m2,
    initialCommunitySize: simulation.initialCommunitySize,
    currentCommunitySize: simulation.individuals.length,
    averageDbhCm: simulation.averageDbh(),
    basalAreaM2: simulation.basalArea(),
    mapMeters: { width: simulation.mapWidthMeters, height: simulation.mapHeightMeters },
    canopyThresholdMeters: 10,
    individualSnapshotCadenceYears: 2,
    coordinateUnits: 'meters',
    coordinateOrigin: 'lower-left',
    carbonUnits: 'game-carbon-units',
  }
  const archive = zipSync(
    {
      'individual_snapshots.csv': strToU8(snapshots),
      'species_history.csv': strToU8(speciesHistory),
      'functional_type_history.csv': strToU8(functionalTypeHistory),
      'community_history.csv': strToU8(communityHistory),
      'events.csv': strToU8(events),
      'report.json': strToU8(JSON.stringify(report, null, 2)),
      'metadata.json': strToU8(JSON.stringify(metadata, null, 2)),
    },
    { level: 6 },
  )
  const bytes = Uint8Array.from(archive)
  return new Blob([bytes.buffer], { type: 'application/zip' })
}

export function downloadExportArchive(simulation: ForestSimulation): void {
  const blob = createExportArchive(simulation)
  const link = document.createElement('a')
  const year = Math.max(0, Math.round(simulation.forestYear))
  link.href = URL.createObjectURL(blob)
  link.download = `forest-${simulation.scenarioId}-year-${year}.zip`
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1000)
}
