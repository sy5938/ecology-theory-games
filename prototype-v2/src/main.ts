import Phaser from 'phaser'
import * as echarts from 'echarts'
import './style.css'
import { ForestScene, MAP_PIXEL_HEIGHT, MAP_PIXEL_WIDTH } from './forest-scene'
import { gameLayout, setupLayout } from './layouts'
import { SPECIES, STRATEGIES, type Strategy } from './species'
import { ForestSimulation, type Allocation, type AllocationKey, type Individual } from './simulation'

type Selection =
  | { type: 'individual'; id: number }
  | { type: 'cell'; x: number; y: number; light: number }
  | null

type ChartMode = 'trend' | 'height' | 'selected'

interface SelectedSample {
  time: number
  height: number
  light: number
  health: number
}

const appRoot = document.querySelector<HTMLDivElement>('#app')!

let selectedStrategy: Strategy = 'sun'
let selectedCode = 'LORCHI'
let simulation: ForestSimulation | null = null
let forestScene: ForestScene | null = null
let game: Phaser.Game | null = null
let chart: echarts.ECharts | null = null
let chartMode: ChartMode = 'trend'
let selection: Selection = null
let selectedSamples: SelectedSample[] = []
let lastSelectedSampleAt = -1
let allocationCommitTimer: number | null = null
let uiInterval: number | null = null
let reportShownFor: object | null = null

renderSetup()

