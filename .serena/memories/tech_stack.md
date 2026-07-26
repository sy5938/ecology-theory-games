# Tech Stack

- TypeScript 5.9, strict mode, ES2022/ES modules; browser-only Vite application.
- Vite 8 serves/builds `prototype-v2/`; deployment base is `/ecology-theory-games/`.
- Phaser 3.90 renders the interactive forest map; custom procedural WebGL marker batching handles dense populations.
- ECharts 6 renders statistics/report charts.
- fflate produces downloadable ZIP simulation data.
- Vitest 4.1 runs model/unit tests; Playwright 1.61 runs browser tests against local Chrome.
- npm with committed `package-lock.json`; root `package.json` is the command authority.
- GitHub Pages deploys from `master` via GitHub Actions.