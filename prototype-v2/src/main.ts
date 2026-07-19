import Phaser from 'phaser'
import * as echarts from 'echarts'
import './style.css'
import { downloadExportArchive } from './export-data'
import { ForestScene, MAP_PIXEL_HEIGHT, MAP_PIXEL_WIDTH } from './forest-scene'
import { gameLayout, setupLayout } from './layouts'
import { SPECIES, STRATEGIES, type Strategy } from './species'
import {
  CANOPY_HEIGHT_METERS,
  RISK_THRESHOLD,
  ForestSimulation,
  type ActiveAbility,
  type Allocation,
  type AllocationKey,
  type Individual,
  type OutcomeReport,
  type ScenarioId,
  type ViewLayer,
} from './simulation'

type Selection = { type: 'individuals'; ids: number[] } | { type: 'cell'; x: number; y: number; light: number } | null
type ChartMode = 'trend' | 'height' | 'selected'

interface SelectedSample {
  time: number
  height: number
  light: number
  health: number
}

const ALLOCATION_PRESETS: Record<string, Allocation> = {
  canopy: { growth: 0.7, reproduction: 0.2, reserve: 0.1 },
  spread: { growth: 0.2, reproduction: 0.65, reserve: 0.15 },
  survive: { growth: 0.2, reproduction: 0.2, reserve: 0.6 },
}

const appRoot = document.querySelector<HTMLDivElement>('#app')!
let selectedStrategy: Strategy = 'sun'
let selectedCode = 'LORCHI'
let selectedScenario: ScenarioId = 'closed'
let simulation: ForestSimulation | null = null
let forestScene: ForestScene | null = null
let game: Phaser.Game | null = null
let chart: echarts.ECharts | null = null
let reportChart: echarts.ECharts | null = null
let chartMode: ChartMode = 'trend'
let selection: Selection = null
let selectedSamples: SelectedSample[] = []
let lastSelectedSampleAt = -Infinity
let allocationCommitTimer: number | null = null
let uiInterval: number | null = null
let reportShownFor: object | null = null
let manualReportWasPaused: boolean | null = null
let lastPropertyTableYear = -1
let gameStarted = false

renderSetup()

function renderSetup(): void {
  appRoot.innerHTML = setupLayout(selectedStrategy, selectedCode, selectedScenario)
  document.querySelectorAll<HTMLButtonElement>('[data-scenario]').forEach((button) => {
    button.addEventListener('click', () => {
      selectedScenario = button.dataset.scenario as ScenarioId
      renderSetup()
    })
  })
  document.querySelectorAll<HTMLButtonElement>('[data-strategy]').forEach((button) => {
    button.addEventListener('click', () => {
      selectedStrategy = button.dataset.strategy as Strategy
      selectedCode = SPECIES.find((species) => species.strategy === selectedStrategy)!.code
      renderSetup()
    })
  })
  document.querySelectorAll<HTMLButtonElement>('[data-species]').forEach((button) => {
    button.addEventListener('click', () => {
      selectedCode = button.dataset.species!
      renderSetup()
    })
  })
  document.querySelector<HTMLButtonElement>('#start-game')!.addEventListener('click', startGame)
}

function startGame(): void {
  const player = SPECIES.find((species) => species.code === selectedCode)!
  appRoot.innerHTML = gameLayout(player, selectedScenario)
  simulation = new ForestSimulation(SPECIES, selectedCode, selectedScenario)
  gameStarted = false
  simulation.paused = true
  forestScene = new ForestScene(simulation, {
    onHover: showHoverTooltip,
    onSelectIndividuals: (ids) => {
      selection = ids.length > 0 ? { type: 'individuals', ids } : null
      selectedSamples = []
      lastSelectedSampleAt = -Infinity
      updateSelectedPanel()
      if (chartMode === 'selected') updateChart()
    },
    onSelectCell: (x, y, light) => {
      selection = { type: 'cell', x, y, light }
      selectedSamples = []
      lastSelectedSampleAt = -Infinity
      updateSelectedPanel()
    },
    onTransplant: (id) => {
      selection = { type: 'individuals', ids: [id] }
      updateSelectedPanel()
      updateEventPanel()
    },
  })
  game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game-root',
    width: MAP_PIXEL_WIDTH,
    height: MAP_PIXEL_HEIGHT,
    backgroundColor: '#284b4f',
    render: { antialias: true, pixelArt: false },
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: forestScene,
  })
  chart = echarts.init(document.querySelector<HTMLDivElement>('#population-chart')!, undefined, { renderer: 'canvas' })
  bindGameControls()
  syncAllocationControls(simulation.allocation)
  updateUi()
  updateChart()
  uiInterval = window.setInterval(updateUi, 250)
  const resizeObserver = new ResizeObserver(() => {
    chart?.resize()
    reportChart?.resize()
    game?.scale.refresh()
  })
  resizeObserver.observe(document.body)
}

