import { SPECIES, STRATEGIES, type Species, type Strategy } from './species'
import { SCENARIOS, type ScenarioId } from './simulation'
import './workspace'

export type SetupStep = 0 | 1 | 2 | 3 | 4

const header = (player: Species, scenarioId: ScenarioId) => `
  <header class="app-header">
    <div>
      <div class="eyebrow">${SCENARIOS[scenarioId].name} · 100 m × 100 m</div>
      <h1>像森林一样思考</h1>
      <p><strong>${player.name}</strong> · ${STRATEGIES[player.strategy].name}</p>
    </div>
    <div class="header-actions" aria-label="系统功能">
      <button class="quiet-button" id="help-button" type="button">玩法教程</button>
      <div class="font-controls" id="font-controls" aria-label="界面字号">
        <button type="button" data-font-size="small" title="小字号">小</button>
        <button type="button" data-font-size="medium" title="中字号">中</button>
        <button type="button" data-font-size="large" title="大字号">大</button>
      </div>
      <button class="quiet-button report-button" id="report-button" type="button">演替结算</button>
      <button class="quiet-button" id="export-button" type="button">导出数据</button>
      <button class="quiet-button" id="properties-button" type="button">属性表</button>
      <button class="quiet-button" id="edit-layout-button" type="button" aria-pressed="false">编辑布局</button>
      <button class="quiet-button" id="reset-layout-button" type="button">恢复布局</button>
      <button class="quiet-button" id="restart-button" type="button">重开</button>
    </div>
  </header>
`

const speciesLayerRows = (speciesList: Species[]) => speciesList.map((species) => `
  <label class="species-layer-row" data-species-layer="${species.code}">
    <input type="checkbox" data-layer-key="species:${species.code}" checked />
    <i style="--species-layer-color:${STRATEGIES[species.strategy].css}"></i>
    <span>${species.name}</span>
  </label>
`).join('')

const mapPanel = `
  <section class="map-panel" data-tutorial-target="map" data-workspace-scope="map">
    <div class="panel-heading map-heading">
      <div><span class="label">森林空间地图</span><strong id="map-summary">正在生成森林结构</strong></div>
      <div class="map-toolbar" aria-label="地图操作">
        <button type="button" class="map-tool" id="map-zoom-out" title="缩小地图">−</button>
        <button type="button" class="map-tool" id="map-zoom-in" title="放大地图">＋</button>
        <button type="button" class="map-tool" id="reset-map-button">复位</button>
        <span id="map-lod">精细</span>
      </div>
    </div>
    <div class="map-canvas-wrap" data-tutorial-target="inspect">
      <div id="game-root" class="game-root"></div>
      <svg class="map-scale-overlay" id="map-scale-overlay" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-label="地图米制坐标轴">
        <g class="map-grid-lines" vector-effect="non-scaling-stroke">
          ${[250, 500, 750].map((position) => `<line x1="${position}" y1="0" x2="${position}" y2="1000"></line>`).join('')}
          ${[250, 500, 750].map((position) => `<line x1="0" y1="${position}" x2="1000" y2="${position}"></line>`).join('')}
        </g>
        <g class="map-axis-lines" vector-effect="non-scaling-stroke">
          <line id="map-scale-line" x1="2" y1="998" x2="998" y2="998"></line>
          <line x1="2" y1="2" x2="2" y2="998"></line>
          ${[2, 250, 500, 750, 998].map((position) => `<line x1="${position}" y1="984" x2="${position}" y2="1000"></line>`).join('')}
          ${[2, 250, 500, 750, 998].map((position) => `<line x1="0" y1="${position}" x2="16" y2="${position}"></line>`).join('')}
        </g>
        <g class="map-axis-labels">
          ${[18, 250, 500, 750, 982].map((position, index) => `<text id="map-x-tick-${index}" x="${position}" y="978" text-anchor="${index === 0 ? 'start' : index === 4 ? 'end' : 'middle'}">${index * 25}</text>`).join('')}
          ${[750, 500, 250, 22].map((position, index) => `<text id="map-y-tick-${index + 1}" x="20" y="${position + 5}" text-anchor="start">${(index + 1) * 25}</text>`).join('')}
          <text class="map-axis-unit" x="982" y="955" text-anchor="end">m</text>
          <text class="map-axis-unit" x="20" y="43" text-anchor="start">m</text>
        </g>
      </svg>
    </div>
    <div class="map-footer"><span id="map-extent">100 m × 100 m · 左下角为 (0, 0)</span><span class="map-scale-readout"><i id="map-scale-line"></i><b id="map-scale-text">10 m</b></span><div class="light-scale"><span>低光</span><i></i><span>高光</span></div></div>
  </section>
`

