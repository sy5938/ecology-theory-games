import Phaser from 'phaser'
import { fivePointStarVertices } from './map-rendering'

export type MarkerLod = 'overview' | 'stand' | 'individual'
export type MarkerLodMode = 'auto' | MarkerLod

export interface VectorMarker {
  id: number
  x: number
  y: number
  height: number
  color: number
  alpha: number
  player: boolean
  risk: boolean
}

export interface PlayerMarkerStyle {
  fillColor: number
  fillAlpha: number
  strokeColor: number
  strokeAlpha: number
  strokeWidthPx: number
  sizeScale: number
}

export interface VectorMarkerDisplayOptions {
  base: boolean
  playerState: boolean
  riskState: boolean
}

export interface MarkerScaleState {
  zoom: number
  lod: MarkerLod
  lodMode: MarkerLodMode
  devicePixelRatio: number
  gamePixelsPerCssPixel: number
  cssPixelsPerWorldPixel: number
  worldPixelsPerCssPixel: number
}

const PIPELINE_KEY = 'ForestVectorMarkerSdf'
const PIPELINE_BATCH_SIZE = 50_000
const RISK_COLOR = 0xd74236
const RISK_RADIUS_PX = 3

const DEFAULT_PLAYER_STYLE: PlayerMarkerStyle = {
  fillColor: 0xffffff,
  fillAlpha: 1,
  strokeColor: 0x17372f,
  strokeAlpha: 0,
  strokeWidthPx: 0,
  sizeScale: 1,
}

const FRAGMENT_SHADER = `
#define SHADER_NAME FOREST_VECTOR_MARKER_SDF_FS
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec4 uPlayerFill;

varying vec2 outTexCoord;
varying float outTintEffect;
varying vec4 outTint;

float starDistance(vec2 point, float radius, float innerRatio)
{
    const vec2 edgeA = vec2(0.809016994375, -0.587785252292);
    const vec2 edgeB = vec2(-0.809016994375, -0.587785252292);
    point.x = abs(point.x);
    point -= 2.0 * max(dot(edgeA, point), 0.0) * edgeA;
    point -= 2.0 * max(dot(edgeB, point), 0.0) * edgeB;
    point.x = abs(point.x);
    point.y -= radius;
    vec2 edge = innerRatio * vec2(-edgeA.y, edgeA.x) - vec2(0.0, 1.0);
    float projection = clamp(dot(point, edge) / dot(edge, edge), 0.0, radius);
    return length(point - edge * projection) * sign(point.y * edge.x - point.x * edge.y);
}

void main ()
{
    float signedRadius = outTintEffect;
    float radius = max(abs(signedRadius), 1.0);
    vec2 markerPoint = outTexCoord * 2.0 - 1.0;
    float distanceToCenter = length(markerPoint);
    float antialiasWidth = min(0.35, 1.15 / radius);
    float circleAlpha = 1.0 - smoothstep(1.0 - antialiasWidth, 1.0, distanceToCenter);
    vec4 tintColor = vec4(outTint.bgr, outTint.a);
    vec4 markerColor = tintColor;

    if (signedRadius < 0.0)
    {
        float starAlpha = 1.0 - smoothstep(-antialiasWidth, antialiasWidth, starDistance(markerPoint, 1.0, 0.45));
        circleAlpha = starAlpha;
        markerColor = uPlayerFill;
        markerColor.a *= tintColor.a;
    }

    float alpha = markerColor.a * circleAlpha;
    gl_FragColor = vec4(markerColor.rgb * alpha, alpha);
}
`

class VectorMarkerPipeline extends Phaser.Renderer.WebGL.Pipelines.MultiPipeline {
  constructor(game: Phaser.Game) {
    super({ game, fragShader: FRAGMENT_SHADER, batchSize: PIPELINE_BATCH_SIZE })
  }

  applyPlayerStyle(style: PlayerMarkerStyle): void {
    const fill = colorComponents(style.fillColor, style.fillAlpha)
    this.set4f('uPlayerFill', fill[0], fill[1], fill[2], fill[3])
  }
}

export class VectorMarkerLayer extends Phaser.GameObjects.Shape {
  private markers: readonly VectorMarker[] = []
  private lodMode: MarkerLodMode = 'auto'
  private playerStyle: PlayerMarkerStyle = { ...DEFAULT_PLAYER_STYLE }
  private displayOptions: VectorMarkerDisplayOptions = {
    base: true,
    playerState: true,
    riskState: false,
  }

