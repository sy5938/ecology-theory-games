import Phaser from 'phaser'
import { STRATEGIES } from './species'
import { ForestSimulation, type Individual, type TransplantResult } from './simulation'

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

export class ForestScene extends Phaser.Scene {
  private readonly simulation: ForestSimulation
  private readonly callbacks: ForestSceneCallbacks
  private readonly circles = new Map<number, Phaser.GameObjects.Arc>()
  private readonly selectedIds = new Set<number>()
  private lightLayer!: Phaser.GameObjects.Graphics
  private gridLayer!: Phaser.GameObjects.Graphics
  private warningLayer!: Phaser.GameObjects.Graphics
  private displayedLight = new Float32Array()
  private renderedRevision = -1
  private hoveredId: number | null = null
  private dragOrigin: DragOrigin | null = null
  private lastHoverAt = 0
  private lastLightDrawAt = 0

  constructor(simulation: ForestSimulation, callbacks: ForestSceneCallbacks) {
    super('forest')
    this.simulation = simulation
    this.callbacks = callbacks
  }

  create(): void {
    this.lightLayer = this.add.graphics()
    this.gridLayer = this.add.graphics()
    this.warningLayer = this.add.graphics()
    this.displayedLight = new Float32Array(this.simulation.lightGrid)
    this.drawLight()
    this.drawGrid()
    this.syncFromSimulation()

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => this.handlePointerDown(pointer))
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => this.handlePointerMove(pointer))
    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => this.handlePointerUp(pointer))
    this.input.on('pointerupoutside', (pointer: Phaser.Input.Pointer) => this.handlePointerUp(pointer))
    this.input.on('gameout', () => {
      if (!this.dragOrigin) this.setHovered(null)
    })
  }

  update(time: number, delta: number): void {
    this.simulation.update(delta / 1000)
    if (this.renderedRevision !== this.simulation.revision) this.syncFromSimulation()
    this.updateLight(time, delta)
    this.drawWarning()
  }

  selectIndividuals(ids: number[]): void {
    this.selectedIds.clear()
    for (const id of ids) {
      if (this.simulation.findIndividual(id)) this.selectedIds.add(id)
    }
    this.refreshCircleStyles()
  }

  private handlePointerDown(pointer: Phaser.Input.Pointer): void {
    const hit = this.findIndividualAt(pointer.worldX, pointer.worldY)
    const additive = this.hasAdditiveModifier(pointer)
    if (!hit) {
      this.selectedIds.clear()
      this.refreshCircleStyles()
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
    this.refreshCircleStyles()
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
    if (this.dragOrigin && pointer.isDown) {
      const distance = Math.hypot(
        pointer.worldX - this.dragOrigin.pointerX,
        pointer.worldY - this.dragOrigin.pointerY,
      )
      if (distance >= 5) this.dragOrigin.moved = true
      if (!this.dragOrigin.moved) return
      const circle = this.circles.get(this.dragOrigin.id)
      circle?.setPosition(
        Phaser.Math.Clamp(pointer.worldX, MAP_PIXEL_WIDTH * 0.015, MAP_PIXEL_WIDTH * 0.985),
        Phaser.Math.Clamp(pointer.worldY, MAP_PIXEL_HEIGHT * 0.02, MAP_PIXEL_HEIGHT * 0.98),
      )
      circle?.setScale(1.15)
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
    if (!this.dragOrigin) return
    const origin = this.dragOrigin
    const circle = this.circles.get(origin.id)
    let result: TransplantResult | null = null
    if (origin.moved && circle) {
      result = this.simulation.transplant(origin.id, circle.x / MAP_PIXEL_WIDTH, circle.y / MAP_PIXEL_HEIGHT)
      if (!result.ok) circle.setPosition(origin.x * MAP_PIXEL_WIDTH, origin.y * MAP_PIXEL_HEIGHT)
    }
    this.simulation.paused = origin.wasPaused
    this.dragOrigin = null
    circle?.setScale(1)
    if (result) this.callbacks.onTransplant(origin.id, result)
  }

  private hasAdditiveModifier(pointer: Phaser.Input.Pointer): boolean {
    const event = pointer.event as Event & { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean }
    return Boolean(event.shiftKey || event.metaKey || event.ctrlKey)
  }

  private findIndividualAt(worldX: number, worldY: number): Individual | null {
    let best: Individual | null = null
    let bestScore = Number.POSITIVE_INFINITY
    for (const individual of this.simulation.individuals) {
      const dx = individual.x * MAP_PIXEL_WIDTH - worldX
      const dy = individual.y * MAP_PIXEL_HEIGHT - worldY
      const hitRadius = this.radiusFor(individual) + 5
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
    const previous = this.hoveredId === null ? null : this.circles.get(this.hoveredId)
    previous?.setScale(1)
    this.hoveredId = id
    if (id !== null && !this.dragOrigin) this.circles.get(id)?.setScale(1.14)
    if (id === null) this.callbacks.onHover(null)
  }

  private syncFromSimulation(): void {
    this.renderedRevision = this.simulation.revision
    const liveIds = new Set(this.simulation.individuals.map((individual) => individual.id))
    let selectionChanged = false
    for (const [id, circle] of this.circles) {
      if (liveIds.has(id)) continue
      circle.destroy()
      this.circles.delete(id)
      if (this.selectedIds.delete(id)) selectionChanged = true
      if (this.hoveredId === id) this.hoveredId = null
    }

    for (const individual of this.simulation.individuals) {
      let circle = this.circles.get(individual.id)
      if (!circle) {
        circle = this.createCircle(individual)
        this.circles.set(individual.id, circle)
      }
      if (this.dragOrigin?.id !== individual.id || !this.dragOrigin.moved) {
        circle.setPosition(individual.x * MAP_PIXEL_WIDTH, individual.y * MAP_PIXEL_HEIGHT)
      }
      const radius = this.radiusFor(individual)
      circle.setRadius(radius)
      circle.setDisplaySize(radius * 2, radius * 2)
      circle.setAlpha(this.alphaFor(individual))
    }
    this.refreshCircleStyles()
    if (selectionChanged) this.callbacks.onSelectIndividuals([...this.selectedIds])
  }

  private createCircle(individual: Individual): Phaser.GameObjects.Arc {
    const circle = this.add.circle(
      individual.x * MAP_PIXEL_WIDTH,
      individual.y * MAP_PIXEL_HEIGHT,
      this.radiusFor(individual),
      STRATEGIES[individual.species.strategy].color,
    )
    circle.setData('individualId', individual.id)
    return circle
  }

  private refreshCircleStyles(): void {
    for (const individual of this.simulation.individuals) {
      const circle = this.circles.get(individual.id)
      if (!circle) continue
      const isPlayer = individual.species.code === this.simulation.playerCode
      const isSelected = this.selectedIds.has(individual.id)
      circle.setFillStyle(STRATEGIES[individual.species.strategy].color)
      if (isSelected) circle.setStrokeStyle(4, 0xfff3c8, 1)
      else if (isPlayer) circle.setStrokeStyle(2.5, 0x132a22, 0.98)
      else circle.setStrokeStyle(1, 0xffffff, 0.5)
      circle.setDepth(isSelected ? 5 : isPlayer ? 3 : 2)
    }
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

  private drawGrid(): void {
    this.gridLayer.clear()
    this.gridLayer.lineStyle(1, 0xffffff, 0.12)
    const cellWidth = MAP_PIXEL_WIDTH / this.simulation.width
    const cellHeight = MAP_PIXEL_HEIGHT / this.simulation.height
    for (let x = 0; x <= this.simulation.width; x += 5) {
      this.gridLayer.lineBetween(x * cellWidth, 0, x * cellWidth, MAP_PIXEL_HEIGHT)
    }
    for (let y = 0; y <= this.simulation.height; y += 5) {
      this.gridLayer.lineBetween(0, y * cellHeight, MAP_PIXEL_WIDTH, y * cellHeight)
    }
    this.gridLayer.setDepth(1)
  }

  private drawWarning(): void {
    this.warningLayer.clear()
    const warning = this.simulation.warning
    if (!warning) return
    const seconds = Math.max(0, warning.happensAt - this.simulation.timeSeconds)
    const alpha = 0.09 + Math.min(0.13, (10 - seconds) * 0.012)
    if (warning.type === 'rainstorm') {
      this.warningLayer.fillStyle(0x5c79a8, alpha)
      this.warningLayer.lineStyle(3, 0xb8cced, 0.75)
      this.warningLayer.fillRect(0, 0, MAP_PIXEL_WIDTH, MAP_PIXEL_HEIGHT)
      this.warningLayer.strokeRect(2, 2, MAP_PIXEL_WIDTH - 4, MAP_PIXEL_HEIGHT - 4)
    } else {
      this.warningLayer.fillStyle(0x9d6555, alpha)
      this.warningLayer.lineStyle(2, 0xe6b39b, 0.72)
      this.warningLayer.fillCircle(
        warning.x * MAP_PIXEL_WIDTH,
        warning.y * MAP_PIXEL_HEIGHT,
        warning.radius * MAP_PIXEL_WIDTH,
      )
      this.warningLayer.strokeCircle(
        warning.x * MAP_PIXEL_WIDTH,
        warning.y * MAP_PIXEL_HEIGHT,
        warning.radius * MAP_PIXEL_WIDTH,
      )
    }
    this.warningLayer.setDepth(1.5)
  }

  private radiusFor(individual: Individual): number {
    if (individual.stage === 'seed') return 2.1
    if (individual.stage === 'seedling') return individual.species.code === this.simulation.playerCode ? 5 : 3.8
    if (individual.stage === 'sapling') return 5.2 + (individual.height / individual.species.maxHeight) * 3
    return 7 + (individual.height / individual.species.maxHeight) * 5.5
  }

  private alphaFor(individual: Individual): number {
    const own = individual.species.code === this.simulation.playerCode
    const stageAlpha = individual.stage === 'seed' ? 0.5 : individual.stage === 'seedling' ? 0.72 : 0.9
    return Math.min(1, stageAlpha + (own ? 0.08 : 0))
  }

  private lightColor(light: number): number {
    const low = [35, 72, 80]
    const middle = [91, 139, 111]
    const high = [231, 213, 128]
    const mix = (from: number[], to: number[], amount: number) =>
      from.map((value, index) => Math.round(value + (to[index] - value) * amount))
    const rgb = light < 0.5 ? mix(low, middle, light / 0.5) : mix(middle, high, (light - 0.5) / 0.5)
    return (rgb[0] << 16) | (rgb[1] << 8) | rgb[2]
  }
}
