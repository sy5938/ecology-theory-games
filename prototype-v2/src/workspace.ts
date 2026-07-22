export const WORKSPACE_LAYOUT_VERSION = 7
export const WORKSPACE_STORAGE_KEY = `forest-workspace-layout:v${WORKSPACE_LAYOUT_VERSION}`

type PanelId = 'map' | 'strategy' | 'statistics'
type Dock = 'left' | 'right-top' | 'right-bottom' | 'bottom' | null

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

interface PanelState {
  rect: Rect
  restoreRect: Rect | null
  minimized: boolean
  maximized: boolean
  columnExpanded: boolean
  closed: boolean
  dock: Dock
  z: number
}

interface SavedLayout {
  version: number
  viewport: { width: number; height: number }
  panels: Partial<Record<PanelId, PanelState>>
}

export interface WorkspaceLayoutApi {
  reset: () => void
  open: (panelId: PanelId) => void
  close: (panelId: PanelId) => void
  togglePanelMaximize: (panelId: PanelId) => boolean
  togglePanelVertical: (panelId: PanelId) => boolean
  getLayout: () => SavedLayout
}

const PANEL_IDS: PanelId[] = ['map', 'strategy', 'statistics']
const TASKBAR_HEIGHT = 0

function copyRect(rect: Rect): Rect {
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

class WorkspaceController implements WorkspaceLayoutApi {
  readonly root: HTMLElement

  private readonly panels = new Map<PanelId, HTMLElement>()
  private readonly states = new Map<PanelId, PanelState>()
  private readonly mobileQuery = window.matchMedia('(max-width: 899px)')
  private mobilePanel: PanelId | null = null
  private topZ = 4
  private resizeFrame: number | null = null
  private editing = false

  constructor(root: HTMLElement) {
    this.root = root
    for (const panel of Array.from(root.querySelectorAll<HTMLElement>('[data-workspace-panel][data-panel-id]'))) {
      const id = panel.dataset.panelId as PanelId
      if (PANEL_IDS.includes(id)) this.panels.set(id, panel)
    }
    this.loadLayout()
    if (!this.mobileQuery.matches) this.constrainAll()
    this.bind()
    this.applyAll()
  }

  reset = (): void => {
    localStorage.removeItem(WORKSPACE_STORAGE_KEY)
    this.states.clear()
    this.mobilePanel = null
    this.editing = false
    this.createDefaultStates()
    this.applyAll()
    this.persist()
  }

  open = (panelId: PanelId): void => {
    const state = this.states.get(panelId)
    if (!state) return
    if (this.mobileQuery.matches) {
      this.mobilePanel = panelId === 'map' || this.mobilePanel === panelId ? null : panelId
    } else {
      state.closed = false
      state.minimized = false
      state.z = ++this.topZ
    }
    this.applyAll()
    this.persist()
  }

  close = (panelId: PanelId): void => {
    if (panelId === 'map') return
    const state = this.states.get(panelId)
    if (!state) return
    if (this.mobileQuery.matches) this.mobilePanel = null
    else state.closed = true
    this.applyAll()
    this.persist()
  }

  togglePanelMaximize = (panelId: PanelId): boolean => {
    if (this.mobileQuery.matches) {
      this.mobilePanel = panelId === 'map' ? null : panelId
      this.applyAll()
      return panelId !== 'map'
    }
    this.toggleMaximize(panelId)
    return Boolean(this.states.get(panelId)?.maximized)
  }

  togglePanelVertical = (panelId: PanelId): boolean => {
    if (this.mobileQuery.matches) {
      this.mobilePanel = panelId === 'map' ? null : panelId
      this.applyAll()
      return panelId !== 'map'
    }
    const state = this.states.get(panelId)
    if (!state) return false
    if (state.columnExpanded || state.maximized) this.restore(panelId)
    else {
      state.restoreRect = copyRect(state.rect)
      state.rect = { x: state.rect.x, y: 0, width: state.rect.width, height: this.desktopHeight() }
      state.minimized = false
      state.maximized = false
      state.columnExpanded = true
      state.closed = false
      state.dock = null
      state.z = ++this.topZ
    }
    this.applyAll()
    this.persist()
    this.notifyResize(panelId)
    return state.columnExpanded
  }

  getLayout = (): SavedLayout => {
    const panels: Partial<Record<PanelId, PanelState>> = {}
    for (const id of PANEL_IDS) {
      const state = this.states.get(id)
      if (state) panels[id] = this.copyState(state)
    }
    return {
      version: WORKSPACE_LAYOUT_VERSION,
      viewport: { width: this.root.clientWidth, height: this.desktopHeight() },
      panels,
    }
  }

  destroy(): void {
    if (this.resizeFrame !== null) window.cancelAnimationFrame(this.resizeFrame)
  }

  private bind(): void {
    this.root.addEventListener('pointerdown', (event) => {
      const panel = (event.target as Element).closest<HTMLElement>('[data-workspace-panel]')
      if (panel) this.bringToFront(panel.dataset.panelId as PanelId)
    })
    for (const [id, panel] of this.panels) {
      panel.querySelector<HTMLElement>('[data-window-drag]')?.addEventListener('pointerdown', (event) => this.beginDrag(event, id))
      panel.querySelector<HTMLElement>('[data-window-drag]')?.addEventListener('dblclick', (event) => {
        if (!this.editing || (event.target as Element).closest('button')) return
        this.toggleMaximize(id)
      })
      panel.querySelector<HTMLElement>('[data-window-resize]')?.addEventListener('pointerdown', (event) => this.beginResize(event, id))
      panel.querySelectorAll<HTMLButtonElement>('[data-window-action]').forEach((button) => {
        button.addEventListener('click', () => this.runAction(id, button.dataset.windowAction ?? ''))
      })
    }
    document.querySelectorAll<HTMLButtonElement>('[data-workspace-open]').forEach((button) => {
      button.addEventListener('click', () => this.open(button.dataset.workspaceOpen as PanelId))
    })
    document.querySelector<HTMLButtonElement>('#reset-layout-button')?.addEventListener('click', this.reset)
    document.querySelector<HTMLButtonElement>('#edit-layout-button')?.addEventListener('click', () => {
      this.editing = !this.editing
      if (!this.editing) this.persist()
      this.applyAll()
    })
    this.mobileQuery.addEventListener('change', () => {
      this.mobilePanel = null
      this.applyAll()
      this.notifyResize()
    })
    window.addEventListener('resize', () => {
      if (this.resizeFrame !== null) return
      this.resizeFrame = window.requestAnimationFrame(() => {
        this.resizeFrame = null
        if (!this.mobileQuery.matches) this.constrainAll()
        this.applyAll()
      })
    })
  }

  private createDefaultStates(): void {
    for (const id of PANEL_IDS) {
      this.states.set(id, {
        rect: this.defaultRect(id),
        restoreRect: null,
        minimized: false,
        maximized: false,
        columnExpanded: false,
        closed: false,
        dock: id === 'map' ? 'left' : id === 'strategy' ? 'right-bottom' : 'right-top',
        z: id === 'map' ? 1 : id === 'strategy' ? 3 : 2,
      })
    }
    this.topZ = 4
  }

  private defaultRect(id: PanelId): Rect {
    const width = Math.max(720, this.root.clientWidth || 1200)
    const height = Math.max(680, this.desktopHeight())
    const gap = 10
    const rightWidth = Math.min(Math.max(340, Math.round(width * 0.47) - 35), width - 520 - gap)
    const mapWidth = width - rightWidth - gap
    const statisticsHeight = Math.min(height - gap - 250, Math.max(380, Math.round((height - gap) * 0.62)))
    if (id === 'map') return { x: 0, y: 0, width: mapWidth, height }
    if (id === 'statistics') return { x: mapWidth + gap, y: 0, width: rightWidth, height: statisticsHeight }
    return { x: mapWidth + gap, y: statisticsHeight + gap, width: rightWidth, height: height - statisticsHeight - gap }
  }

  private desktopHeight(): number {
    return Math.max(680, this.root.clientHeight - TASKBAR_HEIGHT || window.innerHeight - 130)
  }

  private loadLayout(): void {
    this.createDefaultStates()
    try {
      const raw = localStorage.getItem(WORKSPACE_STORAGE_KEY)
      if (!raw) return
      const saved = JSON.parse(raw) as SavedLayout
      if (saved.version !== WORKSPACE_LAYOUT_VERSION || !saved.panels) return
      const currentWidth = Math.max(1, this.root.clientWidth)
      const currentHeight = Math.max(1, this.desktopHeight())
      const scaleX = currentWidth / Math.max(1, finite(saved.viewport?.width, currentWidth))
      const scaleY = currentHeight / Math.max(1, finite(saved.viewport?.height, currentHeight))
      for (const id of PANEL_IDS) {
        const source = saved.panels[id]
        const fallback = this.states.get(id)!
        if (!source?.rect) continue
        this.states.set(id, {
          rect: this.constrainRect(id, {
            x: finite(source.rect.x, fallback.rect.x) * scaleX,
            y: finite(source.rect.y, fallback.rect.y) * scaleY,
            width: finite(source.rect.width, fallback.rect.width) * scaleX,
            height: finite(source.rect.height, fallback.rect.height) * scaleY,
          }),
          restoreRect: source.restoreRect ? this.constrainRect(id, source.restoreRect) : null,
          minimized: Boolean(source.minimized),
          maximized: Boolean(source.maximized),
          columnExpanded: Boolean(source.columnExpanded),
          closed: id === 'map' ? false : Boolean(source.closed),
          dock: source.dock ?? null,
          z: finite(source.z, fallback.z),
        })
      }
      this.topZ = Math.max(4, ...[...this.states.values()].map((state) => state.z))
    } catch {
      localStorage.removeItem(WORKSPACE_STORAGE_KEY)
    }
  }

  private runAction(id: PanelId, action: string): void {
    const state = this.states.get(id)
    if (!state) return
    if (this.mobileQuery.matches) {
      if (action === 'close' || action === 'minimize' || action === 'restore') this.mobilePanel = null
      else if (action === 'maximize') this.mobilePanel = id
      this.applyAll()
      return
    }
    if (action === 'minimize') state.minimized = true
    else if (action === 'maximize') this.maximize(id)
    else if (action === 'restore') this.restore(id)
    else if (action === 'dock') this.dockToDefault(id)
    else if (action === 'close') this.close(id)
    state.z = ++this.topZ
    this.applyAll()
    this.persist()
    this.notifyResize(id)
  }

  private toggleMaximize(id: PanelId): void {
    const state = this.states.get(id)
    if (!state || this.mobileQuery.matches) return
    if (state.maximized) this.restore(id)
    else this.maximize(id)
    this.applyAll()
    this.persist()
    this.notifyResize(id)
  }

  private maximize(id: PanelId): void {
    const state = this.states.get(id)
    if (!state) return
    if (!state.maximized && !state.columnExpanded) state.restoreRect = copyRect(state.rect)
    state.rect = { x: 0, y: 0, width: this.root.clientWidth, height: this.desktopHeight() }
    state.minimized = false
    state.maximized = true
    state.columnExpanded = false
    state.closed = false
    state.dock = null
  }

  private restore(id: PanelId): void {
    const state = this.states.get(id)
    if (!state) return
    const target = state.restoreRect ?? state.rect
    state.rect = this.constrainRect(id, target)
    state.restoreRect = null
    state.minimized = false
    state.maximized = false
    state.columnExpanded = false
    state.closed = false
    state.dock = null
  }

  private dockToDefault(id: PanelId): void {
    const state = this.states.get(id)
    if (!state) return
    if (!state.dock) state.restoreRect = copyRect(state.rect)
    state.rect = this.defaultRect(id)
    state.minimized = false
    state.maximized = false
    state.columnExpanded = false
    state.closed = false
    state.dock = id === 'map' ? 'left' : id === 'strategy' ? 'right-bottom' : 'right-top'
  }

  private beginDrag(event: PointerEvent, id: PanelId): void {
    if (!this.editing || this.mobileQuery.matches || event.button !== 0 || (event.target as Element).closest('button')) return
    const state = this.states.get(id)
    const panel = this.panels.get(id)
    if (!state || !panel) return
    if (state.maximized || state.columnExpanded || state.minimized) this.restore(id)
    state.dock = null
    state.z = ++this.topZ
    const origin = copyRect(state.rect)
    const pointerX = event.clientX
    const pointerY = event.clientY
    panel.setPointerCapture(event.pointerId)
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== event.pointerId) return
      state.rect = this.constrainRect(id, {
        ...state.rect,
        x: origin.x + moveEvent.clientX - pointerX,
        y: origin.y + moveEvent.clientY - pointerY,
      })
      this.applyPanel(id)
    }
    const finish = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== event.pointerId) return
      panel.removeEventListener('pointermove', move)
      panel.removeEventListener('pointerup', finish)
      panel.removeEventListener('pointercancel', finish)
      this.applyAll()
      this.persist()
      this.notifyResize(id)
    }
    panel.addEventListener('pointermove', move)
    panel.addEventListener('pointerup', finish)
    panel.addEventListener('pointercancel', finish)
    event.preventDefault()
  }

  private beginResize(event: PointerEvent, id: PanelId): void {
    if (!this.editing || this.mobileQuery.matches || event.button !== 0) return
    const state = this.states.get(id)
    const panel = this.panels.get(id)
    if (!state || !panel) return
    if (state.maximized || state.columnExpanded || state.minimized) this.restore(id)
    state.dock = null
    state.z = ++this.topZ
    const origin = copyRect(state.rect)
    const pointerX = event.clientX
    const pointerY = event.clientY
    panel.setPointerCapture(event.pointerId)
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== event.pointerId) return
      state.rect = this.constrainRect(id, {
        ...state.rect,
        width: origin.width + moveEvent.clientX - pointerX,
        height: origin.height + moveEvent.clientY - pointerY,
      })
      this.applyPanel(id)
      this.notifyResize(id)
    }
    const finish = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== event.pointerId) return
      panel.removeEventListener('pointermove', move)
      panel.removeEventListener('pointerup', finish)
      panel.removeEventListener('pointercancel', finish)
      this.persist()
      this.notifyResize(id)
    }
    panel.addEventListener('pointermove', move)
    panel.addEventListener('pointerup', finish)
    panel.addEventListener('pointercancel', finish)
    event.preventDefault()
  }

  private bringToFront(id: PanelId): void {
    const state = this.states.get(id)
    if (!state || this.mobileQuery.matches) return
    state.z = ++this.topZ
    this.applyPanel(id)
  }

  private constrainAll(): void {
    for (const id of PANEL_IDS) {
      const state = this.states.get(id)
      if (!state) continue
      if (state.maximized) state.rect = { x: 0, y: 0, width: this.root.clientWidth, height: this.desktopHeight() }
      else if (state.columnExpanded) state.rect = { ...this.constrainRect(id, state.rect), y: 0, height: this.desktopHeight() }
      else if (state.dock && !this.editing) state.rect = this.defaultRect(id)
      else state.rect = this.constrainRect(id, state.rect)
    }
  }

  private constrainRect(id: PanelId, rect: Rect): Rect {
    const panel = this.panels.get(id)
    const rootWidth = Math.max(1, this.root.clientWidth || window.innerWidth)
    const rootHeight = Math.max(1, this.desktopHeight())
    const configuredMinWidth = finite(Number(panel?.dataset.minWidth), 320)
    const configuredMinHeight = finite(Number(panel?.dataset.minHeight), 260)
    const minWidth = Math.min(configuredMinWidth, rootWidth)
    const minHeight = Math.min(configuredMinHeight, rootHeight)
    const width = Math.max(minWidth, Math.min(rootWidth, finite(rect.width, minWidth)))
    const height = Math.max(minHeight, Math.min(rootHeight, finite(rect.height, minHeight)))
    return {
      x: Math.max(0, Math.min(rootWidth - width, finite(rect.x, 0))),
      y: Math.max(0, Math.min(rootHeight - height, finite(rect.y, 0))),
      width,
      height,
    }
  }

  private applyAll(): void {
    this.root.toggleAttribute('data-mobile-workspace', this.mobileQuery.matches)
    this.root.toggleAttribute('data-edit-layout', this.editing)
    const editButton = document.querySelector<HTMLButtonElement>('#edit-layout-button')
    if (editButton) {
      editButton.classList.toggle('active', this.editing)
      editButton.setAttribute('aria-pressed', String(this.editing))
      editButton.textContent = this.editing ? '完成布局' : '编辑布局'
    }
    for (const panel of this.panels.values()) {
      panel.querySelector<HTMLElement>('.workspace-titlebar')?.toggleAttribute('data-window-drag', this.editing)
    }
    for (const id of PANEL_IDS) this.applyPanel(id)
    document.querySelectorAll<HTMLButtonElement>('[data-workspace-open]').forEach((button) => {
      const id = button.dataset.workspaceOpen as PanelId
      const state = this.states.get(id)
      const active = this.mobileQuery.matches ? id === 'map' ? this.mobilePanel === null : this.mobilePanel === id : Boolean(state && !state.closed && !state.minimized)
      button.classList.toggle('active', active)
      button.setAttribute('aria-pressed', String(active))
    })
  }

  private applyPanel(id: PanelId): void {
    const panel = this.panels.get(id)
    const state = this.states.get(id)
    if (!panel || !state) return
    if (this.mobileQuery.matches) {
      panel.style.removeProperty('left')
      panel.style.removeProperty('top')
      panel.style.removeProperty('width')
      panel.style.removeProperty('height')
      panel.style.removeProperty('z-index')
      panel.toggleAttribute('data-mobile-open', id === 'map' || this.mobilePanel === id)
      panel.removeAttribute('data-minimized')
      panel.removeAttribute('data-maximized')
      panel.removeAttribute('data-closed')
      return
    }
    panel.style.left = `${state.rect.x}px`
    panel.style.top = `${state.rect.y}px`
    panel.style.width = `${state.rect.width}px`
    panel.style.height = `${state.minimized ? 38 : state.rect.height}px`
    panel.style.zIndex = String(state.z)
    panel.toggleAttribute('data-minimized', state.minimized)
    panel.toggleAttribute('data-maximized', state.maximized || state.columnExpanded)
    panel.toggleAttribute('data-column-expanded', state.columnExpanded)
    panel.toggleAttribute('data-closed', state.closed)
    panel.toggleAttribute('data-docked', Boolean(state.dock))
    panel.querySelector<HTMLButtonElement>('[data-window-action="restore"]')?.toggleAttribute('hidden', !(state.minimized || state.maximized || state.columnExpanded || state.dock))
  }

  private copyState(state: PanelState): PanelState {
    return {
      ...state,
      rect: copyRect(state.rect),
      restoreRect: state.restoreRect ? copyRect(state.restoreRect) : null,
    }
  }

  private persist(): void {
    localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(this.getLayout()))
    this.root.dispatchEvent(new CustomEvent('workspace:layoutchange', { bubbles: true, detail: this.getLayout() }))
  }

  private notifyResize(panelId?: PanelId): void {
    const detail = panelId ? { panelId, rect: this.states.get(panelId)?.rect } : {}
    this.root.dispatchEvent(new CustomEvent('workspace:panelresize', { bubbles: true, detail }))
    window.dispatchEvent(new Event('resize'))
  }
}

let activeController: WorkspaceController | null = null

export function initializeWorkspace(root: HTMLElement | null = document.querySelector<HTMLElement>('#workspace-root')): WorkspaceLayoutApi | null {
  if (!root) return null
  if (activeController?.root === root) return activeController
  activeController?.destroy()
  activeController = new WorkspaceController(root)
  return activeController
}

export function resetWorkspaceLayout(): void {
  activeController?.reset()
}

declare global {
  interface Window {
    ForestWorkspace?: {
      initialize: typeof initializeWorkspace
      reset: typeof resetWorkspaceLayout
      version: number
      storageKey: string
    }
  }
}

window.ForestWorkspace = {
  initialize: initializeWorkspace,
  reset: resetWorkspaceLayout,
  version: WORKSPACE_LAYOUT_VERSION,
  storageKey: WORKSPACE_STORAGE_KEY,
}

const observeWorkspace = (): void => {
  const root = document.querySelector<HTMLElement>('#workspace-root')
  if (root && activeController?.root !== root) window.requestAnimationFrame(() => initializeWorkspace(root))
}

new MutationObserver(observeWorkspace).observe(document.body, { childList: true, subtree: true })
observeWorkspace()
