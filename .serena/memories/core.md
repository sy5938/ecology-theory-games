# Project Core

- Browser-based single-player forest succession strategy prototype (“像森林一样思考”); player controls one real species population through growth/reproduction/reserve allocation while system species compete under light, density, pathogens, disturbance, and pest pressure.
- Domain vocabulary and invariants live in `CONTEXT.md`; consult it before naming or changing mechanics.
- Active implementation is `prototype-v2/`; root `prototype/` is an obsolete technical prototype.
- Model authority: `prototype-v2/src/simulation.ts` (`ForestSimulation`) owns individuals, spatial/environment steps, carbon budgets, recruitment/mortality, disturbances, histories, outcomes, and active abilities.
- Species roster and functional strategies: `prototype-v2/src/species.ts`; roster source data is under `data/`.
- UI/orchestration: `prototype-v2/src/main.ts`; Phaser map scene: `prototype-v2/src/forest-scene.ts`; charts use ECharts.
- Supporting domains: competition mapping in `pressure.ts`, aggregation in `community-stats.ts`, export package in `export-data.ts`, WebGL marker layer in `vector-marker-layer.ts`, desktop workspace/layout in `workspace.ts` and `layouts.ts`.
- Simulation is individual- and space-based on a 100 m × 100 m map, 1 m light grid, four life stages, six species per run, and three abstract strategies (sun/shade/broad).
- Key model/product invariants: one player species; real species identity with abstract strategy mechanics; reproduction must flow adult → seed → establishment; reproductive maturity is distinct from 10 m canopy status; coexistence is not the only correct outcome; prior structure/state persists across allocation changes; disturbance warnings change information, not action vocabulary.
- See `mem:tech_stack` for tooling, `mem:conventions` for code/project conventions, `mem:suggested_commands` for workflows, and `mem:task_completion` for completion gates.