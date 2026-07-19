import { SPECIES, STRATEGIES, type Species, type Strategy } from './species'
import { SCENARIOS, type ScenarioId } from './simulation'

const header = (player: Species, scenarioId: ScenarioId) => `
  <header class="app-header">
    <div>
      <div class="eyebrow">THROWAWAY PROTOTYPE · ${SCENARIOS[scenarioId].name}</div>
      <h1>像森林一样思考</h1>
      <p><strong>${player.name}</strong> · ${STRATEGIES[player.strategy].name}</p>
    </div>
    <div class="header-actions">
      <div class="clock"><span id="game-time">第 0.0 年</span><small id="forest-phase">种群建立期</small></div>
      <button class="quiet-button report-button" id="report-button" type="button">演替结算</button>
      <button class="quiet-button" id="export-button" type="button">导出数据</button>
      <button class="quiet-button" id="properties-button" type="button">属性表</button>
      <button class="quiet-button" id="pause-button" type="button">暂停</button>
      <div class="speed-group" aria-label="演化速度">
        <button type="button" data-speed="1" class="active">1×</button>
        <button type="button" data-speed="2">2×</button>
        <button type="button" data-speed="4">4×</button>
        <button type="button" data-speed="8" data-long-term disabled title="第 30 年结算后解锁">8×</button>
        <button type="button" data-speed="16" data-long-term disabled title="第 30 年结算后解锁">16×</button>
      </div>
      <button class="quiet-button" id="restart-button" type="button">重开</button>
    </div>
  </header>
`

const mapPanel = `
  <section class="map-panel surface">
    <div class="panel-heading map-heading">
      <div><span class="label">林下光照地图</span><strong id="map-summary">正在生成森林结构</strong></div>
      <div class="map-guides">
        <div class="map-control-group" aria-label="地图层级">
          <button type="button" data-view-layer="all" class="active">全部</button>
          <button type="button" data-view-layer="canopy">林冠</button>
          <button type="button" data-view-layer="understory">林下</button>
        </div>
        <button type="button" class="map-tool" id="reset-map-button">复位地图</button>
        <span class="transplant-hint">滚轮缩放 · 空格/右键平移</span>
        <div class="legend" aria-label="地图图例">
          <span><i class="legend-own"></i>自己</span>
          <span><i style="--legend:#e9933e"></i>喜阳</span>
          <span><i style="--legend:#627bb6"></i>喜阴</span>
          <span><i style="--legend:#4e9a70"></i>广适</span>
          <span><i class="legend-risk"></i>风险</span>
        </div>
      </div>
    </div>
    <div id="game-root" class="game-root"></div>
    <div class="map-footer"><span>地图范围 48 m × 32 m</span><div class="light-scale"><span>低光</span><i></i><span>高光</span></div></div>
  </section>
`

const allocationPanel = `
  <section class="allocation-panel allocation-dock surface">
    <div class="panel-heading">
      <div><span class="label">你的生命史策略</span><strong id="allocation-impact">等待第一个生态时间步</strong></div>
      <div class="allocation-tools">
        <div class="active-abilities" aria-label="主动能力">
          <button type="button" data-ability="defense"><strong>诱导防御</strong><span id="defense-status">18 储备</span></button>
          <button type="button" data-ability="mast"><strong>集中结实</strong><span id="mast-status">15 储备</span></button>
        </div>
        <div class="allocation-presets" aria-label="快速策略">
          <button type="button" data-allocation-preset="canopy">抢占林冠</button>
          <button type="button" data-allocation-preset="spread">扩散下一代</button>
          <button type="button" data-allocation-preset="survive">稳健生存</button>
        </div>
        <span class="allocation-total" id="allocation-total">100%</span>
      </div>
    </div>
    <div class="allocation-row growth">
      <label for="growth-slider"><span>生长</span><strong id="growth-value">40%</strong></label>
      <input id="growth-slider" data-allocation="growth" type="range" min="0" max="100" step="1" />
      <small><span>争夺高度与林冠</span><b id="growth-spend">投入 0.0</b></small>
    </div>
    <div class="allocation-row reproduction">
      <label for="reproduction-slider"><span>繁殖</span><strong id="reproduction-value">30%</strong></label>
      <input id="reproduction-slider" data-allocation="reproduction" type="range" min="0" max="100" step="1" />
      <small><span>成树产种并自动扩散</span><b id="reproduction-spend">投入 0.0</b></small>
    </div>
    <div class="allocation-row reserve">
      <label for="reserve-slider"><span>储备</span><strong id="reserve-value">30%</strong></label>
      <input id="reserve-slider" data-allocation="reserve" type="range" min="0" max="100" step="1" />
      <small><span>缓冲低光、虫害与扰动</span><b id="reserve-spend">存入 0.0</b></small>
    </div>
    <div class="carbon-flow">
      <div><span>碳收入</span><strong id="carbon-income">0.0</strong></div>
      <div><span>维持成本</span><strong id="maintenance-cost">0.0</strong></div>
      <div><span>当期盈余</span><strong id="carbon-surplus">0.0</strong></div>
      <div><span>碳储备</span><strong id="carbon-reserve">0.0</strong></div>
    </div>
  </section>
`

