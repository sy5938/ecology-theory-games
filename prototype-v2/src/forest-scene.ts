import Phaser from 'phaser'
import { STRATEGIES } from './species'
import {
  RISK_THRESHOLD,
  type DeathRecord,
  type ForestSimulation,
  type Individual,
  type TransplantResult,
  type ViewLayer,
} from './simulation'

export interface ForestSceneCallbacks {
  onHover: (individual: Individual | null, screenX?: number, screenY?: number) => void
  onSelectIndividuals: (ids: number[]) => void
  onSelectCell: (x: number, y: number, light: number) => void
  onTransplant: (id: number, result: TransplantResult) => void
}

export const MAP_PIXEL_WIDTH = 960
export const MAP_PIXEL_HEIGHT = 620

interface DragOrigin {
  id: number
  x: number
  y: number
  pointerX: number
  pointerY: number
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
  expiresAt: number
}

export class ForestScene extends Phaser.Scene {
  private readonly simulation: ForestSimulation
  private readonly callbacks: ForestSceneCallbacks
  private readonly shapes = new Map<number, Phaser.GameObjects.Shape>()
  private readonly ownHalos = new Map<number, Phaser.GameObjects.Arc>()
  private readonly riskBadges = new Map<number, Phaser.GameObjects.Arc>()
  private readonly selectedIds = new Set<number>()
  private readonly seenDeaths = new Set<number>()
  private readonly deathMarkers: DeathMarker[] = []
  private lightLayer!: Phaser.GameObjects.Graphics
  private gridLayer!: Phaser.GameObjects.Graphics
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
  private sceneTime = 0
  private viewLayer: ViewLayer = 'all'

  constructor(simulation: ForestSimulation, callbacks: ForestSceneCallbacks) {
    super('forest')
    this.simulation = simulation
    this.callbacks = callbacks
  }

  create(): void {
    this.cameras.main.setBounds(0, 0, MAP_PIXEL_WIDTH, MAP_PIXEL_HEIGHT)
    this.lightLayer = this.add.graphics()
    this.gridLayer = this.add.graphics()
    this.warningLayer = this.add.graphics()
    this.deathLayer = this.add.graphics()
    this.displayedLight = new Float32Array(this.simulation.lightGrid)
    this.drawLight()
    this.drawGridAndAxes()
    this.syncFromSimulation()
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
    if (this.renderedRevision !== this.simulation.revision) this.syncFromSimulation()
    this.updateLight(time, delta)
    this.drawWarning()
    this.syncDeathMarkers()
    this.drawDeathMarkers()
  }

  selectIndividuals(ids: number[]): void {
    this.selectedIds.clear()
    for (const id of ids) if (this.simulation.findIndividual(id)) this.selectedIds.add(id)
    this.refreshShapeStyles()
  }

  setViewLayer(layer: ViewLayer): void {
    this.viewLayer = layer
    this.refreshVisibility()
  }

  focusIndividual(id: number): void {
    const individual = this.simulation.findIndividual(id)
    if (!individual) return
    const camera = this.cameras.main
    camera.pan(individual.x * MAP_PIXEL_WIDTH, individual.y * MAP_PIXEL_HEIGHT, 360, 'Sine.easeInOut')
    camera.zoomTo(3, 360, 'Sine.easeInOut')
  }

  resetCamera(): void {
    const camera = this.cameras.main
    camera.stopFollow()
    camera.setZoom(1)
    camera.centerOn(MAP_PIXEL_WIDTH / 2, MAP_PIXEL_HEIGHT / 2)
  }