function bindGameControls(): void {
  document.querySelector<HTMLButtonElement>('#pause-button')!.addEventListener('click', () => {
    if (!simulation || simulation.report) return
    if (!gameStarted) {
      gameStarted = true
      simulation.paused = false
    } else simulation.paused = !simulation.paused
    updateUi()
  })
  document.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!simulation || button.disabled) return
      simulation.speed = Number(button.dataset.speed)
      document.querySelectorAll('[data-speed]').forEach((item) => item.classList.remove('active'))
      button.classList.add('active')
    })
  })
  document.querySelector<HTMLButtonElement>('#restart-button')!.addEventListener('click', restart)
  document.querySelector<HTMLButtonElement>('#modal-restart-button')!.addEventListener('click', restart)
  document.querySelector<HTMLButtonElement>('#report-button')!.addEventListener('click', () => openManualReport())
  document.querySelector<HTMLButtonElement>('#export-button')!.addEventListener('click', exportRun)
  document.querySelector<HTMLButtonElement>('#report-export-button')!.addEventListener('click', exportRun)
  document.querySelector<HTMLButtonElement>('#continue-button')!.addEventListener('click', closeReport)
  document.querySelector<HTMLButtonElement>('#properties-button')!.addEventListener('click', openProperties)
  document.querySelector<HTMLButtonElement>('#close-properties-button')!.addEventListener('click', closeProperties)
  document.querySelector<HTMLInputElement>('#property-search')!.addEventListener('input', renderPropertyTable)
  document.querySelector<HTMLSelectElement>('#property-filter')!.addEventListener('change', renderPropertyTable)
  document.querySelector<HTMLSelectElement>('#property-sort')!.addEventListener('change', renderPropertyTable)
  document.querySelector<HTMLButtonElement>('#reset-map-button')!.addEventListener('click', () => forestScene?.resetCamera())
  document.querySelector<HTMLButtonElement>('#focus-selected-button')!.addEventListener('click', focusSelected)
  document.querySelectorAll<HTMLButtonElement>('[data-view-layer]').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('[data-view-layer]').forEach((item) => item.classList.remove('active'))
      button.classList.add('active')
      forestScene?.setViewLayer(button.dataset.viewLayer as ViewLayer)
    })
  })
  document.querySelectorAll<HTMLInputElement>('[data-allocation]').forEach((slider) => {
    slider.addEventListener('input', () => rebalance(slider.dataset.allocation as AllocationKey, Number(slider.value)))
  })
  document.querySelectorAll<HTMLButtonElement>('[data-allocation-preset]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!simulation) return
      const preset = ALLOCATION_PRESETS[button.dataset.allocationPreset ?? '']
      if (!preset) return
      simulation.setAllocation(preset)
      syncAllocationControls(simulation.allocation)
      updateUi()
    })
  })
  document.querySelectorAll<HTMLButtonElement>('[data-ability]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!simulation) return
      simulation.activateAbility(button.dataset.ability as ActiveAbility)
      updateUi()
    })
  })
  document.querySelectorAll<HTMLButtonElement>('[data-chart]').forEach((button) => {
    button.addEventListener('click', () => {
      chartMode = button.dataset.chart as ChartMode
      document.querySelectorAll('[data-chart]').forEach((item) => item.classList.remove('active'))
      button.classList.add('active')
      updateChart()
    })
  })
}

