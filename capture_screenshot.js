const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:4177/index.html', { waitUntil: 'networkidle0' });
  await page.screenshot({ path: '/workspace/connect_screen_updated.png', fullPage: true });
  
  // Get the helper text
  const helperText = await page.$eval('body', el => el.innerText);
  console.log('PAGE CONTENT:', helperText);
  
  await browser.close();
})();