  private handlePointerDown(pointer: Phaser.Input.Pointer): void {
    pointer.updateWorldPoint(this.cameras.main)
    if (pointer.rightButtonDown() || this.spaceKey?.isDown) {
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
      this.refreshShapeStyles()
      const x = Phaser.Math.Clamp(pointer.worldX / MAP_PIXEL_WIDTH, 0, 0.999)
      const y = Phaser.Math.Clamp(pointer.worldY / MAP_PIXEL_HEIGHT, 0, 0.999)
      this.callbacks.onSelectCell(x, y, this.simulation.lightAt(x, y))
      return
    }
    if (additive) {
      if (this.selectedIds.has(hit.id)) this.selectedIds.delete(hit.id)
      else this.selectedIds.add(hit.id)
    } else {
      this.selectedIds.clear()
      this.selectedIds.add(hit.id)
    }
    this.refreshShapeStyles()
    this.callbacks.onSelectIndividuals([...this.selectedIds])
    if (!additive && this.simulation.canTransplant(hit)) {
      this.dragOrigin = {
        id: hit.id,
        x: hit.x,
        y: hit.y,
        pointerX: pointer.worldX,
        pointerY: pointer.worldY,
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
      if (distance >= 5 / this.cameras.main.zoom) this.dragOrigin.moved = true
      if (!this.dragOrigin.moved) return
      const shape = this.shapes.get(this.dragOrigin.id)
      shape?.setPosition(
        Phaser.Math.Clamp(pointer.worldX, MAP_PIXEL_WIDTH * 0.01, MAP_PIXEL_WIDTH * 0.99),
        Phaser.Math.Clamp(pointer.worldY, MAP_PIXEL_HEIGHT * 0.01, MAP_PIXEL_HEIGHT * 0.99),
      )
      shape?.setScale(1.15)
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
      return
    }
    if (!this.dragOrigin) return
    const origin = this.dragOrigin
    const shape = this.shapes.get(origin.id)
    let result: TransplantResult | null = null
    if (origin.moved && shape) {
      result = this.simulation.transplant(origin.id, shape.x / MAP_PIXEL_WIDTH, shape.y / MAP_PIXEL_HEIGHT)
      if (!result.ok) shape.setPosition(origin.x * MAP_PIXEL_WIDTH, origin.y * MAP_PIXEL_HEIGHT)
    }
    this.simulation.paused = origin.wasPaused
    this.dragOrigin = null
    shape?.setScale(1)
    if (result) this.callbacks.onTransplant(origin.id, result)
  }

  private handleWheel(pointer: Phaser.Input.Pointer, deltaY: number): void {
    const camera = this.cameras.main
    const before = camera.getWorldPoint(pointer.x, pointer.y)
    const zoom = Phaser.Math.Clamp(camera.zoom * (deltaY > 0 ? 0.88 : 1.14), 1, 4)
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
    let best: Individual | null = null
    let bestScore = Number.POSITIVE_INFINITY
    for (const individual of this.simulation.individuals) {
      if (!this.isVisible(individual)) continue
      const dx = individual.x * MAP_PIXEL_WIDTH - worldX
      const dy = individual.y * MAP_PIXEL_HEIGHT - worldY
      const hitRadius = this.radiusFor(individual) + 5 / this.cameras.main.zoom
      const distanceSquared = dx * dx + dy * dy
      if (distanceSquared > hitRadius * hitRadius) continue
      const score = distanceSquared / (hitRadius * hitRadius)
      if (score < bestScore) {
        best = individual
        bestScore = score
      }
    }
    return best
  }

  private setHovered(id: number | null): void {
    if (this.hoveredId === id) return
    if (this.hoveredId !== null) this.sizeShape(this.hoveredId, 1)
    this.hoveredId = id
    if (id !== null && !this.dragOrigin) this.sizeShape(id, 1.14)
    if (id === null) this.callbacks.onHover(null)
  }

  private syncFromSimulation(): void {
    this.renderedRevision = this.simulation.revision
    const liveIds = new Set(this.simulation.individuals.map((individual) => individual.id))
    let selectionChanged = false
    for (const [id, shape] of this.shapes) {
      if (liveIds.has(id)) continue
      shape.destroy()
      this.shapes.delete(id)
      this.ownHalos.get(id)?.destroy()
      this.ownHalos.delete(id)
      this.riskBadges.get(id)?.destroy()
      this.riskBadges.delete(id)
      if (this.selectedIds.delete(id)) selectionChanged = true
      if (this.hoveredId === id) this.hoveredId = null
    }
    for (const individual of this.simulation.individuals) {
      let shape = this.shapes.get(individual.id)
      if (!shape) {
        shape = this.createShape(individual)
        this.shapes.set(individual.id, shape)
      }
      if (this.dragOrigin?.id !== individual.id || !this.dragOrigin.moved) {
        shape.setPosition(individual.x * MAP_PIXEL_WIDTH, individual.y * MAP_PIXEL_HEIGHT)
      }
      this.sizeShape(individual.id, individual.id === this.hoveredId ? 1.14 : 1)
      shape.setAlpha(this.alphaFor(individual))
      this.syncOwnHalo(individual)
      this.syncRiskBadge(individual)
    }
    this.refreshShapeStyles()
    this.refreshVisibility()
    if (selectionChanged) this.callbacks.onSelectIndividuals([...this.selectedIds])
  }

  private createShape(individual: Individual): Phaser.GameObjects.Shape {
    const color = STRATEGIES[individual.species.strategy].color
    const shape = this.add.circle(individual.x * MAP_PIXEL_WIDTH, individual.y * MAP_PIXEL_HEIGHT, 1, color)
    shape.setData('individualId', individual.id)
    return shape
  }

  private sizeShape(id: number, scale: number): void {
    const individual = this.simulation.findIndividual(id)
    const shape = this.shapes.get(id)
    if (!individual || !shape) return
    const radius = this.radiusFor(individual) * scale
    shape.setDisplaySize(radius * 2, radius * 2)
  }

  private syncOwnHalo(individual: Individual): void {
    if (individual.species.code !== this.simulation.playerCode) return
    let halo = this.ownHalos.get(individual.id)
    if (!halo) {
      halo = this.add.circle(0, 0, 1, 0xffffff, 0)
      halo.setDepth(5)
      this.ownHalos.set(individual.id, halo)
    }
    const haloRadius = this.radiusFor(individual) + 3.5
    halo.setPosition(individual.x * MAP_PIXEL_WIDTH, individual.y * MAP_PIXEL_HEIGHT)
    halo.setRadius(haloRadius)
    halo.setFillStyle(0xffffff, 0)
    halo.setStrokeStyle(3, 0xffffff, 0.96)
    halo.setVisible(this.isVisible(individual))
  }

  private syncRiskBadge(individual: Individual): void {
    const radius = this.radiusFor(individual)
    let badge = this.riskBadges.get(individual.id)
    if (!badge) {
      badge = this.add.circle(0, 0, 2.7, 0xd74236)
      badge.setStrokeStyle(1, 0xfff5ed, 1)
      badge.setDepth(7)
      this.riskBadges.set(individual.id, badge)
    }
    badge.setPosition(individual.x * MAP_PIXEL_WIDTH + radius * 0.72, individual.y * MAP_PIXEL_HEIGHT - radius * 0.72)
    badge.setVisible(individual.riskScore >= RISK_THRESHOLD && this.isVisible(individual))
  }

  private refreshShapeStyles(): void {
    for (const individual of this.simulation.individuals) {
      const shape = this.shapes.get(individual.id)
      if (!shape) continue
      const isPlayer = individual.species.code === this.simulation.playerCode
      const isSelected = this.selectedIds.has(individual.id)
      shape.setFillStyle(STRATEGIES[individual.species.strategy].color)
      if (isSelected) shape.setStrokeStyle(4, 0xfff3c8, 1)
      else shape.setStrokeStyle(1, 0xffffff, isPlayer ? 0.8 : 0.5)
      shape.setDepth(isSelected ? 6 : isPlayer ? 4 : 3)
    }
  }

  private refreshVisibility(): void {
    for (const individual of this.simulation.individuals) {
      const visible = this.isVisible(individual)
      this.shapes.get(individual.id)?.setVisible(visible)
      this.ownHalos.get(individual.id)?.setVisible(visible)
      const badge = this.riskBadges.get(individual.id)
      badge?.setVisible(visible && individual.riskScore >= RISK_THRESHOLD)
    }
  }

  private isVisible(individual: Individual): boolean {
    if (this.viewLayer === 'canopy') return individual.canopy
    if (this.viewLayer === 'understory') return !individual.canopy
    return true
  }

  private syncDeathMarkers(): void {
    for (const record of this.simulation.deaths) {
      if (this.seenDeaths.has(record.individualId)) continue
      this.seenDeaths.add(record.individualId)
      this.deathMarkers.push({ record, expiresAt: this.sceneTime + 5000 })
    }
    while (this.deathMarkers.length > 0 && this.deathMarkers[0].expiresAt <= this.sceneTime) this.deathMarkers.shift()
  }

  private drawDeathMarkers(): void {
    this.deathLayer.clear()
    this.deathLayer.lineStyle(3, 0xd83f35, 0.95)
    for (const marker of this.deathMarkers) {
      const x = marker.record.x * MAP_PIXEL_WIDTH
      const y = marker.record.y * MAP_PIXEL_HEIGHT
      const size = 7
      this.deathLayer.lineBetween(x - size, y - size, x + size, y + size)
      this.deathLayer.lineBetween(x + size, y - size, x - size, y + size)
    }
    this.deathLayer.setDepth(8)
  }

  private updateLight(time: number, delta: number): void {
    const blend = 1 - Math.exp(-delta / 190)
    let maxDifference = 0
    for (let index = 0; index < this.displayedLight.length; index += 1) {
      const difference = this.simulation.lightGrid[index] - this.displayedLight[index]
      this.displayedLight[index] += difference * blend
      maxDifference = Math.max(maxDifference, Math.abs(difference))
    }
    if (maxDifference > 0.0015 && time >= this.lastLightDrawAt + 50) {
      this.lastLightDrawAt = time
      this.drawLight()
    }
  }

  private drawLight(): void {
    this.lightLayer.clear()
    const cellWidth = MAP_PIXEL_WIDTH / this.simulation.width
    const cellHeight = MAP_PIXEL_HEIGHT / this.simulation.height
    for (let y = 0; y < this.simulation.height; y += 1) {
      for (let x = 0; x < this.simulation.width; x += 1) {
        const light = this.displayedLight[y * this.simulation.width + x]
        this.lightLayer.fillStyle(this.lightColor(light), 1)
        this.lightLayer.fillRect(x * cellWidth, y * cellHeight, cellWidth + 1, cellHeight + 1)
      }
    }
  }

  private drawGridAndAxes(): void {
    this.gridLayer.clear()
    this.gridLayer.lineStyle(1, 0xffffff, 0.13)
    const cellWidth = MAP_PIXEL_WIDTH / this.simulation.width
    const cellHeight = MAP_PIXEL_HEIGHT / this.simulation.height
    for (let x = 0; x <= this.simulation.width; x += 4) this.gridLayer.lineBetween(x * cellWidth, 0, x * cellWidth, MAP_PIXEL_HEIGHT)
    for (let y = 0; y <= this.simulation.height; y += 4) this.gridLayer.lineBetween(0, y * cellHeight, MAP_PIXEL_WIDTH, y * cellHeight)
    this.gridLayer.lineStyle(2, 0x17372f, 0.45)
    this.gridLayer.strokeRect(1, 1, MAP_PIXEL_WIDTH - 2, MAP_PIXEL_HEIGHT - 2)
    this.gridLayer.setDepth(1)
    for (let meter = 0; meter <= this.simulation.mapWidthMeters; meter += 12) {
      const x = (meter / this.simulation.mapWidthMeters) * MAP_PIXEL_WIDTH
      this.add.text(Math.min(MAP_PIXEL_WIDTH - 31, x + 3), MAP_PIXEL_HEIGHT - 18, `${meter}m`, {
        fontFamily: 'Inter, sans-serif', fontSize: '10px', color: '#163a31', backgroundColor: '#f5f0d8aa', padding: { x: 2, y: 1 },
      }).setDepth(9)
    }
    for (let meter = 0; meter <= this.simulation.mapHeightMeters; meter += 8) {
      const y = (meter / this.simulation.mapHeightMeters) * MAP_PIXEL_HEIGHT
      this.add.text(4, Math.min(MAP_PIXEL_HEIGHT - 18, y + 3), `${meter}m`, {
        fontFamily: 'Inter, sans-serif', fontSize: '10px', color: '#163a31', backgroundColor: '#f5f0d8aa', padding: { x: 2, y: 1 },
      }).setDepth(9)
    }
  }

  private drawWarning(): void {
    this.warningLayer.clear()
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
      this.warningLayer.fillStyle(0x9d6555, alpha)
      this.warningLayer.lineStyle(2, 0xe6b39b, 0.72)
      this.warningLayer.fillCircle(warning.x * MAP_PIXEL_WIDTH, warning.y * MAP_PIXEL_HEIGHT, warning.radius * MAP_PIXEL_WIDTH)
      this.warningLayer.strokeCircle(warning.x * MAP_PIXEL_WIDTH, warning.y * MAP_PIXEL_HEIGHT, warning.radius * MAP_PIXEL_WIDTH)
    }
    this.warningLayer.setDepth(2)
  }

  private radiusFor(individual: Individual): number {
    if (individual.stage === 'seed') return 2.4
    return Phaser.Math.Clamp(2.5 + 2.4 * Math.log1p(individual.height), 3, 12)
  }

  private alphaFor(individual: Individual): number {
    const own = individual.species.code === this.simulation.playerCode
    const stageAlpha = individual.stage === 'seed' ? 0.5 : individual.stage === 'seedling' ? 0.72 : 0.9
    return Math.min(1, stageAlpha + (own ? 0.08 : 0))
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
}