function rebalance(changedKey: AllocationKey, changedPercent: number): void {
  if (!simulation) return
  const keys: AllocationKey[] = ['growth', 'reproduction', 'reserve']
  const current = readAllocationControls()
  const changedValue = Math.max(0, Math.min(100, changedPercent))
  const remaining = 100 - changedValue
  const otherKeys = keys.filter((key) => key !== changedKey)
  const otherTotal = otherKeys.reduce((sum, key) => sum + current[key], 0)
  current[changedKey] = changedValue
  if (otherTotal <= 0) {
    current[otherKeys[0]] = Math.round(remaining / 2)
    current[otherKeys[1]] = remaining - current[otherKeys[0]]
  } else {
    current[otherKeys[0]] = Math.round((current[otherKeys[0]] / otherTotal) * remaining)
    current[otherKeys[1]] = remaining - current[otherKeys[0]]
  }
  syncAllocationControls({ growth: current.growth / 100, reproduction: current.reproduction / 100, reserve: current.reserve / 100 })
  if (allocationCommitTimer !== null) window.clearTimeout(allocationCommitTimer)
  allocationCommitTimer = window.setTimeout(() => {
    simulation?.setAllocation({ growth: current.growth / 100, reproduction: current.reproduction / 100, reserve: current.reserve / 100 })
  }, 120)
}

function readAllocationControls(): Record<AllocationKey, number> {
  return {
    growth: Number(document.querySelector<HTMLInputElement>('#growth-slider')!.value),
    reproduction: Number(document.querySelector<HTMLInputElement>('#reproduction-slider')!.value),
    reserve: Number(document.querySelector<HTMLInputElement>('#reserve-slider')!.value),
  }
}

function syncAllocationControls(allocation: Allocation): void {
  const values: Record<AllocationKey, number> = {
    growth: Math.round(allocation.growth * 100),
    reproduction: Math.round(allocation.reproduction * 100),
    reserve: Math.round(allocation.reserve * 100),
  }
  values.reserve += 100 - values.growth - values.reproduction - values.reserve
  for (const key of ['growth', 'reproduction', 'reserve'] as AllocationKey[]) {
    const slider = document.querySelector<HTMLInputElement>(`#${key}-slider`)
    const output = document.querySelector<HTMLElement>(`#${key}-value`)
    if (slider) slider.value = String(values[key])
    if (output) output.textContent = `${values[key]}%`
  }
  setText('allocation-total', `${values.growth + values.reproduction + values.reserve}%`)
  document.querySelectorAll<HTMLButtonElement>('[data-allocation-preset]').forEach((button) => {
    const preset = ALLOCATION_PRESETS[button.dataset.allocationPreset ?? '']
    const active = preset !== undefined &&
      Math.abs(preset.growth - allocation.growth) + Math.abs(preset.reproduction - allocation.reproduction) + Math.abs(preset.reserve - allocation.reserve) < 0.03
    button.classList.toggle('active', active)
    button.setAttribute('aria-pressed', String(active))
  })
}

function updateUi(): void {
  if (!simulation) return
  const population = simulation.population(simulation.playerCode)
  const totalCommunity = simulation.individuals.length
  const averageLight = average(population.map((individual) => simulation!.lightAt(individual.x, individual.y)))
  const averageHealth = average(population.map((individual) => individual.health))
  const riskCount = population.filter((individual) => individual.riskScore >= RISK_THRESHOLD).length
  const canopyCount = simulation.individuals.filter((individual) => individual.canopy).length
  const cover = simulation.canopyCover()
  setText('game-time', `第 ${simulation.forestYear.toFixed(1)} 年`)
  setText('forest-phase', !gameStarted ? '观察准备期 · 检查地图后开始' : simulation.longTermUnlocked ? '长期演替期' : '种群建立期 · 第 30 年首次结算')
  setText('population-total', population.length)
  setText('average-health', `${Math.round(averageHealth * 100)}%`)
  setText('population-share', `${totalCommunity ? Math.round((population.length / totalCommunity) * 100) : 0}%`)
  setText('risk-count', `${riskCount} / ${population.length}`)
  setText('canopy-cover', `${Math.round(cover * 100)}%`)
  setText('average-light', `${Math.round(averageLight * 100)}%`)
  setText('carbon-income', simulation.playerState.income.toFixed(1))
  setText('maintenance-cost', simulation.playerState.maintenance.toFixed(1))
  setText('carbon-surplus', simulation.playerState.surplus.toFixed(1))
  setText('carbon-reserve', simulation.playerState.reserve.toFixed(1))
  setText('growth-spend', `投入 ${(simulation.playerState.surplus * simulation.allocation.growth).toFixed(1)}`)
  setText('reproduction-spend', `投入 ${(simulation.playerState.surplus * simulation.allocation.reproduction).toFixed(1)}`)
  setText('reserve-spend', `存入 ${(simulation.playerState.surplus * simulation.allocation.reserve).toFixed(1)}`)
  setText(
    'allocation-impact',
    !gameStarted
      ? '演替尚未开始：可先检查个体、移动幼体并调整投资'
      : simulation.playerState.surplus > 0.05
      ? `本年可投资 ${simulation.playerState.surplus.toFixed(1)} · 风险个体 ${riskCount}`
      : '收入只能覆盖维持，检查风险个体与局部光照',
  )
  setText('map-summary', `${canopyCount} 个林冠个体 · 覆盖 ${Math.round(cover * 100)}% · 平均光照 ${Math.round(averageLight * 100)}%`)
  setText('pause-button', !gameStarted ? '开始演替' : simulation.paused && !simulation.report ? '继续' : '暂停')
  document.querySelectorAll<HTMLButtonElement>('[data-long-term]').forEach((button) => {
    button.disabled = !simulation!.longTermUnlocked
    button.title = simulation!.longTermUnlocked ? '' : '第 30 年结算后解锁'
  })
  updateAbilityButtons()
  updateStageBar(population)
  updateEventPanel()
  updateSelectedPanel()
  collectSelectedSample()
  if (document.querySelector('#properties-drawer:not(.hidden)') && Math.floor(simulation.forestYear) !== lastPropertyTableYear) renderPropertyTable()
  updateChart()
  if (simulation.report && reportShownFor !== simulation.report) showReport(simulation.report, false)
}