const layerSidebar = `
  <aside class="layer-sidebar" id="layer-sidebar" aria-label="地图图层" data-tutorial-target="layers">
    <details class="layer-tree" id="layer-tree" open>
      <summary><span>图层</span><small>显示与样式</small></summary>
      <div class="layer-tree-content">
          <div class="layer-actions">
            <button id="layer-show-all" type="button">全部显示</button>
            <button id="layer-isolate" type="button">仅玩家</button>
            <button id="layer-zoom" type="button">缩放所选</button>
          </div>
          <fieldset><legend>高度层</legend>
            <div class="map-control-group" aria-label="地图层级">
              <button type="button" data-view-layer="all" class="active">全部</button>
              <button type="button" data-view-layer="canopy">林冠</button>
              <button type="button" data-view-layer="understory">林下</button>
            </div>
          </fieldset>
          <fieldset><legend>信息层</legend>
            <label><input type="checkbox" data-layer-key="grid" checked />主网格</label>
            <label><input type="checkbox" data-layer-key="subgrid" />次网格</label>
            <label><input type="checkbox" data-layer-key="axes" checked />坐标轴</label>
            <label><input type="checkbox" data-layer-key="light" checked />光照栅格</label>
            <label><input type="checkbox" data-layer-key="individuals" checked />全部个体</label>
            <label><input type="checkbox" data-layer-key="player" checked />玩家标记</label>
            <div class="detail-layer-anchor">
              <label><input type="checkbox" data-layer-key="risk" />风险标记</label>
              <label><input type="checkbox" data-layer-key="death" />新近死亡</label>
              <div id="detail-layer-hint" class="detail-layer-hint hidden" role="status">已进入个体尺度，可开启“风险标记”或“新近死亡”。<button type="button" id="dismiss-detail-layer-hint">知道了</button></div>
            </div>
            <label><input type="checkbox" data-layer-key="selected" checked />选中对象</label>
            <label><input type="checkbox" data-layer-key="disturbance" checked />扰动范围</label>
          </fieldset>
          <fieldset><legend>生活史阶段</legend>
            <label><input type="checkbox" data-layer-key="stage:seed" checked />种子</label>
            <label><input type="checkbox" data-layer-key="stage:seedling" checked />幼苗</label>
            <label><input type="checkbox" data-layer-key="stage:sapling" checked />幼树</label>
            <label><input type="checkbox" data-layer-key="stage:adult" checked />成树</label>
          </fieldset>
          <details class="species-layers"><summary>物种图层</summary><div id="species-layer-rows"></div></details>
          <fieldset class="player-style-controls"><legend>玩家标记</legend>
            <label class="player-color-field" for="player-color-picker">颜色<input id="player-color-picker" type="color" value="#ffffff" /></label>
            <div class="player-color-swatches">
              <button type="button" data-player-color="#ffffff" style="--player-color:#ffffff" aria-label="白色"></button>
              <button type="button" data-player-color="#ffb45b" style="--player-color:#ffb45b" aria-label="橙色"></button>
              <button type="button" data-player-color="#87d8ff" style="--player-color:#87d8ff" aria-label="蓝色"></button>
              <button type="button" data-player-color="#ff70a6" style="--player-color:#ff70a6" aria-label="粉色"></button>
              <button type="button" data-player-color="#d8ff5f" style="--player-color:#d8ff5f" aria-label="黄绿色"></button>
              <button type="button" data-player-color="#c9a7ff" style="--player-color:#c9a7ff" aria-label="紫色"></button>
            </div>
            <div class="marker-size-options" aria-label="玩家标记尺寸">
              <button type="button" data-marker-size="small">小</button>
              <button type="button" data-marker-size="medium" class="active">中</button>
              <button type="button" data-marker-size="large">大</button>
            </div>
            <button id="reset-player-style" type="button">恢复标记样式</button>
          </fieldset>
      </div>
    </details>
  </aside>
`

