import { chromium } from '@playwright/test'
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] })
const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 }, screen: { width: 1920, height: 1080 } })).newPage()
await page.goto('http://localhost/')
const result = await page.evaluate(async () => {
  const run = async (label, constraints) => {
    const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 60, max: 60 } } })
    const t = s.getVideoTracks()[0]
    const source = t.getSettings()
    let error = null
    try { await t.applyConstraints(constraints) } catch (e) { error = e.name + ': ' + e.message }
    await new Promise((r) => setTimeout(r, 500))
    const after = t.getSettings(), c = t.getConstraints()
    t.stop()
    return { label, source: `${source.width}x${source.height}`, after: `${after.width}x${after.height}@${Math.round(after.frameRate)}`, resizeMode: after.resizeMode, minAceito: c.width?.min ?? null, error }
  }
  return [
    await run('exato 1920x1080', { width: { min: 1920, ideal: 1920, max: 1920 }, height: { min: 1080, ideal: 1080, max: 1080 }, frameRate: { ideal: 60, max: 60 } }),
    await run('exato 1280x720', { width: { min: 1280, ideal: 1280, max: 1280 }, height: { min: 720, ideal: 720, max: 720 }, frameRate: { ideal: 60, max: 60 } }),
    await run('antigo (só teto) 1920x1080', { width: { ideal: 1920, max: 1920 }, height: { ideal: 1080, max: 1080 }, frameRate: { ideal: 60, max: 60 } }),
  ]
})
console.table(result)
await browser.close()
