import { expect, test } from '@playwright/test'

test('closed forest exposes the V3 map, inspection and reporting interactions', async ({ page }, testInfo) => {
  const browserErrors: string[] = []
  const failedRequests: string[] = []
  page.on('pageerror', (error) => browserErrors.push(error.message))
  page.on('requestfailed', (request) => failedRequests.push(`${request.url()}: ${request.failure()?.errorText}`))

  await page.goto('/')
  await page.waitForTimeout(300)
  expect(browserErrors).toEqual([])
  const setupText = await page.locator('body').innerText()
  expect(setupText, `loaded ${page.url()} (${await page.title()}); failed: ${failedRequests.join(' | ')}`).toContain('像森林一样思考')
  await expect(page.getByText('THROWAWAY PLAYABLE PROTOTYPE · V3')).toBeVisible()
  await expect(page.locator('[data-scenario="closed"]')).toContainText('林冠覆盖 ≥95%')
  await page.locator('#start-game').click()

  await expect(page.locator('#game-root canvas')).toBeVisible()
  await expect(page.locator('#canopy-cover')).toHaveText(/9[5-9]%|100%/)
  await page.waitForTimeout(1_200)
  await expect(page.locator('#game-time')).toHaveText('第 0.0 年')
  await expect(page.locator('#pause-button')).toHaveText('开始演替')
  await page.screenshot({ path: testInfo.outputPath('closed-game.png'), fullPage: true })
  await page.locator('#pause-button').click()
  await expect(page.locator('#pause-button')).toHaveText('暂停')

  await page.locator('#properties-button').click()
  await expect(page.locator('#properties-drawer')).toBeVisible()
  await expect(page.locator('#property-table-body tr')).toHaveCount(360)
  await page.locator('#property-filter').selectOption('own')
  await expect(page.locator('#property-table-body tr')).toHaveCount(60)
  await page.locator('#property-table-body tr').first().click()
  await expect(page.locator('#selected-title')).not.toHaveText('点击一个个体或空地')
  await expect(page.locator('#focus-selected-button')).toBeVisible()

  await page.locator('[data-view-layer="canopy"]').click()
  await expect(page.locator('[data-view-layer="canopy"]')).toHaveClass(/active/)
  await page.locator('[data-view-layer="understory"]').click()
  await expect(page.locator('[data-view-layer="understory"]')).toHaveClass(/active/)
  await page.locator('[data-view-layer="all"]').click()
  await page.locator('#reset-map-button').click()

  const canvas = page.locator('#game-root canvas')
  const box = await canvas.boundingBox()
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.wheel(0, -420)
  }

  await page.locator('#report-button').click()
  await expect(page.locator('#report-modal')).toBeVisible()
  await expect(page.locator('#report-title')).toHaveText(/第 \d+ 年森林演替结算/)
  await expect(page.locator('#report-drivers li')).not.toHaveCount(0)
  await expect(page.locator('#report-strategy li')).toHaveCount(3)
  await page.locator('#continue-button').click()
  await expect(page.locator('#report-modal')).toBeHidden()

  expect(browserErrors).toEqual([])
})

test('sparse setup keeps the promised initial population and cover band', async ({ page }) => {
  const browserErrors: string[] = []
  page.on('pageerror', (error) => browserErrors.push(error.message))
  await page.goto('/')
  await page.waitForTimeout(300)
  expect(browserErrors).toEqual([])
  await page.locator('[data-scenario="sparse"]').click()
  await expect(page.locator('#start-game')).toContainText('进入稀疏森林')
  await page.locator('#start-game').click()
  const coverText = await page.locator('#canopy-cover').innerText()
  const cover = Number.parseInt(coverText, 10)
  expect(cover).toBeGreaterThanOrEqual(15)
  expect(cover).toBeLessThanOrEqual(30)
  await page.locator('#properties-button').click()
  await expect(page.locator('#property-table-body tr')).toHaveCount(108)
})
