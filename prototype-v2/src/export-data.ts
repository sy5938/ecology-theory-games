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
      'time_year', 'species_code', 'total', 'seeds', 'seedlings', 'saplings', 'adults', 'canopy',
      'carbon_reserve', 'carbon_income', 'average_health', 'community_share',
    ],
    simulation.speciesHistory.map((record) => [
      record.time.toFixed(2), record.speciesCode, record.total, record.seeds, record.seedlings, record.saplings,
      record.adults, record.canopy, record.reserve.toFixed(3), record.income.toFixed(3),
      record.averageHealth.toFixed(4), record.share.toFixed(4),
    ]),
  )
  const events = csv(
    ['time_year', 'category', 'tone', 'message'],
    simulation.events.map((event) => [event.time.toFixed(2), event.category, event.tone, event.message]),
  )
  const report = simulation.report ?? simulation.createOutcomeReport()
  const metadata = {
    prototype: '像森林一样思考 V3',
    scenario: simulation.scenarioId,
    scenarioName: SCENARIOS[simulation.scenarioId].name,
    playerSpecies: simulation.playerSpecies,
    activeSpecies: simulation.activeSpecies,
    randomSeed: simulation.seed,
    exportedAtYear: simulation.forestYear,
    mapMeters: { width: simulation.mapWidthMeters, height: simulation.mapHeightMeters },
    canopyThresholdMeters: 10,
    individualSnapshotCadenceYears: 2,
    coordinateUnits: 'meters',
  }
  const archive = zipSync(
    {
      'individual_snapshots.csv': strToU8(snapshots),
      'species_history.csv': strToU8(speciesHistory),
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
