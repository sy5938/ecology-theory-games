# Conventions

- `CONTEXT.md` is the canonical domain glossary; preserve its distinctions (e.g. reproductive maturity vs canopy, dispersal radius vs self-thinning neighborhood, stage transition vs continuous structural growth).
- TypeScript uses strict typing, semicolon-free formatting, single quotes, two-space indentation, named exports, and explicit domain unions/interfaces.
- Simulation state and rules belong in `ForestSimulation`; renderer/UI should observe the model rather than duplicate ecological rules.
- Deterministic simulations use seeded randomness; model tests should pin seeds and assert invariants/statistical direction, not brittle exact UI snapshots.
- Separate ecological process layers: stage transition, continuous height/DBH growth, spatial light/competition/pathogen pressure, carbon budget, disturbance/event logic, aggregation/export.
- Keep player control population-level and bounded: allocation/abilities plus one-time transplant of eligible player juveniles; no direct per-tree growth/death/reproduction commands.
- Real species names provide identity, while strategy-level shared behavior must remain scientifically explainable. Add species-specific differentiation as data/parameters before branching UI logic.
- Maintain performance assumptions up to 10,000 individuals: spatial indexing, light-grid caching, batched markers, throttled non-critical statistics.
- UI copy is primarily Simplified Chinese; code identifiers are English ecological/product terms.
- Do not treat root `prototype/` as the production base; current work targets `prototype-v2/`.