function updateAbilityButtons(): void {
  if (!simulation) return
  for (const ability of ['defense', 'mast'] as ActiveAbility[]) {
    const status = simulation.abilityStatus(ability)
    const button = document.querySelector<HTMLButtonElement>(`[data-ability="${ability}"]`)
    if (!button) continue
    button.disabled = !status.available
    const label = status.activeYears > 0
      ? `生效 ${status.activeYears.toFixed(1)} 年`
      : status.cooldownYears > 0
        ? `冷却 ${status.cooldownYears.toFixed(1)} 年`
        : `${status.cost} 储备`
    setText(`${ability}-status`, label)
  }
}

function updateStageBar(population: Individual[]): void {
  const stages = ['seed', 'seedling', 'sapling', 'adult'] as const
  const colors = ['#cbbd94', '#94b98d', '#5f9978', '#274f45']
  const total = Math.max(1, population.length)
  const bar = document.querySelector<HTMLDivElement>('#stage-bar')
  if (!bar) return
  bar.innerHTML = stages.map((stage, index) => {
    const count = population.filter((individual) => individual.stage === stage).length
    return `<i style="width:${(count / total) * 100}%;background:${colors[index]}" title="${simulation?.stageLabel(stage)} ${count}"></i>`
  }).join('')
}

function updateEventPanel(): void {
  if (!simulation) return
  const headline = document.querySelector<HTMLElement>('#event-headline')
  const message = document.querySelector<HTMLElement>('#event-message')
  const panel = document.querySelector<HTMLElement>('.event-panel')
  if (!headline || !message || !panel) return
  if (!gameStarted) {
    headline.textContent = '观察准备期'
    message.textContent = '时间已暂停。先查看自己的白圈个体、局部光照和生命史投资，再开始演替。'
    panel.dataset.tone = 'neutral'
  } else if (simulation.pestWarning) {
    const species = simulation.activeSpecies.find((item) => item.code === simulation!.pestWarning!.speciesCode)!
    headline.textContent = `专性虫害预警 · 第 ${simulation.pestWarning.happensAt.toFixed(1)} 年`
    message.textContent = `${species.name} 长期占据优势。诱导防御可以减半虫害死亡风险。`
    panel.dataset.tone = 'warning'
  } else if (simulation.warning) {
    const remaining = Math.max(0, simulation.warning.happensAt - simulation.forestYear)
    const rainstorm = simulation.warning.type === 'rainstorm'
    headline.textContent = `${rainstorm ? '暴雨' : '台风'}预警 · ${remaining.toFixed(1)} 年后`
    message.textContent = rainstorm ? '全图个体将承受健康损失，储备提供缓冲。' : '模糊影响区已显示，冠层高树风险最高。'
    panel.dataset.tone = 'warning'
  } else {
    const latest = simulation.events.at(-1)
    headline.textContent = latest ? `生态过程 · 第 ${latest.time.toFixed(1)} 年` : '环境暂时稳定'
    message.textContent = latest?.message ?? '优势积累会带来专性虫害风险。'
    panel.dataset.tone = latest?.tone ?? 'neutral'
  }
}