function renderSetup(): void {
  appRoot.innerHTML = setupLayout(selectedStrategy, selectedCode)

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
  appRoot.innerHTML = gameLayout(player)

  simulation = new ForestSimulation(SPECIES, selectedCode)
  forestScene = new ForestScene(simulation, {
    onHover: showHoverTooltip,
    onSelectIndividual: (id) => {
      selection = { type: 'individual', id }
      selectedSamples = []
      lastSelectedSampleAt = -1
      updateSelectedPanel()
      if (chartMode === 'selected') updateChart()
    },
    onSelectCell: (x, y, light) => {
      selection = { type: 'cell', x, y, light }
      selectedSamples = []
      lastSelectedSampleAt = -1
      updateSelectedPanel()
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

  chart = echarts.init(document.querySelector<HTMLDivElement>('#population-chart')!, undefined, {
    renderer: 'canvas',
  })

  bindGameControls()
  syncAllocationControls(simulation.allocation)
  updateUi()
  updateChart()
  uiInterval = window.setInterval(updateUi, 250)

  const resizeObserver = new ResizeObserver(() => {
    chart?.resize()
    game?.scale.refresh()
  })
  resizeObserver.observe(document.body)
}

function bindGameControls(): void {
  document.querySelector<HTMLButtonElement>('#pause-button')!.addEventListener('click', () => {
    if (!simulation || simulation.report) return
    simulation.paused = !simulation.paused
    updateUi()
  })

  document.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!simulation) return
      simulation.speed = Number(button.dataset.speed)
      document.querySelectorAll('[data-speed]').forEach((item) => item.classList.remove('active'))
      button.classList.add('active')
    })
  })

  document.querySelector<HTMLButtonElement>('#restart-button')!.addEventListener('click', restart)
  document.querySelector<HTMLButtonElement>('#modal-restart-button')!.addEventListener('click', restart)
  document.querySelector<HTMLButtonElement>('#continue-button')!.addEventListener('click', () => {
    simulation?.continueAfterReport()
    reportShownFor = null
    document.querySelector('#report-modal')?.classList.add('hidden')
  })

  document.querySelectorAll<HTMLInputElement>('[data-allocation]').forEach((slider) => {
    slider.addEventListener('input', () => rebalance(slider.dataset.allocation as AllocationKey, Number(slider.value)))
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

  syncAllocationControls({
    growth: current.growth / 100,
    reproduction: current.reproduction / 100,
    reserve: current.reserve / 100,
  })

  if (allocationCommitTimer !== null) window.clearTimeout(allocationCommitTimer)
  allocationCommitTimer = window.setTimeout(() => {
    simulation?.setAllocation({
      growth: current.growth / 100,
      reproduction: current.reproduction / 100,
      reserve: current.reserve / 100,
    })
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
  const adjustment = 100 - values.growth - values.reproduction - values.reserve
  values.reserve += adjustment

  for (const key of ['growth', 'reproduction', 'reserve'] as AllocationKey[]) {
    const slider = document.querySelector<HTMLInputElement>(`#${key}-slider`)
    const output = document.querySelector<HTMLElement>(`#${key}-value`)
    if (slider) slider.value = String(values[key])
    if (output) output.textContent = `${values[key]}%`
  }
  const total = values.growth + values.reproduction + values.reserve
  const totalOutput = document.querySelector<HTMLElement>('#allocation-total')
  if (totalOutput) totalOutput.textContent = `${total}%`
}

function updateUi(): void {
  if (!simulation) return
  const population = simulation.population(simulation.playerCode)
  const totalCommunity = simulation.individuals.length
  const adults = population.filter((individual) => individual.stage === 'adult')
  const averageLight =
    population.length === 0
      ? 0
      : population.reduce((sum, individual) => sum + simulation!.lightAt(individual.x, individual.y), 0) /
        population.length
  const canopyCount = simulation.individuals.filter((individual) => individual.canopy).length

  setText('game-time', formatTime(simulation.timeSeconds))
  setText('forest-year', `第 ${(simulation.timeSeconds / 6).toFixed(1)} 年`)
  setText('population-total', population.length)
  setText('population-adults', adults.length)
  setText('population-share', `${totalCommunity ? Math.round((population.length / totalCommunity) * 100) : 0}%`)
  setText('average-light', `${Math.round(averageLight * 100)}%`)
  setText('carbon-income', simulation.playerState.income.toFixed(1))
  setText('maintenance-cost', simulation.playerState.maintenance.toFixed(1))
  setText('carbon-surplus', simulation.playerState.surplus.toFixed(1))
  setText('carbon-reserve', simulation.playerState.reserve.toFixed(1))
  setText('map-summary', `${canopyCount} 棵林冠树 · 平均林下光照 ${Math.round(averageLight * 100)}%`)
  setText('pause-button', simulation.paused && !simulation.report ? '继续' : '暂停')

  updateStageBar(population)
  updateEventPanel()
  updateSelectedPanel()
  collectSelectedSample()

  if (Math.floor(simulation.timeSeconds * 2) % 2 === 0) updateChart()
  if (simulation.report && reportShownFor !== simulation.report) showReport()
}

function updateStageBar(population: Individual[]): void {
  const stages = ['seed', 'seedling', 'sapling', 'adult'] as const
  const colors = ['#cbbd94', '#94b98d', '#5f9978', '#274f45']
  const total = Math.max(1, population.length)
  const bar = document.querySelector<HTMLDivElement>('#stage-bar')
  if (!bar) return
  bar.innerHTML = stages
    .map((stage, index) => {
      const count = population.filter((individual) => individual.stage === stage).length
      return `<i style="width:${(count / total) * 100}%;background:${colors[index]}" title="${simulation?.stageLabel(stage)} ${count}"></i>`
    })
    .join('')
}

function updateEventPanel(): void {
  if (!simulation) return
  const headline = document.querySelector<HTMLElement>('#event-headline')
  const message = document.querySelector<HTMLElement>('#event-message')
  const panel = document.querySelector<HTMLElement>('.event-panel')
  if (!headline || !message || !panel) return

  if (simulation.warning) {
    const remaining = Math.max(0, Math.ceil(simulation.warning.happensAt - simulation.timeSeconds))
    headline.textContent = `台风预警 · 约 ${remaining} 秒后`
    message.textContent = '模糊影响区已显示。你只能通过现有投资组合承担或规避风险。'
    panel.dataset.tone = 'warning'
  } else {
    const latest = simulation.events[0]
    headline.textContent = latest ? `生态过程 · ${formatTime(latest.time)}` : '环境暂时稳定'
    message.textContent = latest?.message ?? '随机事件只改变风险和回报，不提供专用应对按钮。'
    panel.dataset.tone = latest?.tone ?? 'neutral'
  }
}

function updateSelectedPanel(): void {
  if (!simulation) return
  const title = document.querySelector<HTMLElement>('#selected-title')
  const content = document.querySelector<HTMLElement>('#selected-content')
  if (!title || !content) return

  if (!selection) {
    title.textContent = '点击一个个体或空地'
    content.className = 'selected-content empty'
    content.textContent = '地图点位不接受微操，只提供做投资判断所需的局部信息。'
    return
  }

  if (selection.type === 'cell') {
    const cellSelection = selection
    const nearby = simulation.individuals.filter(
      (individual) => Math.hypot(individual.x - cellSelection.x, individual.y - cellSelection.y) < 0.06,
    )
    const canopy = nearby.filter((individual) => individual.canopy).length
    title.textContent = `格点 ${Math.floor(cellSelection.x * simulation.width)}, ${Math.floor(cellSelection.y * simulation.height)}`
    content.className = 'selected-content'
    content.innerHTML = statusGrid([
      ['林下光照', `${Math.round(simulation.lightAt(cellSelection.x, cellSelection.y) * 100)}%`],
      ['邻域个体', String(nearby.length)],
      ['邻域林冠', String(canopy)],
      ['位置', `${cellSelection.x.toFixed(2)}, ${cellSelection.y.toFixed(2)}`],
    ])
    return
  }

  const individual = simulation.findIndividual(selection.id)
  if (!individual) {
    title.textContent = '该个体已经死亡'
    content.className = 'selected-content empty'
    content.textContent = '死亡个体已经从地图移除；其位置可能形成新的光照机会。'
    return
  }

  const own = individual.species.code === simulation.playerCode
  title.textContent = `${individual.species.name} · ${simulation.stageLabel(individual.stage)}${own ? ' · 你的物种' : ''}`
  content.className = 'selected-content'
  content.innerHTML = `
    ${statusGrid([
      ['策略', STRATEGIES[individual.species.strategy].name],
      ['树高', `${individual.height.toFixed(2)} m`],
      ['胸径', `${individual.dbh.toFixed(1)} cm`],
      ['局部光照', `${Math.round(simulation.lightAt(individual.x, individual.y) * 100)}%`],
      ['健康', `${Math.round(individual.health * 100)}%`],
      ['林冠个体', individual.canopy ? '是' : '否'],
    ])}
    <p class="inspection-note">${own ? '可通过种群投资组合间接影响它。' : '可观察，但不能调整这个物种。'}</p>
  `
}

function collectSelectedSample(): void {
  if (!simulation || selection?.type !== 'individual') return
  if (simulation.timeSeconds < lastSelectedSampleAt + 1) return
  const individual = simulation.findIndividual(selection.id)
  if (!individual) return
  lastSelectedSampleAt = simulation.timeSeconds
  selectedSamples.push({
    time: simulation.timeSeconds,
    height: individual.height,
    light: simulation.lightAt(individual.x, individual.y) * 100,
    health: individual.health * 100,
  })
  if (selectedSamples.length > 180) selectedSamples.shift()
}

function updateChart(): void {
  if (!simulation || !chart) return
  const palette = ['#e9933e', '#335f50', '#6d7fb9']
  const common = {
    animationDuration: 240,
    textStyle: { fontFamily: 'Inter, ui-sans-serif, system-ui', color: '#344b42' },
    tooltip: { trigger: 'axis' as const, backgroundColor: '#152d26', borderWidth: 0, textStyle: { color: '#fff' } },
    grid: { left: 42, right: 20, top: 32, bottom: 30 },
  }

  if (chartMode === 'height') {
    setText('chart-title', '当前树高分布')
    const bins = [0, 2, 5, 10, 15, 20, 30, 40]
    const labels = bins.slice(0, -1).map((value, index) => `${value}–${bins[index + 1]}m`)
    const player = heightBins(simulation.population(simulation.playerCode), bins)
    const others = heightBins(
      simulation.individuals.filter((individual) => individual.species.code !== simulation!.playerCode),
      bins,
    )
    chart.setOption(
      {
        ...common,
        legend: { data: ['你的物种', '其他物种'], top: 0 },
        xAxis: { type: 'category', data: labels, axisLabel: { fontSize: 10 } },
        yAxis: { type: 'value', minInterval: 1, splitLine: { lineStyle: { color: '#dfe6dd' } } },
        series: [
          { name: '你的物种', type: 'bar', data: player, itemStyle: { color: palette[0], borderRadius: [3, 3, 0, 0] } },
          { name: '其他物种', type: 'bar', data: others, itemStyle: { color: '#9aaba2', borderRadius: [3, 3, 0, 0] } },
        ],
      },
      true,
    )
    return
  }

  if (chartMode === 'selected') {
    setText('chart-title', '选中个体的局部轨迹')
    if (selection?.type !== 'individual' || selectedSamples.length === 0) {
      chart.clear()
      chart.setOption({
        title: { text: '请先点击地图中的一个个体', left: 'center', top: 'middle', textStyle: { fontSize: 13, color: '#7c8d84' } },
      })
      return
    }
    chart.setOption(
      {
        ...common,
        legend: { data: ['树高（m）', '局部光照（%）', '健康（%）'], top: 0 },
        xAxis: { type: 'category', data: selectedSamples.map((sample) => formatTime(sample.time)), boundaryGap: false },
        yAxis: [
          { type: 'value', name: 'm', splitLine: { lineStyle: { color: '#dfe6dd' } } },
          { type: 'value', name: '%', min: 0, max: 100 },
        ],
        series: [
          { name: '树高（m）', type: 'line', data: selectedSamples.map((sample) => sample.height.toFixed(2)), showSymbol: false, lineStyle: { color: palette[0] } },
          { name: '局部光照（%）', type: 'line', yAxisIndex: 1, data: selectedSamples.map((sample) => sample.light.toFixed(0)), showSymbol: false, lineStyle: { color: '#d4b84d' } },
          { name: '健康（%）', type: 'line', yAxisIndex: 1, data: selectedSamples.map((sample) => sample.health.toFixed(0)), showSymbol: false, lineStyle: { color: palette[2] } },
        ],
      },
      true,
    )
    return
  }

  setText('chart-title', '玩家种群走势')
  chart.setOption(
    {
      ...common,
      legend: { data: ['全部个体', '成树', '碳储备'], top: 0 },
      xAxis: { type: 'category', data: simulation.history.map((sample) => formatTime(sample.time)), boundaryGap: false },
      yAxis: [
        { type: 'value', name: '个体', minInterval: 1, splitLine: { lineStyle: { color: '#dfe6dd' } } },
        { type: 'value', name: '储备', splitLine: { show: false } },
      ],
      series: [
        { name: '全部个体', type: 'line', data: simulation.history.map((sample) => sample.total), showSymbol: false, smooth: 0.2, lineStyle: { color: palette[0], width: 2.5 }, areaStyle: { color: '#e9933e18' } },
        { name: '成树', type: 'line', data: simulation.history.map((sample) => sample.adults), showSymbol: false, lineStyle: { color: palette[1] } },
        { name: '碳储备', type: 'line', yAxisIndex: 1, data: simulation.history.map((sample) => sample.reserve.toFixed(1)), showSymbol: false, lineStyle: { color: palette[2], type: 'dashed' } },
      ],
    },
    true,
  )
}

function showReport(): void {
  if (!simulation?.report) return
  reportShownFor = simulation.report
  const modal = document.querySelector<HTMLElement>('#report-modal')!
  setText('report-title', simulation.report.title)
  setText('report-summary', simulation.report.summary)
  document.querySelector<HTMLUListElement>('#report-details')!.innerHTML = simulation.report.details
    .map((detail) => `<li>${detail}</li>`)
    .join('')
  const continueButton = document.querySelector<HTMLButtonElement>('#continue-button')!
  continueButton.hidden = simulation.report.terminal
  modal.classList.remove('hidden')
}

function showHoverTooltip(individual: Individual | null, screenX = 0, screenY = 0): void {
  if (!simulation) return
  const tooltip = document.querySelector<HTMLElement>('#hover-tooltip')
  if (!tooltip) return
  if (!individual) {
    tooltip.classList.add('hidden')
    return
  }
  tooltip.innerHTML = `<strong>${individual.species.name}</strong><span>${simulation.stageLabel(individual.stage)} · ${individual.height.toFixed(1)} m · 光照 ${Math.round(simulation.lightAt(individual.x, individual.y) * 100)}%</span>`
  tooltip.style.left = `${Math.min(window.innerWidth - 230, screenX + 18)}px`
  tooltip.style.top = `${Math.min(window.innerHeight - 80, screenY + 18)}px`
  tooltip.classList.remove('hidden')
}

function statusGrid(entries: Array<[string, string]>): string {
  return `<div class="status-grid">${entries
    .map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`)
    .join('')}</div>`
}

function heightBins(individuals: Individual[], bins: number[]): number[] {
  return bins.slice(0, -1).map((lower, index) => {
    const upper = bins[index + 1]
    return individuals.filter((individual) => individual.stage !== 'seed' && individual.height >= lower && individual.height < upper).length
  })
}

function setText(id: string, value: string | number): void {
  const element = document.querySelector<HTMLElement>(`#${id}`)
  if (element) element.textContent = String(value)
}

function formatTime(seconds: number): string {
  const wholeSeconds = Math.max(0, Math.floor(seconds))
  return `${String(Math.floor(wholeSeconds / 60)).padStart(2, '0')}:${String(wholeSeconds % 60).padStart(2, '0')}`
}

function restart(): void {
  if (uiInterval !== null) window.clearInterval(uiInterval)
  window.location.reload()
}
