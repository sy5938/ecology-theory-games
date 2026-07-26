# Task Completion Gates

For implementation changes, run from repository root:

1. `npm run test:model` for ecological/model invariants.
2. `npm run build:demo` for strict TypeScript and production bundling.
3. `npm run test:browser` when behavior, layout, map interaction, onboarding, export, or rendered content changes.

Also verify:

- New mechanics use deterministic seeds and regression coverage.
- Domain term changes are reflected in `CONTEXT.md` when they alter project vocabulary/invariants.
- Player-facing feature changes update `prototype-v2/README.md`; release-sized changes update `CHANGELOG.md`.
- High-density work preserves the 10,000-individual performance envelope or documents a measured tradeoff.
- `git status --short --branch` contains only intended changes.
- After Serena memory edits, optionally run `serena memories check` to validate memory references.