import { SPECIES, STRATEGIES, type Species, type Strategy } from './species'

const header = (player: Species) => `
  <header class="app-header">
    <div>
      <div class="eyebrow">THROWAWAY PROTOTYPE · 密闭林冠情景</div>
      <h1>像森林一样思考</h1>
      <p><strong>${player.name}</strong> · ${STRATEGIES[player.strategy].name}</p>
    </div>
    <div class="header-actions">
      <div class="clock"><span id="game-time">00:00</span><small id="forest-year">第 0.0 年</small></div>
      <button class="quiet-button report-button" id="report-button" type="button">阶段报告</button>
      <button class="quiet-button" id="pause-button" type="button">暂停</button>
      <div class="speed-group" aria-label="演化速度">
        <button type="button" data-speed="1" class="active">1×</button>
        <button type="button" data-speed="2">2×</button>
        <button type="button" data-speed="4">4×</button>
      </div>
      <button class="quiet-button" id="restart-button" type="button">重开</button>
    </div>
  </header>
`

const mapPanel = `
  <section class="map-panel surface">
    <div class="panel-heading map-heading">
      <div><span class="label">林下光照地图</span><strong id="map-summary">密闭林冠正在筛选个体</strong></div>
      <div class="map-guides">
        <span class="transplant-hint">拖动移栽 · Shift / ⌘ 多选</span>
        <div class="legend" aria-label="地图图例">
          <span><i class="legend-own"></i>自己</span>
          <span><i style="--legend:#e9933e"></i>喜阳</span>
          <span><i style="--legend:#627bb6"></i>喜阴</span>
          <span><i style="--legend:#4e9a70"></i>广适</span>
        </div>
      </div>
    </div>
    <div id="game-root" class="game-root"></div>
    <div class="light-scale"><span>低光</span><i></i><span>高光</span></div>
  </section>
`

const allocationPanel = `
  <section class="allocation-panel allocation-dock surface">
    <div class="panel-heading">
      <div><span class="label">你的生命史策略</span><strong id="allocation-impact">等待第一个生态时间步</strong></div>
      <div class="allocation-tools">
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
      <small><span>缓冲低光与扰动</span><b id="reserve-spend">存入 0.0</b></small>
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
      <div><span>成树</span><strong id="population-adults">0</strong></div>
      <div><span>群落占比</span><strong id="population-share">0%</strong></div>
      <div><span>平均光照</span><strong id="average-light">0%</strong></div>
    </div>
    <div class="stage-bar" id="stage-bar"></div>
    <div class="stage-labels"><span>种子</span><span>幼苗</span><span>幼树</span><span>成树</span></div>
  </section>
`

const selectedPanel = `
  <section class="selected-panel surface">
    <div class="panel-heading"><div><span class="label">地图检查</span><strong id="selected-title">点击一个个体或空地</strong></div></div>
    <div id="selected-content" class="selected-content empty">
      点击检查状态；Shift / ⌘ 可多选，自己的幼苗和幼树可拖动移栽。
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
    <p id="event-message">随机事件只改变风险和回报，不提供专用应对按钮。</p>
  </section>
`

const modalsAndTooltip = `
  <div id="hover-tooltip" class="hover-tooltip hidden"></div>
  <div id="report-modal" class="modal hidden" role="dialog" aria-modal="true">
    <div class="modal-card report-card">
      <div class="eyebrow" id="report-kicker">三分钟群落结局检查点</div>
      <h2 id="report-title">群落结局</h2>
      <p id="report-summary"></p>
      <div id="report-chart" class="report-chart"></div>
      <div class="report-columns">
        <section>
          <h3>阶段指标</h3>
          <ul id="report-details"></ul>
        </section>
        <section>
          <h3>最近发生</h3>
          <ol id="report-events"></ol>
        </section>
      </div>
      <div class="modal-actions">
        <button id="continue-button" type="button">继续演化</button>
        <button id="modal-restart-button" type="button" class="quiet-button">重新开始</button>
      </div>
    </div>
  </div>
`

export function gameLayout(player: Species): string {
  return `
    <div class="app-shell unified-layout">
      ${header(player)}
      ${allocationPanel}
      <main class="dashboard-grid">
        <div class="dashboard-map-column">
          ${mapPanel}
          ${eventPanel}
        </div>
        <aside class="dashboard-side">
          ${overviewPanel}
          ${selectedPanel}
          ${chartPanel}
        </aside>
      </main>
    </div>
    ${modalsAndTooltip}
  `
}

export function setupLayout(selectedStrategy: Strategy = 'sun', selectedCode = 'LORCHI'): string {
  const strategyCards = (Object.keys(STRATEGIES) as Strategy[])
    .map((strategy) => {
      const entry = STRATEGIES[strategy]
      return `
        <button type="button" class="strategy-card ${selectedStrategy === strategy ? 'selected' : ''}" data-strategy="${strategy}">
          <i style="--strategy:${entry.css}"></i><strong>${entry.name}</strong><span>${entry.description}</span>
        </button>
      `
    })
    .join('')

  const speciesCards = SPECIES.filter((species) => species.strategy === selectedStrategy)
    .map(
      (species) => `
        <button type="button" class="species-card ${selectedCode === species.code ? 'selected' : ''}" data-species="${species.code}">
          <strong>${species.name}</strong><em>${species.latin}</em><span>最高约 ${species.maxHeight} m · ${species.environment}</span>
        </button>
      `,
    )
    .join('')

  return `
    <main class="setup-screen">
      <section class="setup-copy">
        <div class="eyebrow">THROWAWAY PLAYABLE PROTOTYPE · V2</div>
        <h1>像森林一样思考</h1>
        <p class="setup-lede">你只控制一个物种。光照决定收入，基础维持自动扣除；把剩余碳配置到生长、繁殖和储备，观察你的投资如何改变森林。</p>
        <div class="setup-rules">
          <span>连续演化</span><span>密闭林冠</span><span>3 分钟结算</span><span>可继续</span>
        </div>
      </section>
      <section class="setup-form surface">
        <div class="step-label">01 · 选择风险偏好</div>
        <div class="strategy-grid">${strategyCards}</div>
        <div class="step-label">02 · 选择你控制的真实物种</div>
        <div class="species-grid" id="species-grid">${speciesCards}</div>
        <button type="button" id="start-game" class="primary-button">进入密闭森林</button>
        <p class="setup-note">约 252 个初始个体；其他 5 个物种自动运行。可拖动移栽，或用 Shift / ⌘ 多选观察一组个体。</p>
      </section>
    </main>
  `
}