function updateSelectedPanel(): void {
  if (!simulation) return
  const title = document.querySelector<HTMLElement>('#selected-title')
  const content = document.querySelector<HTMLElement>('#selected-content')
  const focusButton = document.querySelector<HTMLButtonElement>('#focus-selected-button')
  if (!title || !content || !focusButton) return
  focusButton.classList.toggle('hidden', selection?.type !== 'individuals' || selection.ids.length !== 1)
  if (!selection) {
    title.textContent = '点击一个个体或空地'
    content.className = 'selected-content empty'
    content.textContent = '大白圈包围的是自己的个体；幼苗和幼树可拖动移栽，红点表示综合风险。'
    return
  }
  if (selection.type === 'cell') {
    const selectedCell = selection
    const nearby = simulation.individuals.filter((individual) =>
      Math.hypot((individual.x - selectedCell.x) * simulation!.mapWidthMeters, (individual.y - selectedCell.y) * simulation!.mapHeightMeters) < 2,
    )
    title.textContent = `位置 ${(selection.x * simulation.mapWidthMeters).toFixed(1)} m, ${(selection.y * simulation.mapHeightMeters).toFixed(1)} m`
    content.className = 'selected-content'
    content.innerHTML = statusGrid([
      ['林下光照', `${Math.round(simulation.lightAt(selection.x, selection.y) * 100)}%`],
      ['2 m 邻域个体', String(nearby.length)],
      ['邻域林冠', String(nearby.filter((individual) => individual.canopy).length)],
      ['风险个体', String(nearby.filter((individual) => individual.riskScore >= RISK_THRESHOLD).length)],
    ])
    return
  }
  const individuals = selection.ids.map((id) => simulation!.findIndividual(id)).filter((item): item is Individual => Boolean(item))
  if (individuals.length === 0) {
    title.textContent = '选中个体已经死亡'
    content.className = 'selected-content empty'
    content.textContent = '红色叉号会在原位置停留 5 秒；死亡记录仍保留在导出数据中。'
    return
  }
  if (individuals.length > 1) {
    title.textContent = `已选择 ${individuals.length} 个体 · ${new Set(individuals.map((item) => item.species.code)).size} 个物种`
    content.className = 'selected-content'
    content.innerHTML = `${statusGrid([
      ['平均树高', `${average(individuals.map((item) => item.height)).toFixed(2)} m`],
      ['平均健康', `${Math.round(average(individuals.map((item) => item.health)) * 100)}%`],
      ['平均竞争', `${Math.round(average(individuals.map((item) => item.competitionPressure)) * 100)}%`],
      ['平均病原', `${Math.round(average(individuals.map((item) => item.pathogenPressure)) * 100)}%`],
      ['风险个体', String(individuals.filter((item) => item.riskScore >= RISK_THRESHOLD).length)],
      ['冠层个体', String(individuals.filter((item) => item.canopy).length)],
    ])}<p class="inspection-note">“选中对象”图显示这一组的平均轨迹。</p>`
    return
  }
  const individual = individuals[0]
  const own = individual.species.code === simulation.playerCode
  title.textContent = `${individual.species.name} #${individual.id} · ${simulation.stageLabel(individual.stage)}${own ? ' · 你的物种' : ''}`
  content.className = 'selected-content'
  content.innerHTML = `${statusGrid([
    ['树高', `${individual.height.toFixed(2)} m`],
    ['胸径', `${individual.dbh.toFixed(1)} cm`],
    ['健康', `${Math.round(individual.health * 100)}%`],
    ['综合风险', `${Math.round(individual.riskScore * 100)}%`],
    ['局部光照', `${Math.round(simulation.lightAt(individual.x, individual.y) * 100)}%`],
    ['竞争压力', `${Math.round(individual.competitionPressure * 100)}%`],
    ['病原菌压力', `${Math.round(individual.pathogenPressure * 100)}%`],
    ['虫害压力', `${Math.round(individual.insectPressure * 100)}%`],
    ['林冠个体', individual.canopy ? `是（≥ ${CANOPY_HEIGHT_METERS} m）` : '否'],
    ['坐标', `${(individual.x * simulation.mapWidthMeters).toFixed(1)}, ${(individual.y * simulation.mapHeightMeters).toFixed(1)} m`],
  ])}<p class="inspection-note">${own && simulation.canTransplant(individual) ? '可拖动移栽一次，健康付出 4%。' : '点击“定位”放大查看该个体。'}</p>`
}

