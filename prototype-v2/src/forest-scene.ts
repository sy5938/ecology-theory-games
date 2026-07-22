import Phaser from 'phaser'
import {
  FUNCTIONAL_TYPE_LEGEND,
  detailLayerHintState,
  fivePointStarVertices,
  type DetailLayerHintState,
  type FunctionalTypeLegendItem,
} from './map-rendering'
import { STRATEGIES } from './species'
import {
  RISK_THRESHOLD,
  type DeathRecord,
  type ForestSimulation,
  type Individual,
  type Stage,
  type TransplantResult,
  type ViewLayer,
} from './simulation'
import {
  VectorMarkerLayer,
  type MarkerLod,
  type MarkerLodMode,
  type MarkerScaleState,
  type PlayerMarkerStyle,
  type VectorMarker,
} from './vector-marker-layer'

export interface ForestSceneCallbacks {
  onHover: (individual: Individual | null, screenX?: number, screenY?: number) => void
  onSelectIndividuals: (ids: number[]) => void
  onSelectCell: (x: number, y: number, light: number) => void
  onTransplant: (id: number, result: TransplantResult) => void
  onViewportChange: (viewport: MapViewport) => void
}

export interface MapViewport {
  left: number
  right: number
  bottom: number
  top: number
}

export interface ForestStateLayerVisibility {
  player: boolean
  risk: boolean
  selection: boolean
}

export interface ForestLayerFilters {
  base: boolean
  species: readonly string[] | null
  stage: readonly Stage[] | null
  state: ForestStateLayerVisibility
}

export interface MapLodState {
  mode: MarkerLodMode
  active: MarkerLod
}

export interface MapState {
  lod: MapLodState
  extent: MapViewport
  scale: MarkerScaleState
  detailLayers: DetailLayerHintState
}

export interface SimplePlayerStyle {
  color: string
  size: 'small' | 'medium' | 'large'
}

export const MAP_PIXEL_WIDTH = 960
export const MAP_PIXEL_HEIGHT = 960

const HIT_BUCKET_SIZE = 48
const DEATH_MARKER_DURATION_MS = 1_500
const MIN_ZOOM = 1
const MAX_ZOOM = 8
const MAX_VISIBLE_DEATH_MARKERS = 300

interface DragOrigin {
  id: number
  pointerX: number
  pointerY: number
  previewX: number
  previewY: number
  wasPaused: boolean
  moved: boolean
}

interface PanOrigin {
  pointerX: number
  pointerY: number
  scrollX: number
  scrollY: number
}

interface DeathMarker {
  record: DeathRecord
  createdAt: number
  expiresAt: number
}

export class ForestScene extends Phaser.Scene {
  private readonly simulation: ForestSimulation
  private readonly callbacks: ForestSceneCallbacks
  private readonly selectedIds = new Set<number>()
  private readonly deathMarkers: DeathMarker[] = []
  private readonly hitBuckets = new Map<number, Individual[]>()
  private lightLayer!: Phaser.GameObjects.Graphics
  private lightTexture!: Phaser.GameObjects.RenderTexture
  private gridLayer!: Phaser.GameObjects.Graphics
  private markerLayer!: VectorMarkerLayer
  private selectionLayer!: Phaser.GameObjects.Graphics
  private dragLayer!: Phaser.GameObjects.Graphics
  private warningLayer!: Phaser.GameObjects.Graphics
  private deathLayer!: Phaser.GameObjects.Graphics
  private displayedLight = new Float32Array()
  private renderedRevision = -1
  private hoveredId: number | null = null
  private dragOrigin: DragOrigin | null = null
  private panOrigin: PanOrigin | null = null
  private spaceKey?: Phaser.Input.Keyboard.Key
  private lastHoverAt = 0
  private lastLightDrawAt = 0
  private lastPopulationDrawAt = 0
  private sceneTime = 0
  private lastDeathIndex = 0
  private lastViewportSignature = ''
  private lastOverlayScaleSignature = ''
  private speciesFocus: string | null = null
  private pendingPlayerStyle: Partial<PlayerMarkerStyle> | null = null
  private readonly hiddenSpecies = new Set<string>()
  private readonly hiddenStages = new Set<Stage>()
  private readonly layerVisibility = {
    light: true,
    grid: true,
    subgrid: false,
    axes: true,
    individuals: true,
    player: true,
    canopy: true,
    understory: true,
    risk: false,
    death: false,
    selected: true,
    disturbance: true,
  }

  constructor(simulation: ForestSimulation, callbacks: ForestSceneCallbacks) {
    super('forest')
    this.simulation = simulation
    this.callbacks = callbacks
  }

