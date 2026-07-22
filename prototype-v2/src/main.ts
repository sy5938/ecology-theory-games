import Phaser from 'phaser'
import * as echarts from 'echarts'
import './style.css'
import { downloadExportArchive } from './export-data'
import { ForestScene, MAP_PIXEL_HEIGHT, MAP_PIXEL_WIDTH, type MapViewport } from './forest-scene'
import { gameLayout, setupLayout, type SetupStep } from './layouts'
import { SPECIES, STRATEGIES, type Strategy } from './species'
import {
  CANOPY_HEIGHT_METERS,
  RISK_THRESHOLD,
  SCENARIOS,
  ForestSimulation,
  type ActiveAbility,
  type Allocation,
  type AllocationKey,
  type Individual,
  type IndividualSnapshot,
  type OutcomeReport,
  type ScenarioId,
  type ViewLayer,
} from './simulation'

type Selection = { type: 'individuals'; ids: number[] } | { type: 'cell'; x: number; y: number; light: number } | null
type ChartMode =
  | 'species-abundance'
  | 'functional-abundance'
  | 'functional-demography-counts'
  | 'functional-demography-rates'
  | 'composition'
  | 'stage-composition'
  | 'basal-area'
  | 'diversity'
  | 'trend'
  | 'carbon'
  | 'selected'
type StatisticsScope = 'player' | 'species' | 'community'

interface SelectedSample {
  time: number
  height: number
  light: number
  health: number
}

interface PinnedChartTooltip {
  mode: ChartMode
  seriesIndex: number
  dataIndex: number
}

const ALLOCATION_PRESETS: Record<string, Allocation> = {
  balanced: { growth: 0.4, reproduction: 0.3, reserve: 0.3 },
  canopy: { growth: 0.7, reproduction: 0.2, reserve: 0.1 },
  pioneer: { growth: 0.25, reproduction: 0.65, reserve: 0.1 },
  shade: { growth: 0.25, reproduction: 0.15, reserve: 0.6 },
  recovery: { growth: 0.2, reproduction: 0.25, reserve: 0.55 },
}

type FontSize = 'small' | 'medium' | 'large'
type MarkerSize = 'small' | 'medium' | 'large'

interface SavedMapStyle {
  color: string
  size: MarkerSize
}

const FONT_STORAGE_KEY = 'forest-font-size'
const TUTORIAL_STORAGE_KEY = 'forest-tutorial-completed'
const MAP_STYLE_STORAGE_KEY = 'forest-map-style-v1'
const PROPERTY_ROW_HEIGHT = 45
const PROPERTY_OVERSCAN = 6
const TUTORIAL_STEPS = [
  { target: 'map', title: '浏览 100 × 100 m 森林', body: '滚轮按 GIS 层级缩放；按住鼠标右键拖动可平移地图，点击“复位”返回全图。白色五角星是你的个体。' },
  { target: 'layers', title: '按需控制地图图层', body: '左侧可筛选高度层、生活史阶段与物种。风险和新近死亡默认关闭，放大到个体尺度后再按需开启。' },
  { target: 'inspect', title: '点击检查个体或空地', body: '查询卡会显示在点击位置旁。展开详情可查看树高、胸径、光照与竞争；点击地图外或按 Esc 关闭。' },
  { target: 'statistics', title: '用图表观察此消彼长', body: '右上统计窗口可切换物种、功能型、出生死亡、固碳与多样性图表；“放大查看”可提供更完整的图表空间。' },
  { target: 'allocation', title: '分配有限的碳', body: '在生长、繁殖和储备之间取舍，或使用快速方案。主动能力会消耗碳储备并进入冷却。' },
  { target: 'start', title: '开始并观察长期演替', body: '点击“开始演替”推进时间，可暂停和切换倍速。底部仅即时显示突发事件，否则每五年汇总群落与玩家种群变化。' },
] as const

const appRoot = document.querySelector<HTMLDivElement>('#app')!
let selectedStrategy: Strategy = 'sun'
let selectedCode = 'LORCHI'
let selectedScenario: ScenarioId = 'colonization'
let selectedDensity = SCENARIOS[selectedScenario].defaultDensity
let setupStep: SetupStep = 0
let simulation: ForestSimulation | null = null
let forestScene: ForestScene | null = null
let game: Phaser.Game | null = null
let chart: echarts.ECharts | null = null
let reportChart: echarts.ECharts | null = null
let chartMode: ChartMode = 'species-abundance'
let statisticsScope: StatisticsScope = 'player'
let statisticsSpeciesCode = selectedCode
let selection: Selection = null
let selectedSamples: SelectedSample[] = []
let lastSelectedSampleAt = -Infinity
let allocationCommitTimer: number | null = null
let uiInterval: number | null = null
let reportShownFor: object | null = null
let manualReportWasPaused: boolean | null = null
let lastPropertyTableYear = -1
let gameStarted = false
let propertyIndividuals: Individual[] = []
let propertyRenderStart = -1
let propertyScrollFrame: number | null = null
let tutorialStep = 0
let lastChartRenderAt = -Infinity
let lastCompositionSignature = ''
let currentMapViewport: MapViewport = { left: 0, right: 100, bottom: 0, top: 100 }
let detailLayerHintDismissed = false
let inspectionSelectionKey = ''
const chartLegendSelections = new Map<ChartMode, Record<string, boolean>>()
let pinnedChartTooltip: PinnedChartTooltip | null = null
let chartTooltipRestoreFrame: number | null = null
let suppressChartTooltip = false

applyFontSize(readFontSize())
renderSetup()