function collectSelectedSample(): void {
  if (!simulation || selection?.type !== 'individuals' || simulation.forestYear < lastSelectedSampleAt + 0.5) return
  const individuals = selection.ids.map((id) => simulation!.findIndividual(id)).filter((item): item is Individual => Boolean(item))
  if (individuals.length === 0) return
  lastSelectedSampleAt = simulation.forestYear
  selectedSamples.push({
    time: simulation.forestYear,
    height: average(individuals.map((item) => item.height)),
    light: average(individuals.map((item) => simulation!.lightAt(item.x, item.y))) * 100,
    health: average(individuals.map((item) => item.health)) * 100,
  })
  if (selectedSamples.length > 240) selectedSamples.shift()
}

function updateChart(): void {
  if (!simulation || !chart) return
  const common = {
    animation: false,
    textStyle: { fontFamily: 'Inter, ui-sans-serif, system-ui', color: '#344b42' },
    tooltip: { trigger: 'axis' as const, backgroundColor: '#152d26', borderWidth: 0, textStyle: { color: '#fff' } },
    grid: { left: 42, right: 26, top: 32, bottom: 30 },
  }
  if (chartMode === 'height') {
    setText('chart-title', '当前树高分布 · 对数点径')
    const bins = [0, 1, 2, 5, 10, 15, 25, 40]
    chart.setOption({
      ...common,
      legend: { data: ['你的物种', '其他物种'], top: 0 },
      xAxis: { type: 'category', data: bins.slice(0, -1).map((value, index) => `${value}–${bins[index + 1]}m`), axisLabel: { fontSize: 9 } },
      yAxis: { type: 'value', minInterval: 1, splitLine: { lineStyle: { color: '#dfe6dd' } } },
      series: [
        { name: '你的物种', type: 'bar', data: heightBins(simulation.population(simulation.playerCode), bins), itemStyle: { color: '#e9933e' } },
        { name: '其他物种', type: 'bar', data: heightBins(simulation.individuals.filter((item) => item.species.code !== simulation!.playerCode), bins), itemStyle: { color: '#9aaba2' } },
      ],
    }, true)
    return
  }
  if (chartMode === 'selected') {
    const selectedCount = selection?.type === 'individuals' ? selection.ids.length : 0
    setText('chart-title', selectedCount > 1 ? `${selectedCount} 个选中对象的平均轨迹` : '选中个体的局部轨迹')
    if (selectedSamples.length === 0) {
      chart.clear()
      chart.setOption({ title: { text: '请先点击或多选地图中的个体', left: 'center', top: 'middle', textStyle: { fontSize: 13, color: '#7c8d84' } } })
      return
    }
    chart.setOption({
      ...common,
      legend: { data: ['树高（m）', '局部光照（%）', '健康（%）'], top: 0 },
      xAxis: { type: 'category', data: selectedSamples.map((sample) => `第${sample.time.toFixed(1)}年`), boundaryGap: false },
      yAxis: [{ type: 'value', name: 'm' }, { type: 'value', name: '%', min: 0, max: 100 }],
      series: [
        { name: '树高（m）', type: 'line', data: selectedSamples.map((sample) => sample.height.toFixed(2)), showSymbol: false },
        { name: '局部光照（%）', type: 'line', yAxisIndex: 1, data: selectedSamples.map((sample) => sample.light.toFixed(0)), showSymbol: false },
        { name: '健康（%）', type: 'line', yAxisIndex: 1, data: selectedSamples.map((sample) => sample.health.toFixed(0)), showSymbol: false },
      ],
    }, true)
    return
  }
  setText('chart-title', '玩家种群与健康走势')
  chart.setOption({
    ...common,
    legend: { data: ['全部个体', '成树', '平均健康', '碳储备'], top: 0, textStyle: { fontSize: 9 } },
    xAxis: { type: 'category', data: simulation.history.map((sample) => `${sample.time.toFixed(0)}年`), boundaryGap: false },
    yAxis: [{ type: 'value', name: '个体' }, { type: 'value', name: '% / 储备', min: 0 }],
    series: [
      { name: '全部个体', type: 'line', data: simulation.history.map((sample) => sample.total), showSymbol: false, lineStyle: { color: '#e9933e', width: 2.5 } },
      { name: '成树', type: 'line', data: simulation.history.map((sample) => sample.adults), showSymbol: false, lineStyle: { color: '#335f50' } },
      { name: '平均健康', type: 'line', yAxisIndex: 1, data: simulation.history.map((sample) => Math.round(sample.averageHealth * 100)), showSymbol: false, lineStyle: { color: '#a85246' } },
      { name: '碳储备', type: 'line', yAxisIndex: 1, data: simulation.history.map((sample) => sample.reserve.toFixed(1)), showSymbol: false, lineStyle: { color: '#6d7fb9', type: 'dashed' } },
    ],
  }, true)
}