  create(): void {
    this.cameras.main.setBounds(0, 0, MAP_PIXEL_WIDTH, MAP_PIXEL_HEIGHT)
    this.lightLayer = this.make.graphics({}, false)
    this.lightTexture = this.add.renderTexture(0, 0, MAP_PIXEL_WIDTH, MAP_PIXEL_HEIGHT).setOrigin(0).setDepth(0)
    this.gridLayer = this.add.graphics().setDepth(1)
    this.warningLayer = this.add.graphics().setDepth(2)
    this.markerLayer = new VectorMarkerLayer(this).setDepth(3)
    if (this.pendingPlayerStyle) {
      this.markerLayer.setPlayerStyle(this.pendingPlayerStyle)
      this.pendingPlayerStyle = null
    }
    this.selectionLayer = this.add.graphics().setDepth(5)
    this.deathLayer = this.add.graphics().setDepth(8)
    this.dragLayer = this.add.graphics().setDepth(10)
    this.displayedLight = new Float32Array(this.simulation.lightGrid)
    this.drawLight()
    this.drawGridAndAxes()
    this.syncFromSimulation()
    this.syncViewport()
    this.spaceKey = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE)
    this.game.canvas.addEventListener('contextmenu', (event) => event.preventDefault())

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => this.handlePointerDown(pointer))
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => this.handlePointerMove(pointer))
    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => this.handlePointerUp(pointer))
    this.input.on('pointerupoutside', (pointer: Phaser.Input.Pointer) => this.handlePointerUp(pointer))
    this.input.on(
      'wheel',
      (pointer: Phaser.Input.Pointer, _objects: Phaser.GameObjects.GameObject[], _deltaX: number, deltaY: number) =>
        this.handleWheel(pointer, deltaY),
    )
    this.input.on('gameout', () => {
      if (!this.dragOrigin) this.setHovered(null)
    })
  }

  update(time: number, delta: number): void {
    this.sceneTime = time
    this.simulation.update(delta / 1000)
    const populationDrawInterval = this.simulation.individuals.length >= 5_000
      ? 500
      : this.simulation.individuals.length >= 2_000
        ? 100
        : 0
    if (
      this.renderedRevision !== this.simulation.revision &&
      time >= this.lastPopulationDrawAt + populationDrawInterval
    ) {
      this.lastPopulationDrawAt = time
      this.syncFromSimulation()
    }
    this.updateLight(time, delta)
    this.drawWarning()
    this.syncDeathMarkers()
    this.drawDeathMarkers()
    this.syncViewport()
  }

  selectIndividuals(ids: number[]): void {
    this.selectedIds.clear()
    for (const id of ids) if (this.simulation.findIndividual(id)) this.selectedIds.add(id)
    this.drawSelectionOverlays()
  }

  setViewLayer(layer: ViewLayer): void {
    this.layerVisibility.canopy = layer !== 'understory'
    this.layerVisibility.understory = layer !== 'canopy'
    this.refreshVisibility()
  }

  setSpeciesFocus(code: string | null): void {
    this.speciesFocus = code
    this.refreshVisibility()
  }

  setLayerFilters(filters: {
    base?: boolean
    species?: readonly string[] | null
    stage?: readonly Stage[] | null
    state?: Partial<ForestStateLayerVisibility>
  }): void {
    if (filters.base !== undefined) this.layerVisibility.individuals = filters.base
    if (filters.species !== undefined) {
      this.hiddenSpecies.clear()
      if (filters.species !== null) {
        const visible = new Set(filters.species)
        for (const species of this.simulation.activeSpecies) if (!visible.has(species.code)) this.hiddenSpecies.add(species.code)
      }
    }
    if (filters.stage !== undefined) {
      this.hiddenStages.clear()
      if (filters.stage !== null) {
        const visible = new Set(filters.stage)
        for (const stage of ['seed', 'seedling', 'sapling', 'adult'] as Stage[]) if (!visible.has(stage)) this.hiddenStages.add(stage)
      }
    }
    if (filters.state?.player !== undefined) this.layerVisibility.player = filters.state.player
    if (filters.state?.risk !== undefined) this.layerVisibility.risk = filters.state.risk
    if (filters.state?.selection !== undefined) this.layerVisibility.selected = filters.state.selection
    this.refreshVisibility()
  }

  getLayerFilters(): ForestLayerFilters {
    const visibleSpecies = this.simulation.activeSpecies
      .map((species) => species.code)
      .filter((code) => !this.hiddenSpecies.has(code))
    const visibleStages = (['seed', 'seedling', 'sapling', 'adult'] as Stage[])
      .filter((stage) => !this.hiddenStages.has(stage))
    return {
      base: this.layerVisibility.individuals,
      species: visibleSpecies.length === this.simulation.activeSpecies.length ? null : visibleSpecies,
      stage: visibleStages.length === 4 ? null : visibleStages,
      state: {
        player: this.layerVisibility.player,
        risk: this.layerVisibility.risk,
        selection: this.layerVisibility.selected,
      },
    }
  }

  setLayerVisibility(key: string, visible: boolean): void {
    if (key.startsWith('species:')) {
      this.toggleHidden(this.hiddenSpecies, key.slice('species:'.length), visible)
    } else if (key.startsWith('stage:')) {
      this.toggleHidden(this.hiddenStages, key.slice('stage:'.length) as Stage, visible)
    } else if (key === 'base' || key === 'individuals') {
      this.layerVisibility.individuals = visible
    } else if (key === 'light') {
      this.layerVisibility.light = visible
      this.lightTexture.setVisible(visible)
    } else if (key === 'grid' || key === 'subgrid' || key === 'axes') {
      this.layerVisibility[key] = visible
      this.drawGridAndAxes()
    } else if (key === 'player' || key === 'risk' || key === 'death' || key === 'selected' || key === 'disturbance') {
      this.layerVisibility[key] = visible
    } else if (key === 'canopy' || key === 'understory') {
      this.layerVisibility[key] = visible
    }
    this.refreshVisibility()
  }

  showAllLayers(): void {
    this.hiddenSpecies.clear()
    this.hiddenStages.clear()
    this.speciesFocus = null
    for (const key of Object.keys(this.layerVisibility) as Array<keyof typeof this.layerVisibility>) {
      this.layerVisibility[key] = true
    }
    this.lightTexture.setVisible(true)
    this.drawGridAndAxes()
    this.refreshVisibility()
  }

  setPlayerMarkerStyle(style: Partial<PlayerMarkerStyle>): void {
    if (!this.markerLayer) {
      this.pendingPlayerStyle = { ...this.pendingPlayerStyle, ...style }
      return
    }
    this.markerLayer.setPlayerStyle(style)
    this.refreshMarkerData()
    this.drawSelectionOverlays()
  }

  getPlayerMarkerStyle(): PlayerMarkerStyle {
    return this.markerLayer.getPlayerStyle()
  }

  setPlayerStyle(style: SimplePlayerStyle): void {
    const sizeScale = style.size === 'small' ? 0.82 : style.size === 'large' ? 1.25 : 1
    this.setPlayerMarkerStyle({ fillColor: parseCssColor(style.color), sizeScale })
  }

  setLodMode(mode: MarkerLodMode): void {
    this.markerLayer.setLodMode(mode)
    this.drawSelectionOverlays()
    this.drawDragPreview()
    this.syncViewport(true)
  }

  getLodState(): MapLodState {
    return { mode: this.markerLayer.getLodMode(), active: this.markerLayer.resolveLod(this.cameras.main.zoom) }
  }

  getExtentState(): MapViewport {
    return this.currentViewport()
  }

  getScaleState(): MarkerScaleState {
    return this.markerLayer.getScaleState(this.cameras.main)
  }

  getMapState(): MapState {
    const extent = this.getExtentState()
    return {
      lod: this.getLodState(),
      extent,
      scale: this.getScaleState(),
      detailLayers: detailLayerHintState(extent, this.layerVisibility.risk, this.layerVisibility.death),
    }
  }

  getFunctionalTypeLegend(): readonly FunctionalTypeLegendItem[] {
    return FUNCTIONAL_TYPE_LEGEND
  }

  focusIndividual(id: number): void {
    const individual = this.simulation.findIndividual(id)
    if (!individual) return
    const camera = this.cameras.main
    camera.pan(this.toCanvasX(individual.x), this.toCanvasY(individual.y), 360, 'Sine.easeInOut')
    camera.zoomTo(3, 360, 'Sine.easeInOut')
  }

  resetCamera(): void {
    this.zoomToFullExtent()
  }

  zoomToFullExtent(): void {
    const camera = this.cameras.main
    camera.stopFollow()
    camera.setZoom(MIN_ZOOM)
    camera.centerOn(MAP_PIXEL_WIDTH / 2, MAP_PIXEL_HEIGHT / 2)
  }

  zoomBy(factor: number): void {
    if (!Number.isFinite(factor) || factor <= 0) return
    const camera = this.cameras.main
    camera.setZoom(Phaser.Math.Clamp(camera.zoom * factor, MIN_ZOOM, MAX_ZOOM))
  }

  zoomIn(): void {
    this.zoomBy(1.35)
  }

  zoomOut(): void {
    this.zoomBy(1 / 1.35)
  }

  zoomToSpecies(code: string): boolean {
    const population = this.simulation.individuals.filter((individual) => individual.species.code === code)
    if (population.length === 0) return false
    let minX = MAP_PIXEL_WIDTH
    let maxX = 0
    let minY = MAP_PIXEL_HEIGHT
    let maxY = 0
    for (const individual of population) {
      minX = Math.min(minX, this.toCanvasX(individual.x))
      maxX = Math.max(maxX, this.toCanvasX(individual.x))
      minY = Math.min(minY, this.toCanvasY(individual.y))
      maxY = Math.max(maxY, this.toCanvasY(individual.y))
    }
    const padding = 80
    const targetZoom = Phaser.Math.Clamp(
      Math.min(
        MAP_PIXEL_WIDTH / Math.max(120, maxX - minX + padding * 2),
        MAP_PIXEL_HEIGHT / Math.max(120, maxY - minY + padding * 2),
      ),
      MIN_ZOOM,
      MAX_ZOOM,
    )
    const camera = this.cameras.main
    camera.setZoom(targetZoom)
    camera.centerOn((minX + maxX) / 2, (minY + maxY) / 2)
    return true
  }

  private handlePointerDown(pointer: Phaser.Input.Pointer): void {
    pointer.updateWorldPoint(this.cameras.main)
    if (pointer.rightButtonDown() || this.spaceKey?.isDown) {
      this.game.canvas.classList.add('is-panning')
      this.panOrigin = {
        pointerX: pointer.x,
        pointerY: pointer.y,
        scrollX: this.cameras.main.scrollX,
        scrollY: this.cameras.main.scrollY,
      }
      return
    }
    const hit = this.findIndividualAt(pointer.worldX, pointer.worldY)
    const additive = this.hasAdditiveModifier(pointer)
    if (!hit) {
      this.selectedIds.clear()
      this.drawSelectionOverlays()
      const point = this.toSimulationPoint(pointer.worldX, pointer.worldY)
      this.callbacks.onSelectCell(point.x, point.y, this.simulation.lightAt(point.x, point.y))
      return
    }
    if (additive) {
      if (this.selectedIds.has(hit.id)) this.selectedIds.delete(hit.id)
      else this.selectedIds.add(hit.id)
    } else {
      this.selectedIds.clear()
      this.selectedIds.add(hit.id)
    }
    this.drawSelectionOverlays()
    this.callbacks.onSelectIndividuals([...this.selectedIds])
    if (!additive && this.simulation.canTransplant(hit)) {
      this.dragOrigin = {
        id: hit.id,
        pointerX: pointer.worldX,
        pointerY: pointer.worldY,
        previewX: this.toCanvasX(hit.x),
        previewY: this.toCanvasY(hit.y),
        wasPaused: this.simulation.paused,
        moved: false,
      }
      this.simulation.paused = true
    }
  }

  private handlePointerMove(pointer: Phaser.Input.Pointer): void {
    pointer.updateWorldPoint(this.cameras.main)
    if (this.panOrigin && pointer.isDown) {
      const camera = this.cameras.main
      camera.scrollX = this.panOrigin.scrollX - (pointer.x - this.panOrigin.pointerX) / camera.zoom
      camera.scrollY = this.panOrigin.scrollY - (pointer.y - this.panOrigin.pointerY) / camera.zoom
      return
    }
    if (this.dragOrigin && pointer.isDown) {
      const distance = Math.hypot(pointer.worldX - this.dragOrigin.pointerX, pointer.worldY - this.dragOrigin.pointerY)
      if (distance >= 5 / this.cameras.main.zoom && !this.dragOrigin.moved) {
        this.dragOrigin.moved = true
        this.refreshMarkerData()
        this.drawSelectionOverlays()
      }
      if (!this.dragOrigin.moved) return
      this.dragOrigin.previewX = Phaser.Math.Clamp(pointer.worldX, MAP_PIXEL_WIDTH * 0.01, MAP_PIXEL_WIDTH * 0.99)
      this.dragOrigin.previewY = Phaser.Math.Clamp(pointer.worldY, MAP_PIXEL_HEIGHT * 0.01, MAP_PIXEL_HEIGHT * 0.99)
      this.drawDragPreview()
      return
    }
    if (pointer.time < this.lastHoverAt + 45) return
    this.lastHoverAt = pointer.time
    const hit = this.findIndividualAt(pointer.worldX, pointer.worldY)
    this.setHovered(hit?.id ?? null)
    const event = pointer.event as Event & { clientX?: number; clientY?: number }
    this.callbacks.onHover(hit ?? null, event.clientX ?? pointer.x, event.clientY ?? pointer.y)
  }

  private handlePointerUp(_pointer: Phaser.Input.Pointer): void {
    if (this.panOrigin) {
      this.panOrigin = null
      this.game.canvas.classList.remove('is-panning')
      return
    }
    if (!this.dragOrigin) return
    const origin = this.dragOrigin
    let result: TransplantResult | null = null
    if (origin.moved) {
      const point = this.toSimulationPoint(origin.previewX, origin.previewY)
      result = this.simulation.transplant(origin.id, point.x, point.y)
    }
    this.simulation.paused = origin.wasPaused
    this.dragOrigin = null
    this.dragLayer.clear()
    this.syncFromSimulation()
    if (result) this.callbacks.onTransplant(origin.id, result)
  }

  private handleWheel(pointer: Phaser.Input.Pointer, deltaY: number): void {
    const camera = this.cameras.main
    const before = camera.getWorldPoint(pointer.x, pointer.y)
    const zoom = Phaser.Math.Clamp(camera.zoom * (deltaY > 0 ? 0.88 : 1.14), MIN_ZOOM, MAX_ZOOM)
    camera.setZoom(zoom)
    const after = camera.getWorldPoint(pointer.x, pointer.y)
    camera.scrollX += before.x - after.x
    camera.scrollY += before.y - after.y
  }

  private hasAdditiveModifier(pointer: Phaser.Input.Pointer): boolean {
    const event = pointer.event as Event & { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean }
    return Boolean(event.shiftKey || event.metaKey || event.ctrlKey)
  }

  private findIndividualAt(worldX: number, worldY: number): Individual | null {
    const bucketX = Math.floor(worldX / HIT_BUCKET_SIZE)
    const bucketY = Math.floor(worldY / HIT_BUCKET_SIZE)
    const camera = this.cameras.main
    const hitPadding = this.markerLayer.cssPixelsToWorld(5, camera)
    const bucketRange = Math.max(1, Math.ceil((this.markerLayer.maximumWorldRadius(camera) + hitPadding) / HIT_BUCKET_SIZE))
    let best: Individual | null = null
    let bestScore = Number.POSITIVE_INFINITY
    for (let offsetY = -bucketRange; offsetY <= bucketRange; offsetY += 1) {
      for (let offsetX = -bucketRange; offsetX <= bucketRange; offsetX += 1) {
        const bucket = this.hitBuckets.get(this.bucketKey(bucketX + offsetX, bucketY + offsetY))
        if (!bucket) continue
        for (const individual of bucket) {
          if (!this.isInteractivelyVisible(individual)) continue
          const dx = this.toCanvasX(individual.x) - worldX
          const dy = this.toCanvasY(individual.y) - worldY
          const isPlayer = individual.species.code === this.simulation.playerCode && this.layerVisibility.player
          const hitRadius = this.markerLayer.worldRadius(individual.height, camera, isPlayer) + hitPadding
          const distanceSquared = dx * dx + dy * dy
          if (distanceSquared > hitRadius * hitRadius) continue
          const score = distanceSquared / (hitRadius * hitRadius)
          if (score < bestScore) {
            best = individual
            bestScore = score
          }
        }
      }
    }
    return best
  }

  private setHovered(id: number | null): void {
    if (this.hoveredId === id) return
    this.hoveredId = id
    this.drawSelectionOverlays()
    if (id === null) this.callbacks.onHover(null)
  }

  private syncFromSimulation(): void {
    this.renderedRevision = this.simulation.revision
    const liveIds = new Set(this.simulation.individuals.map((individual) => individual.id))
    let selectionChanged = false
    for (const id of this.selectedIds) {
      if (liveIds.has(id)) continue
      this.selectedIds.delete(id)
      selectionChanged = true
    }
    if (this.hoveredId !== null && !liveIds.has(this.hoveredId)) this.hoveredId = null
    this.rebuildHitBuckets()
    this.refreshMarkerData()
    this.drawSelectionOverlays()
    if (selectionChanged) this.callbacks.onSelectIndividuals([...this.selectedIds])
  }

  private rebuildHitBuckets(): void {
    this.hitBuckets.clear()
    for (const individual of this.simulation.individuals) {
      const key = this.bucketKey(
        Math.floor(this.toCanvasX(individual.x) / HIT_BUCKET_SIZE),
        Math.floor(this.toCanvasY(individual.y) / HIT_BUCKET_SIZE),
      )
      const bucket = this.hitBuckets.get(key)
      if (bucket) bucket.push(individual)
      else this.hitBuckets.set(key, [individual])
    }
  }

  private bucketKey(x: number, y: number): number {
    return y * 100 + x
  }

  private refreshMarkerData(): void {
    const markers: VectorMarker[] = []
    for (const individual of this.simulation.individuals) {
      if (!this.isVisible(individual) || (this.dragOrigin?.moved && this.dragOrigin.id === individual.id)) continue
      markers.push({
        id: individual.id,
        x: this.toCanvasX(individual.x),
        y: this.toCanvasY(individual.y),
        height: individual.height,
        color: STRATEGIES[individual.species.strategy].color,
        alpha: this.alphaFor(individual),
        player: individual.species.code === this.simulation.playerCode,
        risk: individual.riskScore >= RISK_THRESHOLD,
      })
    }
    this.markerLayer
      .setMarkers(markers)
      .setDisplayOptions({
        base: this.layerVisibility.individuals,
        playerState: this.layerVisibility.player,
        riskState: this.layerVisibility.risk,
      })
  }

  private drawSelectionOverlays(): void {
    if (!this.selectionLayer) return
    this.selectionLayer.clear()
    if (!this.layerVisibility.selected) return
    const camera = this.cameras.main
    const playerStyle = this.markerLayer.getPlayerStyle()
    const hovered = this.hoveredId === null ? null : this.simulation.findIndividual(this.hoveredId)
    if (hovered && this.isVisible(hovered) && !(this.dragOrigin?.moved && this.dragOrigin.id === hovered.id)) {
      const isPlayer = hovered.species.code === this.simulation.playerCode && this.layerVisibility.player
      const radius = this.markerLayer.worldRadius(hovered.height, camera, isPlayer) * 1.14
      this.selectionLayer.fillStyle(
        isPlayer ? playerStyle.fillColor : STRATEGIES[hovered.species.strategy].color,
        isPlayer ? playerStyle.fillAlpha * this.alphaFor(hovered) : this.alphaFor(hovered),
      )
      if (isPlayer) {
        this.selectionLayer.fillPoints(
          fivePointStarVertices(this.toCanvasX(hovered.x), this.toCanvasY(hovered.y), radius),
          true,
        )
      } else {
        this.selectionLayer.fillCircle(this.toCanvasX(hovered.x), this.toCanvasY(hovered.y), radius)
      }
    }
    for (const id of this.selectedIds) {
      const individual = this.simulation.findIndividual(id)
      if (!individual || !this.isVisible(individual) || (this.dragOrigin?.moved && this.dragOrigin.id === id)) continue
      const isPlayer = individual.species.code === this.simulation.playerCode && this.layerVisibility.player
      const radius = this.markerLayer.worldRadius(individual.height, camera, isPlayer)
      this.selectionLayer.lineStyle(this.markerLayer.cssPixelsToWorld(3, camera), 0xffcf4d, 1)
      this.selectionLayer.strokeCircle(
        this.toCanvasX(individual.x),
        this.toCanvasY(individual.y),
        radius + this.markerLayer.cssPixelsToWorld(1.5, camera),
      )
    }
  }

  private drawDragPreview(): void {
    this.dragLayer.clear()
    if (!this.dragOrigin?.moved) return
    const individual = this.simulation.findIndividual(this.dragOrigin.id)
    if (!individual) return
    const camera = this.cameras.main
    const isPlayer = individual.species.code === this.simulation.playerCode && this.layerVisibility.player
    const radius = this.markerLayer.worldRadius(individual.height, camera, isPlayer) * 1.15
    const style = this.markerLayer.getPlayerStyle()
    this.dragLayer.fillStyle(isPlayer ? style.fillColor : STRATEGIES[individual.species.strategy].color, this.alphaFor(individual))
    if (isPlayer) {
      this.dragLayer.fillPoints(fivePointStarVertices(this.dragOrigin.previewX, this.dragOrigin.previewY, radius), true)
    } else {
      this.dragLayer.fillCircle(this.dragOrigin.previewX, this.dragOrigin.previewY, radius)
    }
    this.dragLayer.lineStyle(this.markerLayer.cssPixelsToWorld(3, camera), 0xffcf4d, 1)
    this.dragLayer.strokeCircle(
      this.dragOrigin.previewX,
      this.dragOrigin.previewY,
      radius + this.markerLayer.cssPixelsToWorld(1.5, camera),
    )
  }

  private refreshVisibility(): void {
    this.refreshMarkerData()
    this.drawSelectionOverlays()
    this.drawDragPreview()
    this.deathLayer.setVisible(this.layerVisibility.death)
    this.warningLayer.setVisible(this.layerVisibility.disturbance)
  }

  private isVisible(individual: Individual): boolean {
    if (this.speciesFocus !== null && individual.species.code !== this.speciesFocus) return false
    if (this.hiddenSpecies.has(individual.species.code) || this.hiddenStages.has(individual.stage)) return false
    if (individual.canopy && !this.layerVisibility.canopy) return false
    if (!individual.canopy && !this.layerVisibility.understory) return false
    return true
  }

  private isInteractivelyVisible(individual: Individual): boolean {
    if (!this.isVisible(individual)) return false
    if (this.layerVisibility.individuals) return true
    if (this.layerVisibility.player && individual.species.code === this.simulation.playerCode) return true
    if (this.layerVisibility.risk && individual.riskScore >= RISK_THRESHOLD) return true
    return this.layerVisibility.selected && this.selectedIds.has(individual.id)
  }

  private syncDeathMarkers(): void {
    const firstNewIndex = this.lastDeathIndex
    this.lastDeathIndex = this.simulation.deaths.length
    const visibleNewRecords = this.simulation.deaths.slice(
      Math.max(firstNewIndex, this.lastDeathIndex - MAX_VISIBLE_DEATH_MARKERS),
      this.lastDeathIndex,
    )
    for (const record of visibleNewRecords) {
      this.deathMarkers.push({
        record,
        createdAt: this.sceneTime,
        expiresAt: this.sceneTime + DEATH_MARKER_DURATION_MS,
      })
    }
    if (this.deathMarkers.length > MAX_VISIBLE_DEATH_MARKERS) {
      this.deathMarkers.splice(0, this.deathMarkers.length - MAX_VISIBLE_DEATH_MARKERS)
    }
    const firstLiveMarker = this.deathMarkers.findIndex((marker) => marker.expiresAt > this.sceneTime)
    if (firstLiveMarker < 0) this.deathMarkers.length = 0
    else if (firstLiveMarker > 0) this.deathMarkers.splice(0, firstLiveMarker)
  }

  private drawDeathMarkers(): void {
    this.deathLayer.clear()
    if (!this.layerVisibility.death) return
    const camera = this.cameras.main
    const size = this.markerLayer.cssPixelsToWorld(7, camera)
    const lineWidth = this.markerLayer.cssPixelsToWorld(3, camera)
    for (const marker of this.deathMarkers) {
      const x = this.toCanvasX(marker.record.x)
      const y = this.toCanvasY(marker.record.y)
      const lifetime = marker.expiresAt - marker.createdAt
      const alpha = Phaser.Math.Clamp((marker.expiresAt - this.sceneTime) / lifetime, 0, 1)
      this.deathLayer.lineStyle(lineWidth, 0xd83f35, 0.95 * alpha)
      this.deathLayer.lineBetween(x - size, y - size, x + size, y + size)
      this.deathLayer.lineBetween(x + size, y - size, x - size, y + size)
    }
  }

  private updateLight(time: number, delta: number): void {
    const blend = 1 - Math.exp(-delta / 190)
    const drawInterval = this.simulation.individuals.length >= 5_000 ? 1_000 : 50
    let maxDifference = 0
    for (let index = 0; index < this.displayedLight.length; index += 1) {
      const difference = this.simulation.lightGrid[index] - this.displayedLight[index]
      this.displayedLight[index] += difference * blend
      maxDifference = Math.max(maxDifference, Math.abs(difference))
    }
    if (maxDifference > 0.0015 && time >= this.lastLightDrawAt + drawInterval) {
      this.lastLightDrawAt = time
      this.drawLight()
    }
  }

  private drawLight(): void {
    this.lightLayer.clear()
    const cellWidth = MAP_PIXEL_WIDTH / this.simulation.width
    const cellHeight = MAP_PIXEL_HEIGHT / this.simulation.height
    for (let y = 0; y < this.simulation.height; y += 1) {
      const canvasY = MAP_PIXEL_HEIGHT - (y + 1) * cellHeight
      for (let x = 0; x < this.simulation.width; x += 1) {
        const light = this.displayedLight[y * this.simulation.width + x]
        this.lightLayer.fillStyle(this.lightColor(light), 1)
        this.lightLayer.fillRect(x * cellWidth, canvasY, cellWidth + 1, cellHeight + 1)
      }
    }
    this.bakeLayer(this.lightTexture, this.lightLayer)
  }

  private drawGridAndAxes(): void {
    this.gridLayer.clear()
    const cellWidth = MAP_PIXEL_WIDTH / this.simulation.width
    const cellHeight = MAP_PIXEL_HEIGHT / this.simulation.height
    const xStep = Math.max(1, Math.round(this.simulation.width / 10))
    const yStep = Math.max(1, Math.round(this.simulation.height / 10))
    if (this.layerVisibility.subgrid) {
      this.gridLayer.lineStyle(0.5, 0xffffff, 0.055)
      for (let x = 0; x <= this.simulation.width; x += 1) {
        this.gridLayer.lineBetween(x * cellWidth, 0, x * cellWidth, MAP_PIXEL_HEIGHT)
      }
      for (let y = 0; y <= this.simulation.height; y += 1) {
        this.gridLayer.lineBetween(0, y * cellHeight, MAP_PIXEL_WIDTH, y * cellHeight)
      }
    }
    if (this.layerVisibility.grid) {
      this.gridLayer.lineStyle(1, 0xffffff, 0.13)
      for (let x = 0; x <= this.simulation.width; x += xStep) {
        this.gridLayer.lineBetween(x * cellWidth, 0, x * cellWidth, MAP_PIXEL_HEIGHT)
      }
      for (let y = 0; y <= this.simulation.height; y += yStep) {
        this.gridLayer.lineBetween(0, y * cellHeight, MAP_PIXEL_WIDTH, y * cellHeight)
      }
    }
    if (this.layerVisibility.axes) {
      this.gridLayer.lineStyle(2, 0x17372f, 0.45)
      this.gridLayer.strokeRect(1, 1, MAP_PIXEL_WIDTH - 2, MAP_PIXEL_HEIGHT - 2)
    }
  }

  private drawWarning(): void {
    this.warningLayer.clear()
    if (!this.layerVisibility.disturbance) return
    const warning = this.simulation.warning
    if (!warning) return
    const remaining = Math.max(0, warning.happensAt - this.simulation.forestYear)
    const alpha = 0.1 + Math.min(0.14, (1.5 - remaining) * 0.08)
    if (warning.type === 'rainstorm') {
      this.warningLayer.fillStyle(0x5c79a8, alpha)
      this.warningLayer.lineStyle(3, 0xb8cced, 0.75)
      this.warningLayer.fillRect(0, 0, MAP_PIXEL_WIDTH, MAP_PIXEL_HEIGHT)
      this.warningLayer.strokeRect(2, 2, MAP_PIXEL_WIDTH - 4, MAP_PIXEL_HEIGHT - 4)
    } else {
      const x = this.toCanvasX(warning.x)
      const y = this.toCanvasY(warning.y)
      this.warningLayer.fillStyle(0x9d6555, alpha)
      this.warningLayer.lineStyle(2, 0xe6b39b, 0.72)
      this.warningLayer.fillCircle(x, y, warning.radius * MAP_PIXEL_WIDTH)
      this.warningLayer.strokeCircle(x, y, warning.radius * MAP_PIXEL_WIDTH)
    }
  }

  private alphaFor(individual: Individual): number {
    const own = individual.species.code === this.simulation.playerCode
    const stageAlpha = individual.stage === 'seed' ? 0.5 : individual.stage === 'seedling' ? 0.72 : 0.9
    return Math.min(1, stageAlpha + (own ? 0.08 : 0))
  }

  private toCanvasX(x: number): number {
    return x * MAP_PIXEL_WIDTH
  }

  private toCanvasY(y: number): number {
    return (1 - y) * MAP_PIXEL_HEIGHT
  }

  private toSimulationPoint(canvasX: number, canvasY: number): Phaser.Math.Vector2 {
    return new Phaser.Math.Vector2(
      Phaser.Math.Clamp(canvasX / MAP_PIXEL_WIDTH, 0, 0.999),
      Phaser.Math.Clamp(1 - canvasY / MAP_PIXEL_HEIGHT, 0, 0.999),
    )
  }

  private lightColor(light: number): number {
    const low = [31, 64, 72]
    const middle = [83, 132, 104]
    const high = [231, 213, 128]
    const mix = (from: number[], to: number[], amount: number) =>
      from.map((value, index) => Math.round(value + (to[index] - value) * amount))
    const rgb = light < 0.5 ? mix(low, middle, light / 0.5) : mix(middle, high, (light - 0.5) / 0.5)
    return (rgb[0] << 16) | (rgb[1] << 8) | rgb[2]
  }

  private bakeLayer(texture: Phaser.GameObjects.RenderTexture, source: Phaser.GameObjects.Graphics): void {
    texture.clear()
    texture.draw(source)
    source.clear()
  }

  private currentViewport(): MapViewport {
    const view = this.cameras.main.worldView
    return {
      left: Phaser.Math.Clamp((view.x / MAP_PIXEL_WIDTH) * 100, 0, 100),
      right: Phaser.Math.Clamp(((view.x + view.width) / MAP_PIXEL_WIDTH) * 100, 0, 100),
      bottom: Phaser.Math.Clamp((1 - (view.y + view.height) / MAP_PIXEL_HEIGHT) * 100, 0, 100),
      top: Phaser.Math.Clamp((1 - view.y / MAP_PIXEL_HEIGHT) * 100, 0, 100),
    }
  }

  private syncViewport(force = false): void {
    const viewport = this.currentViewport()
    const signature = [viewport.left, viewport.right, viewport.bottom, viewport.top]
      .map((value) => value.toFixed(3))
      .join(':')
    const scaleSignature = [
      this.cameras.main.zoom.toFixed(4),
      this.game.canvas.clientWidth,
      this.game.canvas.clientHeight,
      this.markerLayer.getLodMode(),
    ].join(':')
    if (force || scaleSignature !== this.lastOverlayScaleSignature) {
      this.lastOverlayScaleSignature = scaleSignature
      this.drawSelectionOverlays()
      this.drawDragPreview()
    }
    if (!force && signature === this.lastViewportSignature) return
    this.lastViewportSignature = signature
    this.callbacks.onViewportChange(viewport)
  }

  private toggleHidden<T>(hidden: Set<T>, value: T, visible: boolean): void {
    if (visible) hidden.delete(value)
    else hidden.add(value)
  }
}

function parseCssColor(value: string): number {
  const normalized = value.trim()
  if (/^#[0-9a-f]{6}$/i.test(normalized)) return Number.parseInt(normalized.slice(1), 16)
  if (/^#[0-9a-f]{3}$/i.test(normalized)) {
    const [red, green, blue] = normalized.slice(1).split('')
    return Number.parseInt(`${red}${red}${green}${green}${blue}${blue}`, 16)
  }
  return 0xffffff
}
