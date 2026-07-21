# 像森林一样思考 / Think Like a Forest

> 人的一生，总是在取舍中向前。鱼与熊掌难以兼得：高薪可能以时间、强度与健康为代价；选择此刻的舒适，也可能在未来回望时，遗憾自己没有更早出发。
>
> 森林里的生命亦然。生长、繁殖与储备，每一份投入都意味着放弃另一种可能。现在，试着从森林的尺度思考：是向上争夺阳光，为后代豪赌，还是为未知保留力量？
>
> *To be or not to be*——真正的问题，从来不只是“要不要”，而是你愿意为选择付出什么代价。

## 中文

《像森林一样思考》是一款运行在浏览器中的单人森林演替策略游戏。你只经营一个真实树种，在有限资源下持续权衡生长、繁殖和储备，并面对光照竞争、同种病原菌、极端天气与优势种虫害。

多物种共存和单种占优都可能成为结局。游戏没有唯一正确的策略：每一种获得，都伴随着代价；每一次保守，也意味着放弃另一种可能。

### 在线体验

https://sy5938.github.io/ecology-theory-games/

### 本地运行

```bash
npm install
npm run demo
```

根据终端提示打开本地地址。停止游戏时，在终端按 `Ctrl+C`。

### 验证与构建

```bash
npm run test:model
npm run test:browser
npm run build:demo
```

项目使用 Vite、TypeScript、Phaser 和 ECharts。推送到 GitHub 的 `master` 分支后，GitHub Actions 会自动构建并发布到 GitHub Pages。

---

## English

Life moves forward through trade-offs. We cannot have everything at once. A high salary may cost us time, intensity, and health; choosing comfort today may leave us wondering tomorrow why we did not begin sooner.

Life in a forest is no different. Every investment in growth, reproduction, or reserves closes off another possibility. This game asks you to think at the scale of a forest: reach upward for light, gamble on the next generation, or save strength for the unknown?

*To be or not to be*—the real question is rarely whether to choose, but what price you are willing to pay for that choice.

### About

**Think Like a Forest** is a single-player forest succession strategy game that runs in the browser. You manage one real tree species, continually allocating limited resources among growth, reproduction, and reserves while confronting competition for light, host-specific pathogens, extreme weather, and pest outbreaks targeting dominant species.

Coexistence and single-species dominance are both possible outcomes. There is no single correct strategy: every gain carries a cost, and every cautious choice leaves another path unexplored.

### Play online

https://sy5938.github.io/ecology-theory-games/

### Run locally

```bash
npm install
npm run demo
```

Open the local URL shown in the terminal. Press `Ctrl+C` in the terminal to stop the development server.

### Test and build

```bash
npm run test:model
npm run test:browser
npm run build:demo
```

The project uses Vite, TypeScript, Phaser, and ECharts. Every push to the GitHub `master` branch triggers a GitHub Actions workflow that builds the game and deploys it to GitHub Pages.