const overviewPanel = `
  <section class="overview-panel surface">
    <div class="panel-heading"><div><span class="label">当前仓位</span><strong>玩家物种状态</strong></div></div>
    <div class="metric-grid">
      <div><span>存活个体</span><strong id="population-total">0</strong></div>
      <div><span>平均健康</span><strong id="average-health">0%</strong></div>
      <div><span>群落占比</span><strong id="population-share">0%</strong></div>
      <div><span>风险个体</span><strong id="risk-count">0</strong></div>
      <div><span>林冠覆盖</span><strong id="canopy-cover">0%</strong></div>
      <div><span>平均光照</span><strong id="average-light">0%</strong></div>
    </div>
    <div class="stage-bar" id="stage-bar"></div>
    <div class="stage-labels"><span>种子</span><span>幼苗</span><span>幼树</span><span>成树</span></div>
  </section>
`

const selectedPanel = `
  <section class="selected-panel surface">
    <div class="panel-heading">
      <div><span class="label">地图检查</span><strong id="selected-title">点击一个个体或空地</strong></div>
      <button type="button" class="inline-tool hidden" id="focus-selected-button">定位</button>
    </div>
    <div id="selected-content" class="selected-content empty">
      大白圈包围的是自己的个体；幼苗和幼树可拖动移栽，Shift / ⌘ 可多选。
    </div>
  </section>
`

const chartPanel = `
  <section class="chart-panel surface">
    <div class="panel-heading chart-heading">
      <div><span class="label">动态指标</span><strong id="chart-title">玩家种群走势</strong></div>
      <div class="chart-tabs">
        <button type="button" data-chart="trend" class="active">走势</button>
        <button type="button" data-chart="height">树高分布</button>
        <button type="button" data-chart="selected">选中对象</button>
      </div>
    </div>
    <div id="population-chart" class="population-chart"></div>
  </section>
`

const eventPanel = `
  <section class="event-panel surface">
    <div class="event-status"><span class="event-dot"></span><strong id="event-headline">环境暂时稳定</strong></div>
    <p id="event-message">优势积累会带来专性虫害风险；储备和主动能力提供缓冲。</p>
  </section>
`

const overlays = `
  <div id="hover-tooltip" class="hover-tooltip hidden"></div>
  <aside id="properties-drawer" class="properties-drawer hidden" aria-label="个体属性表">
    <div class="drawer-heading"><div><span class="label">全群落个体</span><h2>属性表</h2></div><button id="close-properties-button" type="button">关闭</button></div>
    <div class="property-filters">
      <input id="property-search" type="search" placeholder="搜索物种或编号" />
      <select id="property-filter"><option value="all">全部个体</option><option value="own">我的物种</option><option value="risk">风险个体</option><option value="canopy">林冠</option><option value="understory">林下</option></select>
      <select id="property-sort"><option value="risk">风险优先</option><option value="height">树高优先</option><option value="health">健康最低</option></select>
    </div>
    <div class="property-table-wrap"><table><thead><tr><th>个体</th><th>阶段</th><th>树高</th><th>健康</th><th>竞争</th><th>风险</th></tr></thead><tbody id="property-table-body"></tbody></table></div>
  </aside>
  <div id="report-modal" class="modal hidden" role="dialog" aria-modal="true">
    <div class="modal-card report-card">
      <div class="eyebrow" id="report-kicker">森林演替结算</div>
      <h2 id="report-title">第 0 年森林演替结算</h2>
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
      <div class="modal-actions">
        <button id="continue-button" type="button">返回森林</button>
        <button id="report-export-button" type="button" class="quiet-button">导出本局数据</button>
        <button id="modal-restart-button" type="button" class="quiet-button">重新开始</button>
      </div>
    </div>
  </div>
`

export function gameLayout(player: Species, scenarioId: ScenarioId): string {
  return `
    <div class="app-shell unified-layout">
      ${header(player, scenarioId)}
      ${allocationPanel}
      <main class="dashboard-grid">
        <div class="dashboard-map-column">${mapPanel}${eventPanel}</div>
        <aside class="dashboard-side">${overviewPanel}${selectedPanel}${chartPanel}</aside>
      </main>
    </div>
    ${overlays}
  `
}

export function setupLayout(
  selectedStrategy: Strategy = 'sun',
  selectedCode = 'LORCHI',
  selectedScenario: ScenarioId = 'closed',
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
    return `<button type="button" class="scenario-card ${selectedScenario === scenarioId ? 'selected' : ''}" data-scenario="${scenarioId}"><span>${scenario.coverHint}</span><strong>${scenario.name}</strong><p>${scenario.description}</p><small>${scenario.populationHint} · ${scenario.lightHint}</small></button>`
  }).join('')
  return `
    <main class="setup-screen">
      <section class="setup-copy">
        <div class="eyebrow">THROWAWAY PLAYABLE PROTOTYPE · V3</div>
        <h1>像森林一样思考</h1>
        <p class="setup-lede">你只控制一个物种。选择森林结构，在光照、竞争、病原菌与虫害之间配置生长、繁殖和储备。</p>
        <div class="setup-rules"><span>森林年</span><span>三种情景</span><span>第 30 年结算</span><span>可持续演替</span></div>
      </section>
      <section class="setup-form surface">
        <div class="step-label">01 · 选择森林情景</div>
        <div class="scenario-grid">${scenarioCards}</div>
        <div class="step-label">02 · 选择风险偏好</div>
        <div class="strategy-grid">${strategyCards}</div>
        <div class="step-label">03 · 选择你控制的真实物种</div>
        <div class="species-grid" id="species-grid">${speciesCards}</div>
        <button type="button" id="start-game" class="primary-button">进入${SCENARIOS[selectedScenario].name}</button>
        <p class="setup-note">玩家个体由大白色圆环高亮；进入地图后由你主动开始演替。</p>
      </section>
    </main>
  `
}