const simulationControls = `
  <section class="simulation-controls surface" data-tutorial-target="start">
    <div class="clock"><span id="game-time">第 0.0 年</span><small id="forest-phase">观察准备期</small></div>
    <button class="primary-control" id="pause-button" type="button">开始演替</button>
    <div class="speed-group" aria-label="演化速度">
      <button type="button" data-speed="1" class="active">1×</button>
      <button type="button" data-speed="2">2×</button>
      <button type="button" data-speed="4">4×</button>
      <button type="button" data-speed="8" data-long-term disabled title="第 100 年结算后解锁">8×</button>
      <button type="button" data-speed="16" data-long-term disabled title="第 100 年结算后解锁">16×</button>
    </div>
    <span class="control-hint">先观察地图和个体状态，再开始时间</span>
  </section>
`

const allocationPanel = `
  <section class="allocation-panel allocation-dock surface" data-tutorial-target="allocation">
    <div class="panel-heading">
      <div><span class="label">你的生命史策略</span><strong id="allocation-impact">等待第一个生态时间步</strong></div>
      <div class="allocation-tools">
        <div class="active-abilities" aria-label="主动能力">
          <button type="button" data-ability="defense"><strong>诱导防御</strong><span id="defense-status">18 储备</span></button>
          <button type="button" data-ability="mast"><strong>集中结实</strong><span id="mast-status">15 储备</span></button>
          <button type="button" data-ability="disperse"><strong>远距播散</strong><span id="disperse-status">12 储备</span></button>
          <button type="button" data-ability="nursery"><strong>幼苗保育</strong><span id="nursery-status">15 储备</span></button>
        </div>
        <div class="allocation-presets" aria-label="快速策略">
          <button type="button" data-allocation-preset="balanced">均衡观察</button>
          <button type="button" data-allocation-preset="canopy">抢占林冠</button>
          <button type="button" data-allocation-preset="pioneer">先锋扩张</button>
          <button type="button" data-allocation-preset="shade">林下等待</button>
          <button type="button" data-allocation-preset="recovery">稳健恢复</button>
        </div>
      </div>
    </div>
    <div class="allocation-grid" data-allocation-grid>
    <div class="allocation-row growth">
      <label for="growth-slider"><span>生长</span><strong id="growth-value">40%</strong></label>
      <input id="growth-slider" data-allocation="growth" type="range" min="0" max="100" step="1" />
      <small><span>争夺高度与林冠</span><b id="growth-spend">投入 0.0</b></small>
    </div>
    <div class="allocation-row reproduction">
      <label for="reproduction-slider"><span>繁殖</span><strong id="reproduction-value">30%</strong></label>
      <input id="reproduction-slider" data-allocation="reproduction" type="range" min="0" max="100" step="1" />
      <small><span>成熟个体产种并自动扩散</span><b id="reproduction-spend">投入 0.0</b></small>
    </div>
    <div class="allocation-row reserve">
      <label for="reserve-slider"><span>储备</span><strong id="reserve-value">30%</strong></label>
      <input id="reserve-slider" data-allocation="reserve" type="range" min="0" max="100" step="1" />
      <small><span>缓冲低光、虫害与扰动</span><b id="reserve-spend">存入 0.0</b></small>
    </div>
    </div>
    <div class="carbon-flow">
      <div><span>碳收入</span><strong id="carbon-income">0.0</strong></div>
      <div><span>维持成本</span><strong id="maintenance-cost">0.0</strong></div>
      <div><span>当期盈余</span><strong id="carbon-surplus">0.0</strong></div>
      <div><span>碳储备</span><strong id="carbon-reserve">0.0</strong></div>
    </div>
  </section>
`

