# V4 Species & Disturbance Slice (2026-07-26)

- Local plan and data-method record: `docs/ecology-data-and-v4-plan-2026-07-26.md`.
- Machine-readable source catalog: `data/database_catalog.csv`.
- Twelve-species calibrated profile registry: `data/species_profiles_v4.csv`. Values are dimensionless game calibration coefficients, not claimed empirical measurements; confidence and provenance are player-visible/exported.
- `prototype-v2/src/species.ts` now loads `SpeciesProfile`: light compensation/saturation, assimilation, growth, low-light survival, seed mass/output, dispersal, establishment, wood density, wind resistance, recovery, herbivory defense, crown scale, maturity fraction, archetype, strength/tradeoff, confidence/provenance.
- Simulation now separates photosynthetic response from low-light health, uses profile-driven growth/maintenance/reproduction/dispersal/establishment/maturity/crown, removes the shade strategy's blanket competition/pathogen/senescence multiplier, and supports a low-light seedling bank plus gap release.
- Typhoon warnings include intensity and heading. A corridor is visualized and produces defoliation, branch loss, stem snapping, and uprooting; persistent damage reduces productivity and recovers by species recovery plus allocation.
- Herbivory has chronic background pressure, host share/clustering risk accumulation, warning, and four-year outbreak pressure. It reduces carbon and reproduction before limited severe mortality.
- Existing scenarios now have mission cards, target-year scoring, and same-seed retry. Setup species cards show archetype, strength, tradeoff, and confidence.
- V4.1 adds a prediction → five-year commitment → forced causal review → next commitment loop. Warning windows allow costly early replanning; normal strategy changes stay locked for five years.
- Closed-forest mission progress no longer advances with time: half comes from a viable juvenile bank and half from five recorded gap-release saplings.
- Cycle reviews record prediction verdicts, a main-cause statement, population/gap/risk ledgers, and turning points. Stored carbon integrates annual surplus by elapsed ecological years to prevent first-cycle reserve saturation.
- Export schema is 4.3 and includes `species_profiles.csv`, `strategy_reviews.csv`, mission evaluation, structural damage, and defoliation recovery year.
- Directional 3-seed/30-year balanced-allocation baseline is recorded in the plan. Shade representative MACLEP retains a multi-stage population in closed forest but stays weak in colonization; pioneer SASTZU remains strong in open scenarios.
- Verification at completion: 51 model tests passed, strict production build passed, and 9 Playwright tests passed including the five-year prediction loop and 10,000-individual interaction.
- Three independent playtest agents judged V4.1 a significant gameplay improvement. Post-fix shade-route reserves moved from 28 to 31.7/40.7 after five years instead of reaching the 300 cap.
- Next major work: recruitment and disturbance ledgers, map-locatable gap-release cohorts, same-seed A/B result comparison, and a multi-seed strategy balance matrix before expanding the species roster.