  constructor(scene: Phaser.Scene) {
    super(scene, 'VectorMarkerLayer')
    this.setPosition(0, 0)
    if (scene.game.renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer) {
      const pipelines = scene.game.renderer.pipelines
      if (!pipelines.has(PIPELINE_KEY)) pipelines.add(PIPELINE_KEY, new VectorMarkerPipeline(scene.game))
      this.setPipeline(PIPELINE_KEY)
    }
    scene.add.existing(this)
  }

  setMarkers(markers: readonly VectorMarker[]): this {
    this.markers = markers
    return this
  }

  setDisplayOptions(options: Partial<VectorMarkerDisplayOptions>): this {
    this.displayOptions = { ...this.displayOptions, ...options }
    return this
  }

  getDisplayOptions(): VectorMarkerDisplayOptions {
    return { ...this.displayOptions }
  }

  setPlayerStyle(style: Partial<PlayerMarkerStyle>): this {
    this.playerStyle = {
      ...this.playerStyle,
      ...style,
      fillAlpha: Phaser.Math.Clamp(style.fillAlpha ?? this.playerStyle.fillAlpha, 0, 1),
      strokeAlpha: Phaser.Math.Clamp(style.strokeAlpha ?? this.playerStyle.strokeAlpha, 0, 1),
      strokeWidthPx: Phaser.Math.Clamp(style.strokeWidthPx ?? this.playerStyle.strokeWidthPx, 0, 8),
      sizeScale: Phaser.Math.Clamp(style.sizeScale ?? this.playerStyle.sizeScale, 0.6, 1.6),
    }
    return this
  }

  getPlayerStyle(): PlayerMarkerStyle {
    return { ...this.playerStyle }
  }

  setLodMode(mode: MarkerLodMode): this {
    this.lodMode = mode
    return this
  }

  getLodMode(): MarkerLodMode {
    return this.lodMode
  }

  resolveLod(zoom: number): MarkerLod {
    if (this.lodMode !== 'auto') return this.lodMode
    if (zoom < 2) return 'overview'
    if (zoom < 4.5) return 'stand'
    return 'individual'
  }

  screenRadiusPx(height: number, zoom: number, player = false): number {
    const logHeight = Math.log1p(Math.max(0, height))
    const overviewRadius = Phaser.Math.Clamp(1.5 + 0.8 * logHeight, 1.5, 3.5)
    const standRadius = Phaser.Math.Clamp(2.5 + 1.7 * logHeight, 2.5, 7)
    const individualRadius = Phaser.Math.Clamp(4 + 3 * logHeight, 4, 13)
    let radius: number
    if (this.lodMode === 'overview') radius = overviewRadius
    else if (this.lodMode === 'stand') radius = standRadius
    else if (this.lodMode === 'individual') radius = individualRadius
    else if (zoom <= 3) {
      radius = Phaser.Math.Linear(overviewRadius, standRadius, smoothstep(Phaser.Math.Clamp((zoom - 1) / 2, 0, 1)))
    } else {
      radius = Phaser.Math.Linear(standRadius, individualRadius, smoothstep(Phaser.Math.Clamp((zoom - 3) / 3, 0, 1)))
    }
    return player ? radius * this.playerStyle.sizeScale : radius
  }

  worldRadius(height: number, camera: Phaser.Cameras.Scene2D.Camera, player = false): number {
    return (this.screenRadiusPx(height, camera.zoom, player) * this.gamePixelsPerCssPixel(camera)) / camera.zoom
  }

  maximumWorldRadius(camera: Phaser.Cameras.Scene2D.Camera): number {
    const markerRadius = this.screenRadiusPx(Number.MAX_SAFE_INTEGER, camera.zoom) * Math.max(1, this.playerStyle.sizeScale)
    const maximumCssRadius = Math.max(markerRadius, markerRadius * 0.72 + RISK_RADIUS_PX)
    return (maximumCssRadius * this.gamePixelsPerCssPixel(camera)) / camera.zoom
  }

  cssPixelsToWorld(pixels: number, camera: Phaser.Cameras.Scene2D.Camera): number {
    return (pixels * this.gamePixelsPerCssPixel(camera)) / camera.zoom
  }