function renderSetup(): void {
  appRoot.innerHTML = setupLayout(selectedStrategy, selectedCode, selectedScenario, selectedDensity, setupStep)
  document.querySelectorAll<HTMLButtonElement>('[data-scenario]').forEach((button) => {
    button.addEventListener('click', () => {
      selectedScenario = button.dataset.scenario as ScenarioId
      selectedDensity = SCENARIOS[selectedScenario].defaultDensity
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
  document.querySelector<HTMLInputElement>('#density-slider')?.addEventListener('input', (event) => {
    selectedDensity = densityFromSlider(Number((event.currentTarget as HTMLInputElement).value))
    updateDensityPreview()
  })
  document.querySelector<HTMLInputElement>('#density-input')?.addEventListener('input', (event) => {
    const input = event.currentTarget as HTMLInputElement
    if (input.value === '') return
    selectedDensity = clampDensity(Number(input.value))
    input.value = String(selectedDensity)
    const slider = document.querySelector<HTMLInputElement>('#density-slider')
    if (slider) slider.value = String(sliderFromDensity(selectedDensity))
    updateDensityPreview()
  })
  document.querySelector<HTMLButtonElement>('#wizard-back')?.addEventListener('click', () => {
    setupStep = Math.max(0, setupStep - 1) as SetupStep
    renderSetup()
  })
  document.querySelector<HTMLButtonElement>('#wizard-next')?.addEventListener('click', () => {
    setupStep = Math.min(4, setupStep + 1) as SetupStep
    renderSetup()
  })
  document.querySelector<HTMLButtonElement>('#start-game')?.addEventListener('click', startGame)
  bindFontControls()
}

function densityFromSlider(position: number): number {
  return clampDensity(10 + 390 * (Math.max(0, Math.min(100, position)) / 100) ** 2)
}

function sliderFromDensity(density: number): number {
  return Math.round(Math.sqrt((clampDensity(density) - 10) / 390) * 100)
}

function clampDensity(value: number): number {
  return Math.round(Math.max(10, Math.min(400, Number.isFinite(value) ? value : 10)))
}

function updateDensityPreview(): void {
  const total = selectedDensity * 25 + (selectedScenario === 'colonization' ? 6 : 0)
  setText('density-value', selectedDensity)
  setText('density-total', `${total.toLocaleString()} 个体`)
  const input = document.querySelector<HTMLInputElement>('#density-input')
  if (input && document.activeElement !== input) input.value = String(selectedDensity)
  setText(
    'density-impact',
    selectedDensity >= 150
      ? '高密度：以种子、幼苗和小径木为主，自疏压力强。'
      : selectedDensity >= 50
        ? '中等密度：小径木较多，竞争与林窗机会并存。'
        : '低密度：个体更少、平均胸径较大，空白生境更多。',
  )
}

function readFontSize(): FontSize {
  const stored = localStorage.getItem(FONT_STORAGE_KEY)
  return stored === 'small' || stored === 'large' ? stored : 'medium'
}

function applyFontSize(size: FontSize): void {
  document.documentElement.dataset.fontSize = size
}

function uiFontPx(base: number): number {
  const scale = { small: 0.94, medium: 1.08, large: 1.22 }[readFontSize()]
  return Math.round(base * scale)
}

function startGame(): void {
  const player = SPECIES.find((species) => species.code === selectedCode)!
  statisticsScope = 'player'
  statisticsSpeciesCode = selectedCode
  simulation = new ForestSimulation(SPECIES, selectedCode, {
    scenarioId: selectedScenario,
    densityPer400m2: selectedDensity,
  })
  appRoot.innerHTML = gameLayout(player, selectedScenario, simulation.activeSpecies)
  const speciesLayerTemplate = document.querySelector<HTMLTemplateElement>('#active-species-layer-template')
  const speciesLayerRows = document.querySelector<HTMLElement>('#species-layer-rows')
  if (speciesLayerTemplate && speciesLayerRows) speciesLayerRows.append(speciesLayerTemplate.content.cloneNode(true))
  gameStarted = false
  detailLayerHintDismissed = false
  chartLegendSelections.clear()
  pinnedChartTooltip = null
  suppressChartTooltip = false
  simulation.paused = true
  forestScene = new ForestScene(simulation, {
    onHover: showHoverTooltip,
    onSelectIndividuals: (ids) => {
      selection = ids.length > 0 ? { type: 'individuals', ids } : null
      hydrateSelectedSamples(ids)
      updateSelectedPanel()
      if (chartMode === 'selected') updateChart(true)
    },
    onSelectCell: (x, y, light) => {
      selection = { type: 'cell', x, y, light }
      selectedSamples = []
      lastSelectedSampleAt = -Infinity
      updateSelectedPanel()
    },
    onTransplant: (id) => {
      selection = { type: 'individuals', ids: [id] }
      hydrateSelectedSamples([id])
      updateSelectedPanel()
      updateEventPanel()
    },
    onViewportChange: updateMapScale,
  })
  game = new Phaser.Game({
    type: new URLSearchParams(window.location.search).get('renderer') === 'canvas' ? Phaser.CANVAS : Phaser.AUTO,
    parent: 'game-root',
    width: MAP_PIXEL_WIDTH,
    height: MAP_PIXEL_HEIGHT,
    backgroundColor: '#284b4f',
    render: { antialias: true, pixelArt: false },
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: forestScene,
  })
  chart = echarts.init(document.querySelector<HTMLDivElement>('#population-chart')!, undefined, { renderer: 'canvas' })
  if (import.meta.env.DEV) (window as Window & { __forestChart?: echarts.ECharts }).__forestChart = chart
  chart.on('legendselectchanged', (payload: unknown) => {
    const params = payload as { selected: Record<string, boolean> }
    chartLegendSelections.set(chartMode, { ...params.selected })
  })
  chart.on('showTip', (payload: unknown) => {
    const params = payload as { seriesIndex?: number; dataIndex?: number }
    if (suppressChartTooltip) {
      chart?.dispatchAction({ type: 'hideTip' })
      return
    }
    if (!Number.isInteger(params.seriesIndex) || !Number.isInteger(params.dataIndex)) return
    pinnedChartTooltip = { mode: chartMode, seriesIndex: params.seriesIndex!, dataIndex: params.dataIndex! }
  })
  chart.on('click', handleChartSpeciesClick)
  chart.on('dblclick', handleChartSpeciesDoubleClick)
  document.querySelector<HTMLElement>('#population-chart')?.addEventListener('pointermove', () => { suppressChartTooltip = false }, { capture: true })
  bindGameControls()
  window.setTimeout(() => applyMapStyle(readMapStyle()), 100)
  syncAllocationControls(simulation.allocation)
  updateUi()
  updateChart(true)
  uiInterval = window.setInterval(updateUi, 250)
  let resizeQueued = false
  const resizeObserver = new ResizeObserver(() => {
    if (resizeQueued) return
    resizeQueued = true
    window.requestAnimationFrame(() => {
      resizeQueued = false
      chart?.resize()
      reportChart?.resize()
      game?.scale.refresh()
    })
  })
  resizeObserver.observe(document.body)
  const gameRoot = document.querySelector<HTMLElement>('#game-root')
  const chartRoot = document.querySelector<HTMLElement>('#population-chart')
  if (gameRoot) resizeObserver.observe(gameRoot)
  if (chartRoot) resizeObserver.observe(chartRoot)
  if (localStorage.getItem(TUTORIAL_STORAGE_KEY) !== 'true') window.setTimeout(() => openTutorial(), 250)
}

function updateMapScale(viewport: MapViewport): void {
  currentMapViewport = viewport
  const interpolate = (start: number, end: number, index: number) => start + ((end - start) * index) / 4
  const format = (value: number) => {
    const rounded = Math.round(value * 10) / 10
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
  }
  for (let index = 0; index < 5; index += 1) {
    setText(`map-x-tick-${index}`, format(interpolate(viewport.left, viewport.right, index)))
    if (index > 0) setText(`map-y-tick-${index}`, format(interpolate(viewport.bottom, viewport.top, index)))
  }
  const widthMeters = Math.max(0.01, viewport.right - viewport.left)
  const zoom = 100 / widthMeters
  const lod = zoom < 2 ? 'overview' : zoom < 4.5 ? 'stand' : 'individual'
  setText('map-lod', lod)
  setText('map-extent', `${format(viewport.left)}–${format(viewport.right)} m × ${format(viewport.bottom)}–${format(viewport.top)} m`)
  const mapWidth = document.querySelector<HTMLElement>('#game-root')?.clientWidth ?? 960
  const targetMeters = (widthMeters * 110) / Math.max(1, mapWidth)
  const exponent = 10 ** Math.floor(Math.log10(Math.max(0.1, targetMeters)))
  const mantissa = targetMeters / exponent
  const niceMeters = (mantissa >= 5 ? 5 : mantissa >= 2 ? 2 : 1) * exponent
  setText('map-scale-text', `${format(niceMeters)} m`)
  const scaleLine = document.querySelector<HTMLElement>('#map-scale-line')
  if (scaleLine) scaleLine.style.width = `${Math.max(24, Math.min(160, (niceMeters / widthMeters) * mapWidth))}px`
  positionMapQuery()
  document.querySelector<HTMLElement>('#detail-layer-hint')?.classList.toggle(
    'hidden',
    widthMeters > 25 || detailLayerHintDismissed,
  )
}

function bindGameControls(): void {
  document.querySelector<HTMLButtonElement>('#help-button')!.addEventListener('click', () => openTutorial(true))
  bindFontControls()
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
  document.querySelector<HTMLInputElement>('#property-search')!.addEventListener('input', resetPropertyPage)
  document.querySelector<HTMLSelectElement>('#property-filter')!.addEventListener('change', resetPropertyPage)
  document.querySelector<HTMLSelectElement>('#property-sort')!.addEventListener('change', resetPropertyPage)
  document.querySelector<HTMLButtonElement>('#property-page-prev')!.addEventListener('click', () => scrollPropertyTable(-1))
  document.querySelector<HTMLButtonElement>('#property-page-next')!.addEventListener('click', () => scrollPropertyTable(1))
  document.querySelector<HTMLElement>('#property-table-wrap')!.addEventListener('scroll', () => {
    if (propertyScrollFrame !== null) return
    propertyScrollFrame = window.requestAnimationFrame(() => {
      propertyScrollFrame = null
      renderPropertyViewport()
    })
  })
  document.querySelector<HTMLButtonElement>('#reset-map-button')!.addEventListener('click', () => forestScene?.resetCamera())
  document.querySelector<HTMLButtonElement>('#map-zoom-in')?.addEventListener('click', () => forestScene?.zoomBy(1.35))
  document.querySelector<HTMLButtonElement>('#map-zoom-out')?.addEventListener('click', () => forestScene?.zoomBy(1 / 1.35))
  document.querySelector<HTMLButtonElement>('#focus-selected-button')!.addEventListener('click', focusSelected)
  document.querySelector<HTMLButtonElement>('#close-map-query')?.addEventListener('click', closeMapQuery)
  bindMapLayerControls()
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
  document.querySelector<HTMLSelectElement>('#chart-mode-select')?.addEventListener('change', (event) => {
    chartMode = (event.currentTarget as HTMLSelectElement).value as ChartMode
    clearPinnedChartTooltip(false)
    if (chartMode === 'selected') collectSelectedSample()
    syncChartModePicker()
    updateChart(true)
  })
  document.querySelectorAll<HTMLButtonElement>('[data-chart-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      const select = document.querySelector<HTMLSelectElement>('#chart-mode-select')
      if (!select) return
      select.value = button.dataset.chartMode ?? 'species-abundance'
      select.dispatchEvent(new Event('change', { bubbles: true }))
      document.querySelector<HTMLDetailsElement>('#chart-mode-menu')?.removeAttribute('open')
    })
  })
  document.querySelector<HTMLButtonElement>('#dismiss-detail-layer-hint')?.addEventListener('click', () => {
    detailLayerHintDismissed = true
    document.querySelector<HTMLElement>('#detail-layer-hint')?.classList.add('hidden')
  })
  document.querySelectorAll<HTMLButtonElement>('[data-legend-strategy]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!simulation) return
      const strategy = button.dataset.legendStrategy as Strategy
      const codes = simulation.activeSpecies.filter((species) => species.strategy === strategy).map((species) => species.code)
      document.querySelectorAll<HTMLInputElement>('[data-layer-key^="species:"]').forEach((checkbox) => {
        const code = checkbox.dataset.layerKey!.slice('species:'.length)
        checkbox.checked = codes.includes(code)
        forestScene?.setLayerVisibility(`species:${code}`, checkbox.checked)
      })
    })
  })
  const expandStatisticsButton = document.querySelector<HTMLButtonElement>('#expand-statistics-button')
  const syncStatisticsExpanded = () => {
    const expanded = document.querySelector<HTMLElement>('[data-panel-id="statistics"]')?.hasAttribute('data-maximized') ?? false
    expandStatisticsButton?.setAttribute('aria-expanded', String(expanded))
    if (expandStatisticsButton) expandStatisticsButton.textContent = expanded ? '恢复布局' : '放大查看'
  }
  expandStatisticsButton?.addEventListener('click', () => {
    window.ForestWorkspace?.initialize()?.togglePanelVertical('statistics')
    syncStatisticsExpanded()
    window.requestAnimationFrame(() => chart?.resize())
  })
  document.querySelector<HTMLElement>('#workspace-root')?.addEventListener('workspace:layoutchange', syncStatisticsExpanded)
  syncStatisticsExpanded()
  syncChartModePicker()
  document.querySelectorAll<HTMLButtonElement>('[data-stat-scope]').forEach((button) => {
    button.addEventListener('click', () => {
      const scope = button.dataset.statScope as StatisticsScope
      setStatisticsScope(scope, scope === 'species' ? statisticsSpeciesCode : undefined)
    })
  })
  document.querySelector<HTMLButtonElement>('#tutorial-next')!.addEventListener('click', advanceTutorial)
  document.querySelector<HTMLButtonElement>('#tutorial-skip')!.addEventListener('click', closeTutorial)
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return
    clearPinnedChartTooltip(true)
    document.querySelector<HTMLDetailsElement>('#chart-mode-menu')?.removeAttribute('open')
    if (selection) closeMapQuery()
  })
  document.addEventListener('pointerdown', (event) => {
    if (!selection || !(event.target instanceof Element)) return
    if (event.target.closest('#map-query-popover, #game-root, #property-drawer, .modal')) return
    closeMapQuery()
  })
}

