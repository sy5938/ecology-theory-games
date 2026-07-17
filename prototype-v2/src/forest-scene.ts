import Phaser from 'phaser'
import { STRATEGIES } from './species'
import { ForestSimulation, type Individual, type TransplantResult } from './simulation'

export interface ForestSceneCallbacks {
  onHover: (individual: Individual | null, screenX?: number, screenY?: number) => void
  onSelectIndividual: (id: number) => void
  onSelectCell: (x: number, y: number, light: number) => void
  onTransplant: (id: number, result: TransplantResult) => void
}

export const MAP_PIXEL_WIDTH = 960
export const MAP_PIXEL_HEIGHT = 620

export class ForestScene extends Phaser.Scene {
  private readonly simulation: ForestSimulation
  private readonly callbacks: ForestSceneCallbacks
  private readonly circles = new Map<number, Phaser.GameObjects.Arc>()
  private lightLayer!: Phaser.GameObjects.Graphics
  private gridLayer!: Phaser.GameObjects.Graphics
  private warningLayer!: Phaser.GameObjects.Graphics
  private selectedId: number | null = null
  private renderedRevision = -1
  private dragOrigin: { id: number; x: number; y: number; wasPaused: boolean } | null = null

  constructor(simulation: ForestSimulation, callbacks: ForestSceneCallbacks) {
    super('forest')
    this.simulation = simulation
    this.callbacks = callbacks
  }

  create(): void {
    this.lightLayer = this.add.graphics()
    this.gridLayer = this.add.graphics()
    this.warningLayer = this.add.graphics()
    this.drawGrid()
    this.syncFromSimulation()

    this.input.on(
      'pointerdown',
      (pointer: Phaser.Input.Pointer, currentlyOver: Phaser.GameObjects.GameObject[]) => {
        if (currentlyOver.length > 0) return
        const x = Phaser.Math.Clamp(pointer.worldX / MAP_PIXEL_WIDTH, 0, 0.999)
        const y = Phaser.Math.Clamp(pointer.worldY / MAP_PIXEL_HEIGHT, 0, 0.999)
        this.selectedId = null
        this.refreshCircleStyles()
        this.callbacks.onSelectCell(x, y, this.simulation.lightAt(x, y))
      },
    )
  }

  update(_time: number, delta: number): void {
    this.simulation.update(delta / 1000)
    if (this.renderedRevision !== this.simulation.revision) this.syncFromSimulation()
    this.drawWarning()
  }

  selectIndividual(id: number): void {
    this.selectedId = id
    this.refreshCircleStyles()
  }

  private syncFromSimulation(): void {
    this.renderedRevision = this.simulation.revision
    this.drawLight()

    const liveIds = new Set(this.simulation.individuals.map((individual) => individual.id))
    for (const [id, circle] of this.circles) {
      if (liveIds.has(id)) continue
      this.circles.delete(id)
      this.tweens.add({ targets: circle, alpha: 0, duration: 180, onComplete: () => circle.destroy() })
      if (this.selectedId === id) this.selectedId = null
    }

    for (const individual of this.simulation.individuals) {
      let circle = this.circles.get(individual.id)
      if (!circle) {
        circle = this.createCircle(individual)
        this.circles.set(individual.id, circle)
      }
      circle.setPosition(individual.x * MAP_PIXEL_WIDTH, individual.y * MAP_PIXEL_HEIGHT)
      const radius = this.radiusFor(individual)
      circle.setRadius(radius)
      circle.setDisplaySize(radius * 2, radius * 2)
      circle.setAlpha(this.alphaFor(individual))
      const draggable = this.simulation.canTransplant(individual)
      this.input.setDraggable(circle, draggable)
      if (circle.input) circle.input.cursor = draggable ? 'grab' : 'pointer'
    }
    this.refreshCircleStyles()
  }

  private createCircle(individual: Individual): Phaser.GameObjects.Arc {
    const radius = this.radiusFor(individual)
    const circle = this.add.circle(
      individual.x * MAP_PIXEL_WIDTH,
      individual.y * MAP_PIXEL_HEIGHT,
      radius,
      STRATEGIES[individual.species.strategy].color,
    )
    circle.setData('individualId', individual.id)
    circle.setInteractive({ useHandCursor: true })
    circle.on('pointerover', (pointer: Phaser.Input.Pointer) => {
      circle?.setScale(1.16)
      this.callbacks.onHover(
        this.simulation.findIndividual(individual.id) ?? null,
        pointer.position.x,
        pointer.position.y,
      )
    })
    circle.on('pointerout', () => {
      circle?.setScale(1)
      this.callbacks.onHover(null)
    })
    circle.on('pointerdown', () => {
      this.selectedId = individual.id
      this.refreshCircleStyles()
      this.callbacks.onSelectIndividual(individual.id)
    })
    circle.on('dragstart', () => {
      const current = this.simulation.findIndividual(individual.id)
      if (!current || !this.simulation.canTransplant(current)) return
      this.dragOrigin = {
        id: current.id,
        x: current.x,
        y: current.y,
        wasPaused: this.simulation.paused,
      }
      this.simulation.paused = true
      circle?.setScale(1.18)
      circle?.setAlpha(1)
    })
    circle.on('drag', (_pointer: Phaser.Input.Pointer, dragX: number, dragY: number) => {
      if (this.dragOrigin?.id !== individual.id) return
      circle?.setPosition(
        Phaser.Math.Clamp(dragX, MAP_PIXEL_WIDTH * 0.015, MAP_PIXEL_WIDTH * 0.985),
        Phaser.Math.Clamp(dragY, MAP_PIXEL_HEIGHT * 0.02, MAP_PIXEL_HEIGHT * 0.98),
      )
    })
    circle.on('dragend', () => {
      if (this.dragOrigin?.id !== individual.id || !circle) return
      const origin = this.dragOrigin
      const result = this.simulation.transplant(
        individual.id,
        circle.x / MAP_PIXEL_WIDTH,
        circle.y / MAP_PIXEL_HEIGHT,
      )
      this.simulation.paused = origin.wasPaused
      this.dragOrigin = null
      circle.setScale(1)
      if (!result.ok) circle.setPosition(origin.x * MAP_PIXEL_WIDTH, origin.y * MAP_PIXEL_HEIGHT)
      this.callbacks.onTransplant(individual.id, result)
    })
    return circle
  }

  private refreshCircleStyles(): void {
    for (const individual of this.simulation.individuals) {
      const circle = this.circles.get(individual.id)
      if (!circle) continue
      const isPlayer = individual.species.code === this.simulation.playerCode
      const isSelected = individual.id === this.selectedId
      circle.setFillStyle(STRATEGIES[individual.species.strategy].color)
      if (isSelected) circle.setStrokeStyle(4, 0xf8f1d8, 1)
      else if (isPlayer) circle.setStrokeStyle(2.5, 0x132a22, 0.98)
      else circle.setStrokeStyle(1, 0xffffff, 0.5)
      circle.setDepth(isSelected ? 5 : isPlayer ? 3 : 2)
    }
  }

  private drawLight(): void {
    this.lightLayer.clear()
    const cellWidth = MAP_PIXEL_WIDTH / this.simulation.width
    const cellHeight = MAP_PIXEL_HEIGHT / this.simulation.height
    for (let y = 0; y < this.simulation.height; y += 1) {
      for (let x = 0; x < this.simulation.width; x += 1) {
        const light = this.simulation.lightGrid[y * this.simulation.width + x]
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
    const alpha = 0.1 + Math.min(0.14, (10 - seconds) * 0.012)
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