function openManualReport(): void {
  if (!simulation) return
  manualReportWasPaused = simulation.paused
  simulation.paused = true
  showReport(simulation.createOutcomeReport(), true)
}

function showReport(report: OutcomeReport, manual: boolean): void {
  if (!simulation) return
  reportShownFor = report
  setText('report-kicker', manual ? '当前阶段报告 · 主动查看' : '首次阶段复盘 · 长期演替即将解锁')
  setText('report-title', report.title)
  setText('report-outcome', report.outcome)
  setText('report-summary', report.summary)
  setList('report-details', report.details)
  setList('report-drivers', report.drivers)
  setList('report-strategy', report.strategyImpacts)
  setList('report-risks', report.futureRisks)
  document.querySelector<HTMLOListElement>('#report-events')!.innerHTML = report.turningPoints.length > 0
    ? report.turningPoints.map((event) => `<li><time>第 ${event.time.toFixed(1)} 年</time><span>${event.message}</span></li>`).join('')
    : '<li><span>尚无关键转折。</span></li>'
  const continueButton = document.querySelector<HTMLButtonElement>('#continue-button')!
  continueButton.hidden = report.terminal
  continueButton.textContent = manual ? '返回森林' : '进入长期演替'
  document.querySelector<HTMLElement>('#report-modal')!.classList.remove('hidden')
  reportChart?.dispose()
  reportChart = echarts.init(document.querySelector<HTMLDivElement>('#report-chart')!, undefined, { renderer: 'canvas' })
  reportChart.setOption({
    animation: false,
    tooltip: { trigger: 'axis' },
    legend: { data: ['全部个体', '平均健康', '竞争压力'], top: 0 },
    grid: { left: 44, right: 44, top: 36, bottom: 28 },
    xAxis: { type: 'category', data: simulation.history.map((sample) => `${sample.time.toFixed(0)}年`), boundaryGap: false },
    yAxis: [{ type: 'value', name: '个体' }, { type: 'value', name: '%', min: 0, max: 100 }],
    series: [
      { name: '全部个体', type: 'line', data: simulation.history.map((sample) => sample.total), showSymbol: false },
      { name: '平均健康', type: 'line', yAxisIndex: 1, data: simulation.history.map((sample) => Math.round(sample.averageHealth * 100)), showSymbol: false },
      { name: '竞争压力', type: 'line', yAxisIndex: 1, data: simulation.history.map((sample) => Math.round(sample.averageCompetitionPressure * 100)), showSymbol: false },
    ],
  })
}

function closeReport(): void {
  if (!simulation) return
  if (manualReportWasPaused !== null) {
    simulation.paused = manualReportWasPaused
    manualReportWasPaused = null
  } else simulation.continueAfterReport()
  reportShownFor = null
  reportChart?.dispose()
  reportChart = null
  document.querySelector('#report-modal')?.classList.add('hidden')
  updateUi()
}

function exportRun(): void {
  if (!simulation) return
  downloadExportArchive(simulation)
  const button = document.querySelector<HTMLButtonElement>('#export-button')
  if (button) {
    const original = button.textContent
    button.textContent = '已导出 ZIP'
    window.setTimeout(() => { button.textContent = original }, 1400)
  }
}

function openProperties(): void {
  document.querySelector('#properties-drawer')?.classList.remove('hidden')
  renderPropertyTable()
}

function closeProperties(): void {
  document.querySelector('#properties-drawer')?.classList.add('hidden')
}