  getScaleState(camera: Phaser.Cameras.Scene2D.Camera): MarkerScaleState {
    const gamePixelsPerCssPixel = this.gamePixelsPerCssPixel(camera)
    return {
      zoom: camera.zoom,
      lod: this.resolveLod(camera.zoom),
      lodMode: this.lodMode,
      devicePixelRatio: typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1,
      gamePixelsPerCssPixel,
      cssPixelsPerWorldPixel: camera.zoom / gamePixelsPerCssPixel,
      worldPixelsPerCssPixel: gamePixelsPerCssPixel / camera.zoom,
    }
  }

  renderWebGL(
    renderer: Phaser.Renderer.WebGL.WebGLRenderer,
    _src: VectorMarkerLayer,
    camera: Phaser.Cameras.Scene2D.Camera,
  ): void {
    if (this.markers.length === 0 || (!this.displayOptions.base && !this.displayOptions.playerState && !this.displayOptions.riskState)) return
    camera.addToRenderList(this)
    const pipeline = renderer.pipelines.set(this.pipeline, this) as VectorMarkerPipeline
    renderer.pipelines.preBatch(this)
    pipeline.applyPlayerStyle(this.playerStyle)

    const matrix = (camera as unknown as { matrix: Phaser.GameObjects.Components.TransformMatrix }).matrix
    const cssScale = this.gamePixelsPerCssPixel(camera)
    const cameraAlpha = camera.alpha * this.alpha
    const worldView = camera.worldView
    const cullPadding = this.maximumWorldRadius(camera)
    const left = worldView.x - cullPadding
    const right = worldView.right + cullPadding
    const top = worldView.y - cullPadding
    const bottom = worldView.bottom + cullPadding

    for (const marker of this.markers) {
      if (marker.x < left || marker.x > right || marker.y < top || marker.y > bottom) continue
      const localX = marker.x - camera.scrollX
      const localY = marker.y - camera.scrollY
      const screenX = localX * matrix.a + localY * matrix.c + matrix.e
      const screenY = localX * matrix.b + localY * matrix.d + matrix.f
      const playerStyle = marker.player && this.displayOptions.playerState
      const radiusCss = this.screenRadiusPx(marker.height, camera.zoom, playerStyle)
      const radiusGame = radiusCss * cssScale
      const drawBase = this.displayOptions.base || (marker.player && this.displayOptions.playerState)
      if (drawBase) {
        this.batchCircle(
          pipeline,
          renderer,
          screenX,
          screenY,
          radiusGame,
          radiusCss,
          playerStyle ? 0xffffff : marker.color,
          marker.alpha * cameraAlpha,
          playerStyle,
        )
      }
      if (marker.risk && this.displayOptions.riskState) {
        const badgeRadiusGame = RISK_RADIUS_PX * cssScale
        this.batchCircle(
          pipeline,
          renderer,
          screenX + radiusGame * 0.72,
          screenY - radiusGame * 0.72,
          badgeRadiusGame,
          RISK_RADIUS_PX,
          RISK_COLOR,
          cameraAlpha,
          false,
        )
      }
    }

    renderer.pipelines.postBatch(this)
  }

  renderCanvas(
    renderer: Phaser.Renderer.Canvas.CanvasRenderer,
    _src: VectorMarkerLayer,
    camera: Phaser.Cameras.Scene2D.Camera,
  ): void {
    if (this.markers.length === 0 || (!this.displayOptions.base && !this.displayOptions.playerState && !this.displayOptions.riskState)) return
    camera.addToRenderList(this)
    const context = renderer.currentContext
    // CanvasRenderer copies camera.matrix to the context before visiting children;
    // coordinates below only compensate scroll and inverse-scale the CSS radius.
    const cssScale = this.gamePixelsPerCssPixel(camera)
    const worldView = camera.worldView
    const cullPadding = this.maximumWorldRadius(camera)
    const groups = new Map<string, { color: number; alpha: number; markers: VectorMarker[] }>()
    const playerGroups = new Map<number, VectorMarker[]>()
    const riskMarkers: VectorMarker[] = []

    for (const marker of this.markers) {
      if (
        marker.x < worldView.x - cullPadding || marker.x > worldView.right + cullPadding ||
        marker.y < worldView.y - cullPadding || marker.y > worldView.bottom + cullPadding
      ) continue
      const drawBase = this.displayOptions.base || (marker.player && this.displayOptions.playerState)
      if (drawBase) {
        if (marker.player && this.displayOptions.playerState) {
          const group = playerGroups.get(marker.alpha)
          if (group) group.push(marker)
          else playerGroups.set(marker.alpha, [marker])
        } else {
          const key = `${marker.color}:${marker.alpha}`
          const group = groups.get(key)
          if (group) group.markers.push(marker)
          else groups.set(key, { color: marker.color, alpha: marker.alpha, markers: [marker] })
        }
      }
      if (marker.risk && this.displayOptions.riskState) riskMarkers.push(marker)
    }

    context.save()
    for (const group of groups.values()) {
      context.beginPath()
      this.appendCanvasCircles(context, group.markers, camera, cssScale)
      context.fillStyle = cssColor(group.color, group.alpha)
      context.fill()
    }
    for (const [markerAlpha, markers] of playerGroups) {
      context.beginPath()
      this.appendCanvasStars(context, markers, camera, cssScale)
      context.fillStyle = cssColor(this.playerStyle.fillColor, this.playerStyle.fillAlpha * markerAlpha)
      context.fill()
    }
    if (riskMarkers.length > 0) {
      context.beginPath()
      for (const marker of riskMarkers) {
        const baseRadius = this.worldRadius(marker.height, camera, marker.player && this.displayOptions.playerState)
        const radius = (RISK_RADIUS_PX * cssScale) / camera.zoom
        const x = marker.x - camera.scrollX + baseRadius * 0.72
        const y = marker.y - camera.scrollY - baseRadius * 0.72
        context.moveTo(x + radius, y)
        context.arc(x, y, radius, 0, Math.PI * 2)
      }
      context.fillStyle = cssColor(RISK_COLOR, 1)
      context.fill()
    }
    context.restore()
  }