const selectedPanel = `
  <section class="selected-panel map-inspection">
    <div class="panel-heading">
      <div><span class="label">地图检查</span><strong id="selected-title">点击一个个体或空地</strong></div>
      <div class="inspection-actions"><button type="button" class="inline-tool hidden" id="focus-selected-button">定位</button><button type="button" class="inline-tool" id="close-map-query" aria-label="关闭地图查询">关闭</button></div>
    </div>
    <div id="selected-content" class="selected-content empty">
      白色五角星是自己的个体；幼苗和幼树可拖动移栽，Shift / ⌘ 可多选。
    </div>
  </section>
`

const chartPanel = `
  <section class="chart-panel" data-tutorial-target="statistics">
    <div class="panel-heading chart-heading">
      <div><span class="label">动态指标</span><strong id="chart-title">玩家种群走势</strong></div>
      <button type="button" class="inline-tool" id="expand-statistics-button" aria-expanded="false">放大查看</button>
      <div class="chart-picker" id="statistics-detail"><span>图表</span>
        <details class="chart-menu" id="chart-mode-menu">
          <summary><span id="chart-mode-label">各物种个体数</span></summary>
          <div class="chart-menu-popover">
            <section><strong>此消彼长</strong>
              <button type="button" data-chart-mode="species-abundance">各物种个体数</button>
              <button type="button" data-chart-mode="functional-abundance">各功能型个体数</button>
              <button type="button" data-chart-mode="functional-demography-counts">功能型出生与死亡个体</button>
              <button type="button" data-chart-mode="functional-demography-rates">功能型出生率与死亡率</button>
            </section>
            <section><strong>群落结构</strong>
              <button type="button" data-chart-mode="composition">物种组成</button>
              <button type="button" data-chart-mode="stage-composition">生活史阶段</button>
              <button type="button" data-chart-mode="basal-area">胸高断面积</button>
              <button type="button" data-chart-mode="diversity">物种丰富度</button>
            </section>
            <section><strong>过程与对象</strong>
              <button type="button" data-chart-mode="trend">当前范围走势</button>
              <button type="button" data-chart-mode="carbon">群落固碳</button>
              <button type="button" data-chart-mode="selected">选中对象</button>
            </section>
          </div>
        </details>
        <select id="chart-mode-select" class="visually-hidden" tabindex="-1" aria-hidden="true">
        <optgroup label="此消彼长">
          <option value="species-abundance">各物种个体数</option>
          <option value="functional-abundance">各功能型个体数</option>
          <option value="functional-demography-counts">功能型出生与死亡个体</option>
          <option value="functional-demography-rates">功能型出生率与死亡率</option>
        </optgroup>
        <optgroup label="群落结构">
          <option value="composition">物种组成</option>
          <option value="stage-composition">生活史阶段</option>
          <option value="basal-area">胸高断面积</option>
          <option value="diversity">物种丰富度</option>
        </optgroup>
        <optgroup label="过程与对象">
          <option value="trend">当前范围走势</option>
          <option value="carbon">群落固碳</option>
          <option value="selected">选中对象</option>
        </optgroup>
      </select></div>
    </div>
    <div id="population-chart" class="population-chart"></div>
  </section>
`

const eventPanel = `
  <section class="event-panel map-event-strip">
    <div class="event-status"><span class="event-dot"></span><strong id="event-headline">环境暂时稳定</strong></div>
    <p id="event-message">优势积累会带来专性虫害风险；储备和主动能力提供缓冲。</p>
  </section>
`

