import { chromium } from '@playwright/test';

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
try {
  const page = await browser.newPage();
  const codecs = await page.evaluate(() => ({
    h264: MediaSource.isTypeSupported('video/mp4; codecs="avc1.42c01f"'),
    aac: MediaSource.isTypeSupported('audio/mp4; codecs="mp4a.40.2"'),
  }));
  console.log(`Browser ${browser.version()}; H.264=${codecs.h264}; AAC=${codecs.aac}`);
  if (!codecs.h264 || !codecs.aac) {
    throw new Error('The media tests require a browser with H.264/AAC support. Set PLAYWRIGHT_CHROMIUM_EXECUTABLE to Google Chrome or Microsoft Edge.');
  }
} finally {
  await browser.close();
}
