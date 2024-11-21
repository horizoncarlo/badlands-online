import { chromium } from 'npm:playwright';
import rua from 'https://deno.land/x/rua/mod.js';

let scraperRunning = false;

export function startScraper() {
  if (scraperRunning) {
    return 'Card scraper already running';
  }
  scraperRunning = true;
  scrapeCardData().then(() => {
    console.log('Card scraper done');
  });
  return 'Started card scaper';
}

const scrapeCardData = async () => {
  let browser = null;
  try {
    console.log('Launching browser...');
    browser = await chromium.launch();
    await getCards(browser, 'People');
    await getCards(browser, 'Camp');
  } catch (e) {
    console.error(`Encountered unexpected error: ${e}`);
  } finally {
    await browser?.close();
    scraperRunning = false;
  }
};

const getCards = async (browser, cardType) => {
  const context = await browser.newContext({ userAgent: rua() });
  const baseUrl = 'https://radlands.fandom.com/wiki';
  const peopleUrl = `${baseUrl}/${cardType}_Cards`;
  const page = await context.newPage();
  await page.goto(peopleUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const rows = await page.locator('table.fandom-table tbody tr');
  const rowCount = await rows.count();
  console.log(`Found ${rowCount} ${cardType} cards`);
  const urls = [];
  for (let i = 0; i < rowCount; i++) {
    const firstTd = rows.nth(i).locator('td:first-child');
    const anchor = firstTd.locator('a');
    const href = await anchor.getAttribute('href');
    urls.push(baseUrl.replace('/wiki', href));
  }
  context.close();
  await downloadCardImgs(browser, cardType, urls);
};

const downloadCardImgs = async (browser, cardType, urls) => {
  console.log(`Downloading ${cardType} images...`);
  const context = await browser.newContext({ userAgent: rua() });
  const pagePromises = urls.map(async (url) => {
    const page = await context.newPage();
    return page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).then(() => page);
  });
  const pages = await Promise.all(pagePromises);
  const imgSrcMatch = `${cardType}_-_`;
  for (const page of pages) {
    const img = await page.locator(`img[src*="${imgSrcMatch}"]`);
    let imgSrc = await img.first().getAttribute('src');
    imgSrc = imgSrc.split('.png')[0] + '.png';
    console.log(`Downloading ${cardType} img ${imgSrc}...`);
    const response = await fetch(imgSrc);
    if (response.ok) {
      const imageBuffer = await response.arrayBuffer();
      const nameMatch = imgSrc.match(new RegExp(`${imgSrcMatch}([^/]+)\.png`));
      const name = nameMatch ? nameMatch[1].toLowerCase() : `unknown-${new Date().toISOString()}`;
      const dir = `cards/${cardType === 'Camp' ? 'camps' : cardType.toLowerCase()}`;
      await Deno.mkdir(dir, { recursive: true });
      await Deno.writeFile(`${dir}/${name}.png`, new Uint8Array(imageBuffer));
    } else {
      console.warn(`Failed to fetch image: ${response.statusText}`);
    }
  }
};