const overlays = `
  <div id="hover-tooltip" class="hover-tooltip hidden"></div>
  <aside id="properties-drawer" class="properties-drawer hidden" aria-label="个体属性表">
    <div class="drawer-heading"><div><span class="label">全群落个体</span><h2>属性表</h2></div><button id="close-properties-button" type="button">关闭</button></div>
    <div class="property-summary" id="property-summary"></div>
    <div class="property-filters">
      <input id="property-search" type="search" placeholder="搜索物种或编号" />
      <select id="property-filter"><option value="all">全部个体</option><option value="own">我的物种</option><option value="risk">风险个体</option><option value="canopy">林冠</option><option value="understory">林下</option></select>
      <select id="property-sort"><option value="risk">风险优先</option><option value="height">树高优先</option><option value="health">健康最低</option></select>
    </div>
    <div class="property-table-wrap" id="property-table-wrap"><table><thead><tr><th>个体</th><th>阶段</th><th>树高</th><th>胸径</th><th>健康</th><th>竞争</th><th>风险</th></tr></thead><tbody id="property-table-body"></tbody></table></div>
    <div class="property-pagination"><button id="property-page-prev" type="button">上一页</button><span id="property-page-status">第 1 / 1 页</span><button id="property-page-next" type="button">下一页</button></div>
  </aside>
  <div id="report-modal" class="modal hidden" role="dialog" aria-modal="true">
    <div class="modal-card report-card">
      <header class="report-header"><div class="eyebrow" id="report-kicker">森林演替结算</div><h2 id="report-title">第 0 年森林演替结算</h2></header>
      <div class="report-scroll-body">
        <h3 class="report-outcome" id="report-outcome">当前格局</h3>
        <div class="report-summary"><span>关键变化</span><p id="report-summary"></p></div>
        <div id="report-chart" class="report-chart"></div>
        <div class="report-columns">
          <section><h3>科学指标</h3><ul id="report-details"></ul></section>
          <section><h3>主要原因</h3><ul id="report-drivers"></ul></section>
          <section><h3>玩家策略影响</h3><ul id="report-strategy"></ul></section>
          <section><h3>未来风险</h3><ul id="report-risks"></ul></section>
          <section><h3>关键转折</h3><ol id="report-events"></ol></section>
        </div>
      </div>
      <div class="modal-actions">
        <button id="continue-button" type="button">返回森林</button>
        <button id="report-export-button" type="button" class="quiet-button">导出本局数据</button>
        <button id="modal-restart-button" type="button" class="quiet-button">重新开始</button>
      </div>
    </div>
  </div>
  <div id="tutorial-modal" class="tutorial-overlay hidden" role="dialog" aria-modal="false" aria-labelledby="tutorial-title">
    <div class="tutorial-spotlight" id="tutorial-spotlight" aria-hidden="true"></div>
    <div class="tutorial-card">
      <div class="eyebrow" id="tutorial-step-label">新手教程 · 1 / 5</div>
      <h2 id="tutorial-title">先认识你的森林</h2>
      <p id="tutorial-body"></p>
      <div class="tutorial-actions"><button id="tutorial-skip" type="button" class="quiet-button">跳过教程</button><button id="tutorial-next" type="button">下一步</button></div>
    </div>
  </div>
`

function workspacePanel(
  id: 'map' | 'strategy' | 'statistics',
  title: string,
  content: string,
  options: { required?: boolean; minWidth: number; minHeight: number },
): string {
  return `
    <section
      class="workspace-panel surface workspace-${id}"
      data-workspace-panel
      data-panel-id="${id}"
      data-min-width="${options.minWidth}"
      data-min-height="${options.minHeight}"
      ${options.required ? 'data-required-panel="true"' : ''}
      aria-labelledby="workspace-title-${id}"
    >
      <header class="workspace-titlebar" data-window-drag>
        <span class="workspace-grip" aria-hidden="true">⠿</span>
        <strong id="workspace-title-${id}">${title}</strong>
        <div class="workspace-window-actions">
          <button type="button" data-window-action="minimize" title="最小化窗口" aria-label="最小化${title}">−</button>
          <button type="button" data-window-action="maximize" title="最大化窗口" aria-label="最大化${title}">□</button>
          <button type="button" data-window-action="restore" title="恢复窗口" aria-label="恢复${title}">↙</button>
          ${options.required ? '' : `<button type="button" data-window-action="close" title="关闭窗口" aria-label="关闭${title}">×</button>`}
        </div>
      </header>
      <div class="workspace-panel-content">${content}</div>
      <button class="workspace-resize-handle" type="button" data-window-resize="se" aria-label="调整${title}大小"></button>
    </section>
  `
}