function syncChartModePicker(): void {
  const select = document.querySelector<HTMLSelectElement>('#chart-mode-select')
  if (!select) return
  setText('chart-mode-label', select.selectedOptions[0]?.textContent?.trim() ?? '选择图表')
  document.querySelectorAll<HTMLButtonElement>('[data-chart-mode]').forEach((button) => {
    const active = button.dataset.chartMode === select.value
    button.classList.toggle('active', active)
    button.setAttribute('aria-current', active ? 'true' : 'false')
  })
}

function closeMapQuery(): void {
  selection = null
  selectedSamples = []
  lastSelectedSampleAt = -Infinity
  forestScene?.selectIndividuals([])
  updateSelectedPanel()
  if (chartMode === 'selected') updateChart(true)
}

function bindFontControls(): void {
  document.querySelectorAll<HTMLButtonElement>('.font-controls [data-font-size]').forEach((button) => {
    const size = button.dataset.fontSize as FontSize
    button.classList.toggle('active', size === readFontSize())
    button.setAttribute('aria-pressed', String(size === readFontSize()))
    button.addEventListener('click', () => {
      applyFontSize(size)
      localStorage.setItem(FONT_STORAGE_KEY, size)
      document.querySelectorAll<HTMLButtonElement>('.font-controls [data-font-size]').forEach((item) => {
        const active = item.dataset.fontSize === size
        item.classList.toggle('active', active)
        item.setAttribute('aria-pressed', String(active))
      })
      chart?.resize()
      reportChart?.resize()
      if (chart) updateChart(true)
      reportChart?.setOption({ textStyle: { fontSize: uiFontPx(10) } })
      game?.scale.refresh()
    })
  })
}

function bindMapLayerControls(): void {
  document.querySelectorAll<HTMLInputElement>('[data-layer-key]').forEach((checkbox) => {
    checkbox.addEventListener('change', () => {
      const key = checkbox.dataset.layerKey!
      forestScene?.setLayerVisibility(key, checkbox.checked)
      if (key === 'axes') document.querySelector<HTMLElement>('#map-scale-overlay')?.classList.toggle('hide-axes', !checkbox.checked)
      if (key === 'grid') document.querySelector<HTMLElement>('#map-scale-overlay')?.classList.toggle('hide-grid', !checkbox.checked)
      if (key === 'subgrid') document.querySelector<HTMLElement>('#map-scale-overlay')?.classList.toggle('show-subgrid', checkbox.checked)
    })
  })
  document.querySelectorAll<HTMLElement>('[data-species-layer]').forEach((row) => {
    const code = row.dataset.speciesLayer!
    row.addEventListener('click', (event) => {
      if ((event.target as Element).matches('input')) return
      selectStatisticsSpecies(code)
    })
    row.addEventListener('dblclick', (event) => {
      event.preventDefault()
      openSpeciesProperties(code)
    })
  })
  document.querySelector<HTMLButtonElement>('#layer-show-all')?.addEventListener('click', () => {
    document.querySelectorAll<HTMLInputElement>('[data-layer-key]').forEach((checkbox) => { checkbox.checked = true })
    forestScene?.showAllLayers()
  })
  document.querySelector<HTMLButtonElement>('#layer-isolate')?.addEventListener('click', () => {
    if (!simulation) return
    statisticsSpeciesCode = simulation.playerCode
    forestScene?.setSpeciesFocus(simulation.playerCode)
    setStatisticsScope('player', simulation.playerCode)
  })
  document.querySelector<HTMLButtonElement>('#layer-zoom')?.addEventListener('click', () => {
    if (!simulation) return
    const code = statisticsScope === 'player' ? simulation.playerCode : statisticsSpeciesCode
    forestScene?.zoomToSpecies(code)
  })

  const updateStyle = (style: Partial<SavedMapStyle>) => {
    const next = { ...readMapStyle(), ...style }
    localStorage.setItem(MAP_STYLE_STORAGE_KEY, JSON.stringify(next))
    applyMapStyle(next)
  }
  document.querySelector<HTMLInputElement>('#player-color-picker')?.addEventListener('input', (event) => {
    updateStyle({ color: (event.currentTarget as HTMLInputElement).value })
  })
  document.querySelectorAll<HTMLButtonElement>('[data-player-color]').forEach((button) => {
    button.addEventListener('click', () => updateStyle({ color: button.dataset.playerColor! }))
  })
  document.querySelectorAll<HTMLButtonElement>('[data-marker-size]').forEach((button) => {
    button.addEventListener('click', () => updateStyle({ size: button.dataset.markerSize as MarkerSize }))
  })
  document.querySelector<HTMLButtonElement>('#reset-player-style')?.addEventListener('click', () => {
    localStorage.removeItem(MAP_STYLE_STORAGE_KEY)
    applyMapStyle({ color: '#ffffff', size: 'medium' })
  })
}

function readMapStyle(): SavedMapStyle {
  try {
    const value = JSON.parse(localStorage.getItem(MAP_STYLE_STORAGE_KEY) ?? '{}') as Partial<SavedMapStyle>
    const color = typeof value.color === 'string' && /^#[0-9a-f]{6}$/i.test(value.color) ? value.color : '#ffffff'
    const size = value.size === 'small' || value.size === 'large' ? value.size : 'medium'
    return { color, size }
  } catch {
    return { color: '#ffffff', size: 'medium' }
  }
}

