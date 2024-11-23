import rua from 'https://deno.land/x/rua/mod.js';
import { Browser, chromium } from 'npm:playwright';

let scraperRunning = false;

export function startScraper() {
  if (scraperRunning) {
    return 'Card scraper already running';
  }
  scraperRunning = true;
  scrapeCardData().then(() => {
    console.log('Card scraper done');
  });
  return 'Started card scraper';
}

const scrapeCardData = async () => {
  let browser = null;
  try {
    console.log('Launching browser...');
    browser = await chromium.launch();
    const baseUrl = 'https://radlands.fandom.com/wiki';
    await getCards(browser, baseUrl, 'People');
    await getCards(browser, baseUrl, 'Camp');
  } catch (e) {
    console.error(`Encountered unexpected error: ${e}`);
  } finally {
    await browser?.close();
    scraperRunning = false;
  }
};

const getCards = async (browser: Browser, baseUrl: string, cardType: string) => {
  const context = await browser.newContext({ userAgent: rua() });
  const cardUrl = `${baseUrl}/${cardType}_Cards`;
  const page = await context.newPage();
  await page.goto(cardUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const rows = page.locator('table.fandom-table tbody tr');
  const rowCount = await rows.count();
  console.log(`Found ${rowCount} ${cardType} cards`);
  const urls = [];
  for (let i = 0; i < rowCount; i++) {
    const anchor = rows.nth(i).locator('td:first-child').locator('a');
    const href = await (anchor.getAttribute('href') as unknown as Promise<string | null>);
    if (href) {
      urls.push(baseUrl.replace('/wiki', href));
    }
  }
  context.close();
  await downloadCardImages(browser, cardType, urls);
};

const downloadCardImages = async (browser: Browser, cardType: string, urls: string[]) => {
  console.log(`Downloading ${cardType} images...`);
  const context = await browser.newContext({ userAgent: rua() });
  const pagePromises = urls.map(async (url) => {
    const page = await context.newPage();
    return page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).then(() => page);
  });
  const pages = await Promise.all(pagePromises);
  const imgSrcMatch = `${cardType}_-_`;
  for (const page of pages) {
    const img = page.locator(`img[src*="${imgSrcMatch}"]`);
    let imgSrc = await (img.first().getAttribute('src') as unknown as Promise<string | null>);
    if (imgSrc) {
      imgSrc = imgSrc.split('.png')[0] + '.png';
      console.log(`Downloading ${cardType} img ${imgSrc}...`);
      const response = await fetch(imgSrc);
      if (response.ok) {
        const imageBuffer = await response.arrayBuffer();
        const nameMatch = imgSrc.match(new RegExp(`${imgSrcMatch}([^/]+)\.png`));
        const name = nameMatch ? nameMatch[1].toLowerCase() : `unknown-${new Date().toISOString()}`;
        const dir = `images/cards/${cardType === 'Camp' ? 'camps' : cardType.toLowerCase()}`;
        await Deno.mkdir(dir, { recursive: true });
        await Deno.writeFile(`${dir}/${name}.png`, new Uint8Array(imageBuffer));
      } else {
        console.warn(`Failed to fetch image: ${response.statusText}`);
      }
    }
  }
};