export function gameLayout(player: Species, scenarioId: ScenarioId, activeSpecies: Species[] = SPECIES): string {
  return `
    <div class="app-shell unified-layout">
      ${header(player, scenarioId)}
      <main class="workspace-root" id="workspace-root" aria-label="森林演替工作台">
        ${workspacePanel('map', '森林地图', `<div class="workspace-map-stack"><div class="workspace-map-rail">${layerSidebar}</div><div class="workspace-map-main">${mapPanel}<aside class="map-query-popover hidden" id="map-query-popover" aria-live="polite">${selectedPanel}</aside><div class="map-functional-legend" aria-label="功能型图例"><span><i class="legend-own">★</i>玩家</span><button type="button" data-legend-strategy="sun"><i style="--legend:#e9933e"></i>喜阳先锋型</button><button type="button" data-legend-strategy="shade"><i style="--legend:#627bb6"></i>耐荫型</button><button type="button" data-legend-strategy="broad"><i style="--legend:#4e9a70"></i>广适型</button><span><i class="legend-selection"></i>选中</span></div>${simulationControls}${eventPanel}</div></div>`, { required: true, minWidth: 520, minHeight: 560 })}
        ${workspacePanel('strategy', '你的生命史策略', allocationPanel, { minWidth: 340, minHeight: 250 })}
        ${workspacePanel('statistics', '统计与图表', `<div class="workspace-statistics-stack">${chartPanel}</div>`, { minWidth: 340, minHeight: 360 })}
        <nav class="workspace-taskbar" aria-label="工作台窗口">
          <button type="button" data-workspace-open="map">地图</button>
          <button type="button" data-workspace-open="strategy">策略</button>
          <button type="button" data-workspace-open="statistics">统计</button>
          <span>默认固定布局 · 开启“编辑布局”后可调整</span>
        </nav>
      </main>
    </div>
    ${overlays}
    <template id="active-species-layer-template">${speciesLayerRows(activeSpecies)}</template>
  `
}

function densityToSlider(density: number): number {
  return Math.round(Math.sqrt((density - 10) / 390) * 100)
}

