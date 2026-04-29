const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log('BROWSER ERROR:', msg.text());
    }
  });
  
  page.on('pageerror', err => {
    console.log('BROWSER PAGE ERROR:', err.toString());
  });

  await page.goto('http://localhost:5173');
  
  await new Promise(r => setTimeout(r, 3000));
  
  const row = await page.$('.cursor-pointer.group'); // Real stock row
  if (row) {
    console.log('Clicking on row...');
    await row.click();
    await new Promise(r => setTimeout(r, 2000));
    
    const html = await page.evaluate(() => document.body.innerHTML);
    require('fs').writeFileSync('body_dump.html', html);
    console.log('BODY HTML dumped');
  } else {
    console.log('Row not found.');
  }

  await browser.close();
})();