  private appendCanvasCircles(
    context: CanvasRenderingContext2D,
    markers: readonly VectorMarker[],
    camera: Phaser.Cameras.Scene2D.Camera,
    cssScale: number,
  ): void {
    for (const marker of markers) {
      const radius = (
        this.screenRadiusPx(marker.height, camera.zoom, marker.player && this.displayOptions.playerState) * cssScale
      ) / camera.zoom
      const x = marker.x - camera.scrollX
      const y = marker.y - camera.scrollY
      context.moveTo(x + radius, y)
      context.arc(x, y, radius, 0, Math.PI * 2)
    }
  }

  private appendCanvasStars(
    context: CanvasRenderingContext2D,
    markers: readonly VectorMarker[],
    camera: Phaser.Cameras.Scene2D.Camera,
    cssScale: number,
  ): void {
    for (const marker of markers) {
      const radius = (this.screenRadiusPx(marker.height, camera.zoom, true) * cssScale) / camera.zoom
      const points = fivePointStarVertices(marker.x - camera.scrollX, marker.y - camera.scrollY, radius)
      context.moveTo(points[0].x, points[0].y)
      for (let index = 1; index < points.length; index += 1) context.lineTo(points[index].x, points[index].y)
      context.closePath()
    }
  }

  private batchCircle(
    pipeline: VectorMarkerPipeline,
    renderer: Phaser.Renderer.WebGL.WebGLRenderer,
    x: number,
    y: number,
    radiusGame: number,
    radiusCss: number,
    color: number,
    alpha: number,
    player: boolean,
  ): void {
    const tint = Phaser.Renderer.WebGL.Utils.getTintAppendFloatAlpha(color, Phaser.Math.Clamp(alpha, 0, 1))
    pipeline.batchQuad(
      this,
      x - radiusGame,
      y - radiusGame,
      x - radiusGame,
      y + radiusGame,
      x + radiusGame,
      y + radiusGame,
      x + radiusGame,
      y - radiusGame,
      0,
      0,
      1,
      1,
      tint,
      tint,
      tint,
      tint,
      player ? -radiusCss : radiusCss,
      renderer.whiteTexture,
    )
  }

  private gamePixelsPerCssPixel(camera: Phaser.Cameras.Scene2D.Camera): number {
    const cssWidth = this.scene.game.canvas.clientWidth
    return cssWidth > 0 ? camera.width / cssWidth : 1
  }
}

function colorComponents(color: number, alpha: number): [number, number, number, number] {
  return [
    ((color >> 16) & 0xff) / 255,
    ((color >> 8) & 0xff) / 255,
    (color & 0xff) / 255,
    Phaser.Math.Clamp(alpha, 0, 1),
  ]
}

function cssColor(color: number, alpha: number): string {
  return `rgba(${(color >> 16) & 0xff},${(color >> 8) & 0xff},${color & 0xff},${Phaser.Math.Clamp(alpha, 0, 1)})`
}

function smoothstep(value: number): number {
  return value * value * (3 - 2 * value)
}