export function setupLayout(
  selectedStrategy: Strategy = 'sun',
  selectedCode = 'LORCHI',
  selectedScenario: ScenarioId = 'colonization',
  density = SCENARIOS[selectedScenario].defaultDensity,
  step: SetupStep = 0,
): string {
  const strategyCards = (Object.keys(STRATEGIES) as Strategy[]).map((strategy) => {
    const entry = STRATEGIES[strategy]
    return `<button type="button" class="strategy-card ${selectedStrategy === strategy ? 'selected' : ''}" data-strategy="${strategy}"><i style="--strategy:${entry.css}"></i><strong>${entry.name}</strong><span>${entry.description}</span></button>`
  }).join('')
  const speciesCards = SPECIES.filter((species) => species.strategy === selectedStrategy).map(
    (species) => `<button type="button" class="species-card ${selectedCode === species.code ? 'selected' : ''}" data-species="${species.code}"><strong>${species.name}</strong><em>${species.latin}</em><span>最高约 ${species.maxHeight} m · ${species.environment}</span></button>`,
  ).join('')
  const scenarioCards = (Object.keys(SCENARIOS) as ScenarioId[]).map((scenarioId) => {
    const scenario = SCENARIOS[scenarioId]
    return `<button type="button" class="scenario-card ${selectedScenario === scenarioId ? 'selected' : ''}" data-scenario="${scenarioId}"><span>${scenario.coverHint}</span><strong>${scenario.name}</strong><p>${scenario.description}</p><small>默认 ${scenario.defaultDensity} 个/400 m² · ${scenario.lightHint}</small></button>`
  }).join('')
  const player = SPECIES.find((species) => species.code === selectedCode) ?? SPECIES[0]
  const backgroundTotal = density * 25
  const total = backgroundTotal + (selectedScenario === 'colonization' ? 6 : 0)
  const densityMessage = density >= 150
    ? '高密度：以种子、幼苗和小径木为主，自疏压力强。'
    : density >= 50
      ? '中等密度：小径木较多，竞争与林窗机会并存。'
      : '低密度：个体更少、平均胸径较大，空白生境更多。'
  const stepContents = [
    `<div class="step-label">01 · 选择森林情景</div><h2>你想从怎样的森林开始？</h2><p class="wizard-intro">不同情景改变初始林冠与光照，但空间位置都保持完全随机。</p><div class="scenario-grid">${scenarioCards}</div>`,
    `<div class="step-label">02 · 调整初始群落密度</div><h2>每个 20 × 20 m 样方放多少个体？</h2><p class="wizard-intro">低值区获得更多滑动行程，也可以直接输入精确数值。</p><div class="density-control"><label for="density-slider"><span>10</span><strong><output id="density-value">${density}</output> 个 / 400 m²</strong><span>400</span></label><input id="density-slider" type="range" min="0" max="100" step="1" value="${densityToSlider(density)}" /><div class="density-exact"><label for="density-input">精确数量</label><input id="density-input" type="number" min="10" max="400" step="1" value="${density}" /></div></div><div class="density-preview"><span>100 × 100 m 全图预计</span><strong id="density-total">${total.toLocaleString()} 个体</strong><p id="density-impact">${densityMessage}</p></div>`,
    `<div class="step-label">03 · 选择生态策略类型</div><h2>你准备以什么方式生存？</h2><p class="wizard-intro">策略决定光照耐受、扩散、生长与死亡风险。</p><div class="strategy-grid">${strategyCards}</div>`,
    `<div class="step-label">04 · 选择真实物种</div><h2>选择你要控制的物种</h2><p class="wizard-intro">同一策略下的物种仍有最大树高与环境偏好的差异。</p><div class="species-grid" id="species-grid">${speciesCards}</div>`,
    `<div class="step-label">05 · 确认本局设置</div><h2>从空地与竞争中开始演替</h2><div class="setup-summary"><div><span>森林情景</span><strong>${SCENARIOS[selectedScenario].name}</strong></div><div><span>初始密度</span><strong>${density} 个 / 400 m²</strong></div><div><span>预计全图</span><strong>${total.toLocaleString()} 个体${selectedScenario === 'colonization' ? '（含玩家 6 个）' : ''}</strong></div><div><span>你的物种</span><strong>${player.name} · ${STRATEGIES[player.strategy].name}</strong></div></div><p class="density-warning">${densityMessage} 自定义密度会改变初始林冠覆盖、平均胸径和竞争强度。</p>`,
  ]
  return `
    <main class="setup-screen">
      <nav class="setup-system-bar" aria-label="界面字号">
        <span>字体</span>
        <div class="font-controls">
          <button type="button" data-font-size="small" title="小字号">小</button>
          <button type="button" data-font-size="medium" title="中字号">中</button>
          <button type="button" data-font-size="large" title="大字号">大</button>
        </div>
      </nav>
      <section class="setup-copy">
        <div class="eyebrow">FOREST SUCCESSION GAME</div>
        <h1>像森林一样思考</h1>
        <div class="setup-manifesto">
          <p>生长、繁殖与储备，每一份投入都意味着放弃另一种可能。</p>
          <p>从森林的尺度思考：向上争夺阳光，为后代豪赌，还是为未知保留力量？</p>
        </div>
        <div class="setup-rules"><span>100 m × 100 m</span><span>空间完全随机</span><span>第 100 年复盘</span><span>可持续演替</span></div>
      </section>
      <section class="setup-form surface" id="setup-wizard" data-step="${step + 1}">
        <div class="wizard-progress" id="wizard-progress" aria-label="开局进度">${[0, 1, 2, 3, 4].map((index) => `<i class="${index <= step ? 'active' : ''}"></i>`).join('')}<span>${step + 1} / 5</span></div>
        <div class="wizard-content">${stepContents[step]}</div>
        <div class="wizard-actions">
          <button type="button" id="wizard-back" class="quiet-button" ${step === 0 ? 'disabled' : ''}>上一步</button>
          ${step < 4
            ? '<button type="button" id="wizard-next" class="primary-button">下一步</button>'
            : `<button type="button" id="start-game" class="primary-button">进入${SCENARIOS[selectedScenario].name}</button>`}
        </div>
        <p class="setup-note">进入地图后由你主动开始时间；首次进入会显示五步玩法教程。</p>
      </section>
    </main>
  `
}