function applyMapStyle(style: SavedMapStyle): void {
  const colorValue = Number.parseInt(style.color.slice(1), 16)
  const red = (colorValue >> 16) & 0xff
  const green = (colorValue >> 8) & 0xff
  const blue = colorValue & 0xff
  const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255
  const sizeScale = style.size === 'small' ? 0.82 : style.size === 'large' ? 1.25 : 1
  forestScene?.setPlayerMarkerStyle({
    fillColor: colorValue,
    strokeColor: luminance > 0.55 ? 0x17372f : 0xffffff,
    sizeScale,
  })
  const picker = document.querySelector<HTMLInputElement>('#player-color-picker')
  if (picker) picker.value = style.color
  document.querySelectorAll<HTMLButtonElement>('[data-player-color]').forEach((button) => {
    button.classList.toggle('active', button.dataset.playerColor?.toLowerCase() === style.color.toLowerCase())
  })
  document.querySelectorAll<HTMLButtonElement>('[data-marker-size]').forEach((button) => {
    button.classList.toggle('active', button.dataset.markerSize === style.size)
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
  setText('forest-phase', !gameStarted ? '观察准备期 · 检查地图后开始' : simulation.longTermUnlocked ? '长期演替期' : '种群建立期 · 第 100 年首次结算')
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
    button.title = simulation!.longTermUnlocked ? '' : '第 100 年结算后解锁'
  })
  const observationOnly = population.length === 0
  document.querySelectorAll<HTMLInputElement>('[data-allocation]').forEach((input) => { input.disabled = observationOnly })
  document.querySelectorAll<HTMLButtonElement>('[data-allocation-preset]').forEach((button) => { button.disabled = observationOnly })
  updateAbilityButtons()
  updateStatisticsPanel()
  updateEventPanel()
  updateSelectedPanel()
  collectSelectedSample()
  if (document.querySelector('#properties-drawer:not(.hidden)') && Math.floor(simulation.forestYear) !== lastPropertyTableYear) renderPropertyTable()
  updateChart()
  if (simulation.report && reportShownFor !== simulation.report) showReport(simulation.report, false)
}

