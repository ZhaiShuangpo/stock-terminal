const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));
  page.on('pageerror', err => console.error('BROWSER ERROR:', err.toString()));
  
  await page.goto('http://localhost:5173');
  
  // Wait for loading and symbols
  await new Promise(r => setTimeout(r, 2000));
  
  // Click first stock
  const stocks = await page.$$('.cursor-pointer');
  if (stocks.length > 0) {
    await stocks[0].click();
    console.log("Clicked stock");
  }
  
  await new Promise(r => setTimeout(r, 1000));
  
  // Click "日线" button (Day line)
  const buttons = await page.$$('button');
  for (let btn of buttons) {
    const text = await page.evaluate(el => el.textContent, btn);
    if (text === '日线') {
      await btn.click();
      console.log("Clicked 日线");
      break;
    }
  }
  
  await new Promise(r => setTimeout(r, 2000));
  await browser.close();
})();