function renderPropertyTable(): void {
  if (!simulation) return
  lastPropertyTableYear = Math.floor(simulation.forestYear)
  const query = document.querySelector<HTMLInputElement>('#property-search')?.value.trim().toLowerCase() ?? ''
  const filter = document.querySelector<HTMLSelectElement>('#property-filter')?.value ?? 'all'
  const sort = document.querySelector<HTMLSelectElement>('#property-sort')?.value ?? 'risk'
  let individuals = simulation.individuals.filter((individual) =>
    !query || individual.species.name.toLowerCase().includes(query) || individual.species.code.toLowerCase().includes(query) || String(individual.id).includes(query),
  )
  if (filter === 'own') individuals = individuals.filter((item) => item.species.code === simulation!.playerCode)
  if (filter === 'risk') individuals = individuals.filter((item) => item.riskScore >= RISK_THRESHOLD)
  if (filter === 'canopy') individuals = individuals.filter((item) => item.canopy)
  if (filter === 'understory') individuals = individuals.filter((item) => !item.canopy)
  individuals.sort((first, second) => {
    if (sort === 'height') return second.height - first.height
    if (sort === 'health') return first.health - second.health
    return second.riskScore - first.riskScore
  })
  const body = document.querySelector<HTMLTableSectionElement>('#property-table-body')
  if (!body) return
  body.innerHTML = individuals.map((individual) => `
    <tr data-property-id="${individual.id}" class="${individual.riskScore >= RISK_THRESHOLD ? 'at-risk' : ''}">
      <td><strong>${individual.species.name} #${individual.id}</strong><span>${individual.species.code === simulation!.playerCode ? '你的物种' : STRATEGIES[individual.species.strategy].short}</span></td>
      <td>${simulation!.stageLabel(individual.stage)}</td><td>${individual.height.toFixed(1)}m</td>
      <td>${Math.round(individual.health * 100)}%</td><td>${Math.round(individual.competitionPressure * 100)}%</td><td>${Math.round(individual.riskScore * 100)}%</td>
    </tr>`).join('')
  body.querySelectorAll<HTMLTableRowElement>('[data-property-id]').forEach((row) => {
    row.addEventListener('click', () => {
      const id = Number(row.dataset.propertyId)
      selection = { type: 'individuals', ids: [id] }
      forestScene?.selectIndividuals([id])
      forestScene?.focusIndividual(id)
      updateSelectedPanel()
      closeProperties()
    })
  })
}

function focusSelected(): void {
  if (selection?.type === 'individuals' && selection.ids.length === 1) forestScene?.focusIndividual(selection.ids[0])
}

function showHoverTooltip(individual: Individual | null, screenX = 0, screenY = 0): void {
  if (!simulation) return
  const tooltip = document.querySelector<HTMLElement>('#hover-tooltip')
  if (!tooltip) return
  if (!individual) {
    tooltip.classList.add('hidden')
    return
  }
  tooltip.innerHTML = `<strong>${individual.species.name} #${individual.id}</strong><span>${simulation.stageLabel(individual.stage)} · ${individual.height.toFixed(1)} m · 健康 ${Math.round(individual.health * 100)}% · 风险 ${Math.round(individual.riskScore * 100)}%</span>`
  tooltip.style.left = `${Math.min(window.innerWidth - 230, screenX + 18)}px`
  tooltip.style.top = `${Math.min(window.innerHeight - 80, screenY + 18)}px`
  tooltip.classList.remove('hidden')
}

function statusGrid(entries: Array<[string, string]>): string {
  return `<div class="status-grid">${entries.map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join('')}</div>`
}

function setList(id: string, values: string[]): void {
  const element = document.querySelector<HTMLElement>(`#${id}`)
  if (element) element.innerHTML = values.map((value) => `<li>${value}</li>`).join('')
}

function heightBins(individuals: Individual[], bins: number[]): number[] {
  return bins.slice(0, -1).map((lower, index) => individuals.filter((individual) =>
    individual.stage !== 'seed' && individual.height >= lower && individual.height < bins[index + 1],
  ).length)
}

function average(values: number[]): number {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function setText(id: string, value: string | number): void {
  const element = document.querySelector<HTMLElement>(`#${id}`)
  if (element) element.textContent = String(value)
}

function restart(): void {
  if (uiInterval !== null) window.clearInterval(uiInterval)
  window.location.reload()
}