function updateAbilityButtons(): void {
  if (!simulation) return
  for (const ability of ['defense', 'mast', 'disperse', 'nursery'] as ActiveAbility[]) {
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

function setStatisticsScope(scope: StatisticsScope, speciesCode?: string): void {
  statisticsScope = scope
  if (speciesCode) statisticsSpeciesCode = speciesCode
  if (scope === 'community') forestScene?.setSpeciesFocus(null)
  document.querySelectorAll<HTMLButtonElement>('[data-stat-scope]').forEach((button) => {
    const active = button.dataset.statScope === scope
    button.classList.toggle('active', active)
    button.setAttribute('aria-pressed', String(active))
  })
  updateStatisticsPanel()
  if (chartMode === 'trend') updateChart(true)
}

function selectStatisticsSpecies(speciesCode: string): void {
  if (!simulation?.activeSpecies.some((species) => species.code === speciesCode)) return
  statisticsSpeciesCode = speciesCode
  setStatisticsScope(speciesCode === simulation.playerCode ? 'player' : 'species', speciesCode)
  document.querySelectorAll<HTMLElement>('[data-species-layer]').forEach((row) => {
    row.classList.toggle('active', row.dataset.speciesLayer === speciesCode)
  })
}

function updateStatisticsPanel(): void {
  if (!simulation) return
  const code = statisticsScope === 'player' ? simulation.playerCode : statisticsSpeciesCode
  const speciesStats = simulation.speciesStatistics(code)
  const communityStats = simulation.communityStatistics()
  const targetPopulation = statisticsScope === 'community' ? simulation.individuals : simulation.population(code)
  const targetSpecies = simulation.activeSpecies.find((species) => species.code === code)
  const title = statisticsScope === 'community'
    ? '整个群落'
    : `${targetSpecies?.name ?? code}${code === simulation.playerCode ? ' · 玩家' : ''}`
  setText('statistics-title', title)
  setText('population-total', statisticsScope === 'community' ? communityStats.total : speciesStats?.total ?? 0)
  setText('average-health', `${Math.round((statisticsScope === 'community' ? communityStats.averageHealth : speciesStats?.averageHealth ?? 0) * 100)}%`)
  setText('population-share', statisticsScope === 'community' ? `${communityStats.speciesRichness} 个物种` : `${Math.round((speciesStats?.share ?? 0) * 100)}%`)
  setText('risk-count', String(targetPopulation.filter((individual) => individual.riskScore >= RISK_THRESHOLD).length))
  setText('canopy-cover', `${Math.round(communityStats.canopyCover * 100)}%`)
  setText('average-light', `${Math.round(average(targetPopulation.map((individual) => simulation!.lightAt(individual.x, individual.y))) * 100)}%`)
  setText('statistics-dbh', `${(statisticsScope === 'community' ? communityStats.averageDbh : speciesStats?.averageDbh ?? 0).toFixed(1)} cm`)
  setText('statistics-basal-area', `${(statisticsScope === 'community' ? communityStats.basalAreaM2 : speciesStats?.basalAreaM2 ?? 0).toFixed(2)} m²`)
  setText('statistics-carbon-year', `${(statisticsScope === 'community' ? communityStats.annualCarbonSequestered : speciesStats?.annualCarbonSequestered ?? 0).toFixed(1)}`)
  setText('statistics-carbon-total', `${(statisticsScope === 'community' ? communityStats.cumulativeCarbonSequestered : speciesStats?.cumulativeCarbonSequestered ?? 0).toFixed(1)}`)
  updateStageBar(targetPopulation)
  renderCommunityComposition()
}

function renderCommunityComposition(): void {
  if (!simulation) return
  const container = document.querySelector<HTMLElement>('#community-composition')
  if (!container) return
  const rows = simulation.activeSpecies
    .map((species) => ({ species, statistics: simulation!.speciesStatistics(species.code)! }))
    .sort((first, second) => second.statistics.total - first.statistics.total)
  const signature = `${statisticsSpeciesCode}:${rows.map(({ species, statistics }) => `${species.code}:${statistics.total}`).join('|')}`
  if (signature === lastCompositionSignature) return
  lastCompositionSignature = signature
  container.innerHTML = rows.map(({ species, statistics }) => `
    <button type="button" class="composition-row ${species.code === statisticsSpeciesCode ? 'active' : ''}" data-composition-species="${species.code}" title="单击查看统计，双击打开属性表">
      <span>${species.name}${species.code === simulation!.playerCode ? ' · 玩家' : ''}</span>
      <i><b style="width:${Math.max(0, statistics.share * 100)}%;background:${speciesColor(species.code)}"></b></i>
      <strong>${statistics.total.toLocaleString()} · ${Math.round(statistics.share * 100)}%</strong>
    </button>`).join('')
  container.querySelectorAll<HTMLButtonElement>('[data-composition-species]').forEach((button) => {
    button.addEventListener('click', () => selectStatisticsSpecies(button.dataset.compositionSpecies!))
    button.addEventListener('dblclick', () => openSpeciesProperties(button.dataset.compositionSpecies!))
  })
}

function updateEventPanel(): void {
  if (!simulation) return
  const headline = document.querySelector<HTMLElement>('#event-headline')
  const message = document.querySelector<HTMLElement>('#event-message')
  const panel = document.querySelector<HTMLElement>('.event-panel')
  if (!headline || !message || !panel) return
  if (!gameStarted) {
    headline.textContent = '观察准备期'
    message.textContent = '时间已暂停。先查看自己的白色五角星、局部光照和生命史投资，再开始演替。'
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
    const emergency = simulation.emergencyEvents.at(-1)
    const summary = simulation.fiveYearSummaries.at(-1)
    if (emergency && simulation.forestYear - emergency.time <= 1) {
      headline.textContent = `突发事件 · 第 ${emergency.time.toFixed(1)} 年`
      message.textContent = emergency.message
      panel.dataset.tone = emergency.tone
    } else if (summary) {
      const change = `${summary.playerPopulationChange >= 0 ? '+' : ''}${summary.playerPopulationChange}`
      const percent = summary.playerPopulationChangePercent === null ? '' : `（${summary.playerPopulationChangePercent >= 0 ? '+' : ''}${Math.round(summary.playerPopulationChangePercent * 100)}%）`
      headline.textContent = `第 ${summary.time} 年 · 五年群落摘要`
      message.textContent = `${summary.dominantCanopySpeciesName ? `冠层优势物种为${summary.dominantCanopySpeciesName}，占冠层 ${Math.round(summary.dominantCanopyShare * 100)}%` : '尚未形成明确冠层优势种'}；玩家种群现有 ${summary.playerPopulation} 个，五年变化 ${change}${percent}。`
      panel.dataset.tone = summary.playerPopulationChange < 0 ? 'warning' : summary.playerPopulationChange > 0 ? 'good' : 'neutral'
    } else {
      headline.textContent = '群落建立中'
      message.textContent = '第 5 年将生成首份群落摘要；突发扰动与虫害会即时显示。'
      panel.dataset.tone = 'neutral'
    }
  }
}

function updateSelectedPanel(): void {
  if (!simulation) return
  const popover = document.querySelector<HTMLElement>('#map-query-popover')
  const title = document.querySelector<HTMLElement>('#selected-title')
  const content = document.querySelector<HTMLElement>('#selected-content')
  const focusButton = document.querySelector<HTMLButtonElement>('#focus-selected-button')
  if (!title || !content || !focusButton) return
  const currentSelectionKey = selection?.type === 'cell'
    ? `cell:${selection.x.toFixed(4)}:${selection.y.toFixed(4)}`
    : selection?.type === 'individuals'
      ? `individuals:${selection.ids.join(',')}`
      : ''
  const keepDetailsOpen = currentSelectionKey === inspectionSelectionKey && Boolean(content.querySelector<HTMLDetailsElement>('.inspection-details')?.open)
  inspectionSelectionKey = currentSelectionKey
  popover?.classList.toggle('hidden', !selection)
  popover?.setAttribute('aria-hidden', String(!selection))
  focusButton.classList.toggle('hidden', selection?.type !== 'individuals' || selection.ids.length !== 1)
  if (!selection) {
    title.textContent = '点击一个个体或空地'
    content.className = 'selected-content empty'
    content.textContent = '白色五角星是自己的个体；幼苗和幼树可拖动移栽，风险标记可在个体尺度按需开启。'
    return
  }
  if (selection.type === 'cell') {
    const selectedCell = selection
    const nearby = simulation.individuals.filter((individual) =>
      Math.hypot((individual.x - selectedCell.x) * simulation!.mapWidthMeters, (individual.y - selectedCell.y) * simulation!.mapHeightMeters) < 2,
    )
    title.textContent = `位置 ${(selection.x * simulation.mapWidthMeters).toFixed(1)} m, ${(selection.y * simulation.mapHeightMeters).toFixed(1)} m`
    content.className = 'selected-content'
    content.innerHTML = `${statusGrid([
      ['林下光照', `${Math.round(simulation.lightAt(selection.x, selection.y) * 100)}%`],
      ['2 m 邻域个体', String(nearby.length)],
    ])}<details class="inspection-details"><summary>展开邻域详情</summary>${statusGrid([
      ['邻域林冠', String(nearby.filter((individual) => individual.canopy).length)],
      ['风险个体', String(nearby.filter((individual) => individual.riskScore >= RISK_THRESHOLD).length)],
    ])}</details>`
    const details = content.querySelector<HTMLDetailsElement>('.inspection-details')
    if (details) details.open = keepDetailsOpen
    positionMapQuery()
    return
  }
  const individuals = selection.ids.map((id) => simulation!.findIndividual(id)).filter((item): item is Individual => Boolean(item))
  if (individuals.length === 0) {
    title.textContent = '选中个体已经死亡'
    content.className = 'selected-content empty'
    content.textContent = '红色叉号表示新近死亡，会在原位置停留约 1.5 秒；死亡原因仍保留在事件与导出数据中。'
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
    positionMapQuery()
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
    ['局部光照', `${Math.round(simulation.lightAt(individual.x, individual.y) * 100)}%`],
  ])}<details class="inspection-details"><summary>展开完整属性</summary>${statusGrid([
    ['综合风险', `${Math.round(individual.riskScore * 100)}%`],
    ['局部光照', `${Math.round(simulation.lightAt(individual.x, individual.y) * 100)}%`],
    ['竞争压力', `${Math.round(individual.competitionPressure * 100)}%`],
    ['病原菌压力', `${Math.round(individual.pathogenPressure * 100)}%`],
    ['虫害压力', `${Math.round(individual.insectPressure * 100)}%`],
    ['林冠个体', individual.canopy ? `是（≥ ${CANOPY_HEIGHT_METERS} m）` : '否'],
    ['坐标', `${(individual.x * simulation.mapWidthMeters).toFixed(1)}, ${(individual.y * simulation.mapHeightMeters).toFixed(1)} m`],
  ])}</details><p class="inspection-note">${own && simulation.canTransplant(individual) ? '可拖动移栽一次，健康付出 4%。' : '点击“定位”放大查看该个体。'}</p>`
  const details = content.querySelector<HTMLDetailsElement>('.inspection-details')
  if (details) details.open = keepDetailsOpen
  positionMapQuery()
}

function positionMapQuery(): void {
  if (!selection) return
  const popover = document.querySelector<HTMLElement>('#map-query-popover')
  const gameRoot = document.querySelector<HTMLElement>('#game-root')
  const container = document.querySelector<HTMLElement>('.workspace-map-main')
  if (!popover || !gameRoot || !container) return
  let x: number
  let y: number
  if (selection.type === 'cell') {
    x = selection.x * 100
    y = selection.y * 100
  } else {
    const selected = selection.ids.map((id) => simulation?.findIndividual(id)).filter((item): item is Individual => Boolean(item))
    if (selected.length === 0) return
    x = average(selected.map((item) => item.x)) * 100
    y = average(selected.map((item) => item.y)) * 100
  }
  const rootRect = gameRoot.getBoundingClientRect()
  const containerRect = container.getBoundingClientRect()
  const visibleWidth = Math.max(0.01, currentMapViewport.right - currentMapViewport.left)
  const visibleHeight = Math.max(0.01, currentMapViewport.top - currentMapViewport.bottom)
  const anchorX = rootRect.left - containerRect.left + ((x - currentMapViewport.left) / visibleWidth) * rootRect.width
  const anchorY = rootRect.top - containerRect.top + ((currentMapViewport.top - y) / visibleHeight) * rootRect.height
  const width = popover.offsetWidth || 300
  const height = popover.offsetHeight || 220
  popover.style.left = `${Math.max(4, Math.min(container.clientWidth - width - 16, anchorX))}px`
  popover.style.top = `${Math.max(4, Math.min(container.clientHeight - height - 16, anchorY))}px`
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
}

function hydrateSelectedSamples(ids: number[]): void {
  selectedSamples = []
  lastSelectedSampleAt = -Infinity
  if (!simulation || ids.length === 0) return

  const selectedIds = new Set(ids)
  const snapshotsByTime = new Map<number, Map<number, IndividualSnapshot>>()
  for (const snapshot of simulation.individualSnapshots) {
    if (!snapshot.alive || !selectedIds.has(snapshot.individualId)) continue
    let snapshotsAtTime = snapshotsByTime.get(snapshot.time)
    if (!snapshotsAtTime) {
      snapshotsAtTime = new Map()
      snapshotsByTime.set(snapshot.time, snapshotsAtTime)
    }
    // Stage changes may create another record at the same instant. The latest
    // snapshot is the authoritative state and must not double-weight the mean.
    snapshotsAtTime.set(snapshot.individualId, snapshot)
  }

  selectedSamples = [...snapshotsByTime.entries()]
    .sort(([firstTime], [secondTime]) => firstTime - secondTime)
    .map(([time, snapshots]) => {
      const values = [...snapshots.values()]
      return {
        time,
        height: average(values.map((snapshot) => snapshot.height)),
        light: average(values.map((snapshot) => snapshot.localLight)) * 100,
        health: average(values.map((snapshot) => snapshot.health)) * 100,
      }
    })

  lastSelectedSampleAt = selectedSamples.at(-1)?.time ?? -Infinity
  collectSelectedSample()
}

function clearPinnedChartTooltip(suppressUntilPointerMove = false): void {
  pinnedChartTooltip = null
  suppressChartTooltip = suppressUntilPointerMove
  if (chartTooltipRestoreFrame !== null) {
    window.cancelAnimationFrame(chartTooltipRestoreFrame)
    chartTooltipRestoreFrame = null
  }
  chart?.setOption({ tooltip: { alwaysShowContent: false, hideDelay: 0 } }, false)
  chart?.dispatchAction({ type: 'updateAxisPointer', currTrigger: 'leave' })
  chart?.dispatchAction({ type: 'hideTip' })
}

function setChartOption(option: echarts.EChartsCoreOption, notMerge = true): void {
  if (!chart) return
  const selected = chartLegendSelections.get(chartMode)
  if (selected && option.legend) {
    type LegendOption = { selected?: Record<string, boolean> }
    if (Array.isArray(option.legend)) {
      option.legend = option.legend.map((legend) => ({ ...legend, selected: { ...(legend as LegendOption).selected, ...selected } }))
    } else option.legend = { ...option.legend, selected: { ...(option.legend as LegendOption).selected, ...selected } }
  }
  chart.setOption(option, notMerge)
  if (chartTooltipRestoreFrame !== null) window.cancelAnimationFrame(chartTooltipRestoreFrame)
  if (pinnedChartTooltip?.mode !== chartMode) return
  const pinned = pinnedChartTooltip
  chartTooltipRestoreFrame = window.requestAnimationFrame(() => {
    chartTooltipRestoreFrame = null
    if (!chart || pinnedChartTooltip !== pinned) return
    chart.dispatchAction({ type: 'showTip', seriesIndex: pinned.seriesIndex, dataIndex: pinned.dataIndex })
  })
}

function updateChart(force = false): void {
  if (!simulation || !chart) return
  const now = performance.now()
  if (!force && now < lastChartRenderAt + 750) return
  lastChartRenderAt = now
  const common = {
    animation: false,
    textStyle: { fontFamily: 'Inter, ui-sans-serif, system-ui', color: '#344b42', fontSize: uiFontPx(10) },
    tooltip: { trigger: 'axis' as const, alwaysShowContent: true, confine: true, backgroundColor: '#152d26', borderWidth: 0, textStyle: { color: '#fff' } },
    grid: { left: 42, right: 26, top: 32, bottom: 30 },
  }
  if (chartMode === 'species-abundance') {
    setText('chart-title', '各物种个体数 · 此消彼长')
    const years = [...new Set(simulation.speciesHistory.map((sample) => sample.time))].sort((a, b) => a - b)
    setChartOption({
      ...common,
      legend: { type: 'scroll', top: 0, textStyle: { fontSize: uiFontPx(8) } },
      xAxis: { type: 'category', data: years.map((year) => `${year.toFixed(0)}年`), boundaryGap: false },
      yAxis: { type: 'value', name: '个体数', min: 0, minInterval: 1 },
      series: simulation.activeSpecies.map((species) => {
        const byYear = new Map(simulation!.speciesHistory.filter((sample) => sample.speciesCode === species.code).map((sample) => [sample.time, sample.total]))
        return { name: species.name, type: 'line', data: years.map((year) => byYear.get(year) ?? null), showSymbol: false, connectNulls: true, lineStyle: { width: species.code === simulation!.playerCode ? 3 : 1.7, color: speciesColor(species.code) }, itemStyle: { color: speciesColor(species.code) } }
      }),
    }, true)
    return
  }
  if (chartMode === 'functional-abundance') {
    setText('chart-title', '各功能型个体数 · 此消彼长')
    const years = [...new Set(simulation.speciesHistory.map((sample) => sample.time))].sort((a, b) => a - b)
    const strategyKeys = Object.keys(STRATEGIES) as Strategy[]
    setChartOption({
      ...common,
      legend: { top: 0 },
      xAxis: { type: 'category', data: years.map((year) => `${year.toFixed(0)}年`), boundaryGap: false },
      yAxis: { type: 'value', name: '个体数', min: 0, minInterval: 1 },
      series: strategyKeys.map((strategy) => ({
        name: STRATEGIES[strategy].name,
        type: 'line',
        data: years.map((year) => simulation!.speciesHistory
          .filter((sample) => sample.time === year && simulation!.activeSpecies.find((species) => species.code === sample.speciesCode)?.strategy === strategy)
          .reduce((sum, sample) => sum + sample.total, 0)),
        showSymbol: false,
        lineStyle: { width: 2.5, color: STRATEGIES[strategy].css },
        itemStyle: { color: STRATEGIES[strategy].css },
      })),
    }, true)
    return
  }
  if (chartMode === 'functional-demography-counts' || chartMode === 'functional-demography-rates') {
    const rates = chartMode === 'functional-demography-rates'
    setText('chart-title', rates ? '功能型年度出生率与死亡率' : '功能型年度出生与死亡个体')
    const history = simulation.functionalTypeHistory
    const years = [...new Set(history.map((sample) => sample.time))].sort((a, b) => a - b)
    const strategyKeys = Object.keys(STRATEGIES) as Strategy[]
    const samplesFor = (strategy: Strategy) => new Map(history.filter((sample) => sample.strategy === strategy).map((sample) => [sample.time, sample]))
    document.querySelector<HTMLElement>('#population-chart')?.setAttribute('aria-label', `${rates ? '功能型年度出生率与死亡率' : '功能型年度出生与死亡个体'}；死亡曲线使用虚线，并在图例中标注。`)
    setChartOption({
      ...common,
      legend: { type: 'scroll', top: 0, textStyle: { fontSize: uiFontPx(8) } },
      grid: { left: 44, right: 46, top: 52, bottom: 30 },
      xAxis: { type: 'category', data: years.map((year) => `${year.toFixed(0)}年`) },
      yAxis: { type: 'value', name: rates ? '每100个体/年' : '个体数', min: 0 },
      series: strategyKeys.flatMap((strategy) => {
        const byYear = samplesFor(strategy)
        const name = STRATEGIES[strategy].name
        const color = STRATEGIES[strategy].css
        return [
          {
            name: `${name}${rates ? '出生率' : '出生'}`,
            type: 'line',
            data: years.map((year) => rates ? (byYear.get(year)?.birthsPer100 ?? 0).toFixed(2) : byYear.get(year)?.births ?? 0),
            showSymbol: false,
            lineStyle: { color, width: 2.2 },
            itemStyle: { color },
          },
          {
            name: `${name}${rates ? '死亡率' : '死亡'}（虚线）`,
            type: 'line',
            data: years.map((year) => rates ? (byYear.get(year)?.deathsPer100 ?? 0).toFixed(2) : byYear.get(year)?.deaths ?? 0),
            showSymbol: false,
            lineStyle: { color, width: 2.4, type: 'dashed' },
            itemStyle: { color },
          },
        ]
      }),
    }, true)
    return
  }
  if (chartMode === 'stage-composition') {
    setText('chart-title', '群落生活史阶段结构')
    const history = simulation.communityHistory
    setChartOption({
      ...common,
      legend: { data: ['种子', '幼苗', '幼树', '成树'], top: 0 },
      xAxis: { type: 'category', data: history.map((sample) => `${sample.time.toFixed(0)}年`), boundaryGap: false },
      yAxis: { type: 'value', name: '个体数', min: 0 },
      series: [
        { name: '种子', key: 'seeds', color: '#cbbd94' }, { name: '幼苗', key: 'seedlings', color: '#94b98d' },
        { name: '幼树', key: 'saplings', color: '#5f9978' }, { name: '成树', key: 'adults', color: '#274f45' },
      ].map(({ name, key, color }) => ({ name, type: 'line', stack: 'stage', areaStyle: {}, showSymbol: false, data: history.map((sample) => sample[key as 'seeds']), lineStyle: { color }, itemStyle: { color } })),
    }, true)
    return
  }
  if (chartMode === 'basal-area' || chartMode === 'diversity') {
    const history = simulation.communityHistory
    const basalArea = chartMode === 'basal-area'
    setText('chart-title', basalArea ? '群落胸高断面积变化' : '群落物种丰富度变化')
    setChartOption({
      ...common,
      xAxis: { type: 'category', data: history.map((sample) => `${sample.time.toFixed(0)}年`), boundaryGap: false },
      yAxis: { type: 'value', name: basalArea ? 'm²' : '物种数', min: 0, minInterval: basalArea ? undefined : 1 },
      series: [{ name: basalArea ? '胸高断面积' : '物种丰富度', type: 'line', areaStyle: { opacity: 0.12 }, showSymbol: false, data: history.map((sample) => basalArea ? sample.basalAreaM2.toFixed(2) : sample.speciesRichness), lineStyle: { color: '#356b57', width: 2.5 }, itemStyle: { color: '#356b57' } }],
    }, true)
    return
  }
  if (chartMode === 'composition') {
    setText('chart-title', '群落物种组成 · 点击联动图层')
    const rows = simulation.activeSpecies
      .map((species) => ({ species, statistics: simulation!.speciesStatistics(species.code)! }))
      .sort((first, second) => first.statistics.total - second.statistics.total)
    setChartOption({
      ...common,
      grid: { left: 76, right: 42, top: 18, bottom: 30 },
      xAxis: { type: 'value', name: '个体', minInterval: 1, splitLine: { lineStyle: { color: '#dfe6dd' } } },
      yAxis: { type: 'category', data: rows.map(({ species }) => `${species.name}${species.code === simulation!.playerCode ? ' · 玩家' : ''}`), axisLabel: { fontSize: uiFontPx(9) } },
      series: [{
        name: '个体数', type: 'bar',
        data: rows.map(({ species, statistics }) => ({
          value: statistics.total,
          speciesCode: species.code,
          itemStyle: { color: speciesColor(species.code) },
        })),
        label: { show: true, position: 'right', formatter: ({ value }: { value: number }) => `${value}` },
      }],
    }, true)
    return
  }
  if (chartMode === 'carbon') {
    setText('chart-title', '群落年度与累计固碳 · 游戏碳单位')
    const history = simulation.communityHistory
    setChartOption({
      ...common,
      legend: { data: ['年度固碳', '累计固碳'], top: 0 },
      xAxis: { type: 'category', data: history.map((sample) => `${sample.time.toFixed(0)}年`), boundaryGap: false },
      yAxis: [{ type: 'value', name: '年度' }, { type: 'value', name: '累计', min: 0 }],
      series: [
        { name: '年度固碳', type: 'bar', data: history.map((sample) => sample.annualCarbonSequestered.toFixed(2)), itemStyle: { color: '#69a879' } },
        { name: '累计固碳', type: 'line', yAxisIndex: 1, data: history.map((sample) => sample.cumulativeCarbonSequestered.toFixed(2)), showSymbol: false, lineStyle: { color: '#285447', width: 2.5 } },
      ],
    }, true)
    return
  }
  if (chartMode === 'selected') {
    const selectedCount = selection?.type === 'individuals' ? selection.ids.length : 0
    setText('chart-title', selectedCount > 1 ? `${selectedCount} 个选中对象的平均轨迹` : '选中个体的局部轨迹')
    if (selectedSamples.length === 0) {
      chart.clear()
      setChartOption({ title: { text: '请先点击或多选地图中的个体', left: 'center', top: 'middle', textStyle: { fontSize: 13, color: '#7c8d84' } } })
      return
    }
    const firstSelectedYear = selectedSamples[0].time
    const selectedYearMax = Math.max(simulation.forestYear, firstSelectedYear + 0.5)
    setChartOption({
      ...common,
      legend: { data: ['树高（m）', '局部光照（%）', '健康（%）'], top: 0 },
      xAxis: { type: 'value', min: firstSelectedYear, max: selectedYearMax, boundaryGap: [0, 0], axisLabel: { formatter: (value: number) => `${value.toFixed(value < 10 ? 1 : 0)}年` } },
      yAxis: [{ type: 'value', name: 'm' }, { type: 'value', name: '%', min: 0, max: 100 }],
      series: [
        { name: '树高（m）', type: 'line', data: selectedSamples.map((sample) => [sample.time, Number(sample.height.toFixed(2))]), showSymbol: selectedSamples.length === 1 },
        { name: '局部光照（%）', type: 'line', yAxisIndex: 1, data: selectedSamples.map((sample) => [sample.time, Number(sample.light.toFixed(0))]), showSymbol: selectedSamples.length === 1 },
        { name: '健康（%）', type: 'line', yAxisIndex: 1, data: selectedSamples.map((sample) => [sample.time, Number(sample.health.toFixed(0))]), showSymbol: selectedSamples.length === 1 },
      ],
    }, true)
    return
  }
  const trendCode = statisticsScope === 'player' ? simulation.playerCode : statisticsSpeciesCode
  const trendSpecies = simulation.activeSpecies.find((species) => species.code === trendCode)
  const trendHistory = statisticsScope === 'community'
    ? simulation.communityHistory
    : simulation.speciesHistory.filter((sample) => sample.speciesCode === trendCode)
  setText('chart-title', statisticsScope === 'community' ? '整个群落走势' : `${trendSpecies?.name ?? trendCode}种群走势`)
  setChartOption({
    ...common,
    legend: { data: ['全部个体', '成树', '平均健康', '累计固碳'], top: 0, textStyle: { fontSize: uiFontPx(9) } },
    xAxis: { type: 'category', data: trendHistory.map((sample) => `${sample.time.toFixed(0)}年`), boundaryGap: false },
    yAxis: [{ type: 'value', name: '个体' }, { type: 'value', name: '% / 储备', min: 0 }],
    series: [
      { name: '全部个体', type: 'line', data: trendHistory.map((sample) => sample.total), showSymbol: false, lineStyle: { color: speciesColor(trendCode), width: 2.5 } },
      { name: '成树', type: 'line', data: trendHistory.map((sample) => 'adults' in sample ? sample.adults : 0), showSymbol: false, lineStyle: { color: '#335f50' } },
      { name: '平均健康', type: 'line', yAxisIndex: 1, data: trendHistory.map((sample) => Math.round(sample.averageHealth * 100)), showSymbol: false, lineStyle: { color: '#a85246' } },
      { name: '累计固碳', type: 'line', yAxisIndex: 1, data: trendHistory.map((sample) => sample.cumulativeCarbonSequestered.toFixed(1)), showSymbol: false, lineStyle: { color: '#6d7fb9', type: 'dashed' } },
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
  setText(
    'report-kicker',
    manual
      ? '当前阶段报告 · 主动查看'
      : report.kind === 'player-extinct'
        ? '玩家物种灭绝 · 可继续观察'
        : report.kind === 'community-extinct'
          ? '森林群落终局'
          : '首次阶段复盘 · 长期演替即将解锁',
  )
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
  continueButton.hidden = !report.canContinue
  continueButton.textContent = manual
    ? '返回森林'
    : report.kind === 'player-extinct'
      ? '继续观察森林'
      : '进入长期演替'
  document.querySelector<HTMLElement>('#report-modal')!.classList.remove('hidden')
  reportChart?.dispose()
  reportChart = echarts.init(document.querySelector<HTMLDivElement>('#report-chart')!, undefined, { renderer: 'canvas' })
  reportChart.setOption({
    animation: false,
    textStyle: { fontSize: uiFontPx(10) },
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
  const wrap = document.querySelector<HTMLElement>('#property-table-wrap')
  if (wrap) wrap.scrollTop = 0
  renderPropertyTable()
}

function openSpeciesProperties(speciesCode: string): void {
  const search = document.querySelector<HTMLInputElement>('#property-search')
  const filter = document.querySelector<HTMLSelectElement>('#property-filter')
  if (search) search.value = speciesCode
  if (filter) filter.value = 'all'
  openProperties()
}

function handleChartSpeciesClick(params: { seriesType?: string; data?: unknown }): void {
  if (chartMode !== 'composition' || params.seriesType !== 'bar' || !params.data || typeof params.data !== 'object') return
  const speciesCode = (params.data as { speciesCode?: string }).speciesCode
  if (speciesCode) selectStatisticsSpecies(speciesCode)
}

function handleChartSpeciesDoubleClick(params: { seriesType?: string; data?: unknown }): void {
  if (chartMode !== 'composition' || params.seriesType !== 'bar' || !params.data || typeof params.data !== 'object') return
  const speciesCode = (params.data as { speciesCode?: string }).speciesCode
  if (speciesCode) openSpeciesProperties(speciesCode)
}

function closeProperties(): void {
  document.querySelector('#properties-drawer')?.classList.add('hidden')
}

function resetPropertyPage(): void {
  const wrap = document.querySelector<HTMLElement>('#property-table-wrap')
  if (wrap) wrap.scrollTop = 0
  renderPropertyTable()
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
  propertyIndividuals = individuals
  propertyRenderStart = -1
  renderPropertyViewport()
  updatePropertySummary()
}

function renderPropertyViewport(): void {
  const body = document.querySelector<HTMLTableSectionElement>('#property-table-body')
  const wrap = document.querySelector<HTMLElement>('#property-table-wrap')
  if (!body || !wrap) return
  const visibleRows = Math.max(1, Math.ceil(wrap.clientHeight / PROPERTY_ROW_HEIGHT))
  const start = Math.max(0, Math.floor(wrap.scrollTop / PROPERTY_ROW_HEIGHT) - PROPERTY_OVERSCAN)
  const end = Math.min(propertyIndividuals.length, start + visibleRows + PROPERTY_OVERSCAN * 2)
  if (start === propertyRenderStart && body.childElementCount > 0) return
  propertyRenderStart = start
  const visibleIndividuals = propertyIndividuals.slice(start, end)
  const topSpacer = start > 0
    ? `<tr class="property-spacer" aria-hidden="true"><td colspan="7" style="height:${start * PROPERTY_ROW_HEIGHT}px"></td></tr>`
    : ''
  const bottomSpacer = end < propertyIndividuals.length
    ? `<tr class="property-spacer" aria-hidden="true"><td colspan="7" style="height:${(propertyIndividuals.length - end) * PROPERTY_ROW_HEIGHT}px"></td></tr>`
    : ''
  body.innerHTML = topSpacer + visibleIndividuals.map((individual) => `
    <tr data-property-id="${individual.id}" class="${individual.riskScore >= RISK_THRESHOLD ? 'at-risk' : ''}">
      <td><strong>${individual.species.name} #${individual.id}</strong><span>${individual.species.code === simulation!.playerCode ? '你的物种' : STRATEGIES[individual.species.strategy].short}</span></td>
      <td>${simulation!.stageLabel(individual.stage)}</td><td>${individual.height.toFixed(1)}m</td><td>${individual.dbh.toFixed(1)}cm</td>
      <td>${Math.round(individual.health * 100)}%</td><td>${Math.round(individual.competitionPressure * 100)}%</td><td>${Math.round(individual.riskScore * 100)}%</td>
    </tr>`).join('') + bottomSpacer
  const previousButton = document.querySelector<HTMLButtonElement>('#property-page-prev')
  const nextButton = document.querySelector<HTMLButtonElement>('#property-page-next')
  if (previousButton) previousButton.disabled = start === 0
  if (nextButton) nextButton.disabled = end >= propertyIndividuals.length
  setText(
    'property-page-status',
    propertyIndividuals.length === 0
      ? '0 条'
      : `${propertyIndividuals.length.toLocaleString()} 条 · 显示 ${start + 1}–${end}`,
  )
  body.querySelectorAll<HTMLTableRowElement>('[data-property-id]').forEach((row) => {
    row.addEventListener('click', () => {
      const id = Number(row.dataset.propertyId)
      selection = { type: 'individuals', ids: [id] }
      hydrateSelectedSamples([id])
      forestScene?.selectIndividuals([id])
      forestScene?.focusIndividual(id)
      updateSelectedPanel()
      closeProperties()
    })
  })
}

function scrollPropertyTable(direction: -1 | 1): void {
  const wrap = document.querySelector<HTMLElement>('#property-table-wrap')
  if (!wrap) return
  wrap.scrollTop = Math.max(0, wrap.scrollTop + direction * Math.max(PROPERTY_ROW_HEIGHT, wrap.clientHeight * 0.85))
  renderPropertyViewport()
}

function updatePropertySummary(): void {
  if (!simulation) return
  const woody = simulation.individuals.filter((individual) => individual.stage !== 'seed')
  const averageDbh = average(woody.map((individual) => individual.dbh))
  const basalArea = woody.reduce((sum, individual) => sum + Math.PI * (individual.dbh / 200) ** 2, 0)
  const classPercent = (predicate: (dbh: number) => boolean): number => woody.length
    ? Math.round((woody.filter((individual) => predicate(individual.dbh)).length / woody.length) * 100)
    : 0
  const summary = document.querySelector<HTMLElement>('#property-summary')
  if (!summary) return
  summary.innerHTML = statusGrid([
    ['当前密度', `${(simulation.individuals.length / 25).toFixed(1)} 个 / 400 m²`],
    ['初始密度', `${simulation.densityPer400m2} 个 / 400 m²`],
    ['平均胸径', `${averageDbh.toFixed(1)} cm`],
    ['胸高断面积', `${basalArea.toFixed(1)} m²/ha`],
    ['小径 <5 cm', `${classPercent((dbh) => dbh < 5)}%`],
    ['中径 5–15 cm', `${classPercent((dbh) => dbh >= 5 && dbh < 15)}%`],
    ['大径 ≥15 cm', `${classPercent((dbh) => dbh >= 15)}%`],
  ])
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

function openTutorial(force = false): void {
  if (!force && localStorage.getItem(TUTORIAL_STORAGE_KEY) === 'true') return
  tutorialStep = 0
  document.querySelector<HTMLElement>('#tutorial-modal')?.classList.remove('hidden')
  renderTutorialStep()
}

function advanceTutorial(): void {
  if (tutorialStep >= TUTORIAL_STEPS.length - 1) {
    closeTutorial()
    return
  }
  tutorialStep += 1
  renderTutorialStep()
}

function renderTutorialStep(): void {
  const step = TUTORIAL_STEPS[tutorialStep]
  document.querySelectorAll('.tutorial-focus').forEach((element) => element.classList.remove('tutorial-focus'))
  const target = document.querySelector<HTMLElement>(`[data-tutorial-target="${step.target}"]`)
  target?.classList.add('tutorial-focus')
  target?.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' })
  setText('tutorial-step-label', `新手教程 · ${tutorialStep + 1} / ${TUTORIAL_STEPS.length}`)
  setText('tutorial-title', step.title)
  setText('tutorial-body', step.body)
  setText('tutorial-next', tutorialStep === TUTORIAL_STEPS.length - 1 ? '开始探索' : '下一步')
  window.requestAnimationFrame(() => positionTutorial(target))
}

function positionTutorial(target: HTMLElement | null): void {
  const spotlight = document.querySelector<HTMLElement>('#tutorial-spotlight')
  const card = document.querySelector<HTMLElement>('.tutorial-card')
  if (!spotlight || !card || !target) return
  const padding = 7
  const gap = 18
  const targetRect = target.getBoundingClientRect()
  const left = Math.max(padding, targetRect.left - padding)
  const top = Math.max(padding, targetRect.top - padding)
  const right = Math.min(window.innerWidth - padding, targetRect.right + padding)
  const bottom = Math.min(window.innerHeight - padding, targetRect.bottom + padding)
  spotlight.style.left = `${left}px`
  spotlight.style.top = `${top}px`
  spotlight.style.width = `${Math.max(24, right - left)}px`
  spotlight.style.height = `${Math.max(24, bottom - top)}px`

  const cardRect = card.getBoundingClientRect()
  const cardWidth = cardRect.width
  const cardHeight = cardRect.height
  const clampX = (value: number) => Math.max(14, Math.min(window.innerWidth - cardWidth - 14, value))
  const clampY = (value: number) => Math.max(14, Math.min(window.innerHeight - cardHeight - 14, value))
  const candidates = [
    { x: targetRect.right + gap, y: targetRect.top + (targetRect.height - cardHeight) / 2 },
    { x: targetRect.left - cardWidth - gap, y: targetRect.top + (targetRect.height - cardHeight) / 2 },
    { x: targetRect.left + (targetRect.width - cardWidth) / 2, y: targetRect.bottom + gap },
    { x: targetRect.left + (targetRect.width - cardWidth) / 2, y: targetRect.top - cardHeight - gap },
    { x: 14, y: 14 },
    { x: window.innerWidth - cardWidth - 14, y: 14 },
    { x: 14, y: window.innerHeight - cardHeight - 14 },
    { x: window.innerWidth - cardWidth - 14, y: window.innerHeight - cardHeight - 14 },
  ].map((candidate) => ({ x: clampX(candidate.x), y: clampY(candidate.y) }))
  const overlap = (candidate: { x: number; y: number }) => {
    const overlapWidth = Math.max(0, Math.min(candidate.x + cardWidth, right) - Math.max(candidate.x, left))
    const overlapHeight = Math.max(0, Math.min(candidate.y + cardHeight, bottom) - Math.max(candidate.y, top))
    return overlapWidth * overlapHeight
  }
  const position = candidates.sort((first, second) => overlap(first) - overlap(second))[0]
  card.style.left = `${position.x}px`
  card.style.top = `${position.y}px`
}

function closeTutorial(): void {
  localStorage.setItem(TUTORIAL_STORAGE_KEY, 'true')
  document.querySelector<HTMLElement>('#tutorial-modal')?.classList.add('hidden')
  document.querySelectorAll('.tutorial-focus').forEach((element) => element.classList.remove('tutorial-focus'))
}

function statusGrid(entries: Array<[string, string]>): string {
  return `<div class="status-grid">${entries.map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join('')}</div>`
}

function setList(id: string, values: string[]): void {
  const element = document.querySelector<HTMLElement>(`#${id}`)
  if (element) element.innerHTML = values.map((value) => `<li>${value}</li>`).join('')
}

function speciesColor(speciesCode: string): string {
  const palette = ['#e9933e', '#627bb6', '#4e9a70', '#b85f52', '#7d6aa8', '#30898a']
  const index = simulation?.activeSpecies.findIndex((species) => species.code === speciesCode) ?? 0
  return palette[Math.max(0, index) % palette.length]
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
