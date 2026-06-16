/**
 * Günlük Piyasa verisi üretici.
 * GitHub Actions veya yerelde: node scripts/update-market.js
 *
 * Kaynak: altin.doviz.com kurum sayfaları (gram altın + gram gümüş birlikte)
 * Öncelik: Dünya Katılım → DestekBank → Vakıf Katılım
 */

const fs = require('fs');
const path = require('path');

const OUT_PATH = path.join(__dirname, '..', 'data', 'market.json');
const FETCH_TIMEOUT_MS = 25000;

const INSTITUTIONS = [
  { slug: 'dunya-katilim', label: 'Dünya Katılım referans kuru' },
  { slug: 'destekbank', label: 'DestekBank referans kuru' },
  { slug: 'vakif-katilim', label: 'Vakıf Katılım referans kuru' },
];

const EMPTY_METAL = { buyTRY: null, sellTRY: null, label: null };

const EMPTY_MARKET = {
  gold: { ...EMPTY_METAL },
  silver: { ...EMPTY_METAL },
  updatedAt: null,
  source: 'auto',
  status: 'empty',
};

/** TR sayı formatını (6.307,25 / 101,07 / 6307.25) güvenli number'a çevirir. */
function parseTRNumber(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return Math.round(raw * 100) / 100;
  if (typeof raw !== 'string') return null;

  let s = raw.trim().replace(/\s/g, '');
  if (!s) return null;

  s = s.replace(/[^\d.,-]/g, '');
  if (!s) return null;

  if (s.includes(',')) {
    const head = s.split(',')[0];
    if (/^\d{1,2}\.\d{3}$/.test(head)) {
      const normalized = s.replace(/\./g, '').replace(',', '.');
      const n = Number.parseFloat(normalized);
      return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
    }
    const normalized = s.replace(/\./g, '').replace(',', '.');
    const n = Number.parseFloat(normalized);
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
  }

  const n = Number.parseFloat(s);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

function normText(value) {
  return String(value).toLowerCase()
    .replace(/ı/g, 'i').replace(/ğ/g, 'g').replace(/ü/g, 'u')
    .replace(/ş/g, 's').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function isGoldProduct(name) {
  const key = normText(name);
  return key.includes('gram altin') || key === 'gram altin';
}

function isSilverProduct(name) {
  const key = normText(name);
  return key.includes('gram gumus') || key === 'gram gumus';
}

function isReasonableQuote(kind, buyTRY, sellTRY) {
  if (buyTRY == null || sellTRY == null || sellTRY <= buyTRY) return false;
  if (kind === 'gold') return buyTRY >= 500 && sellTRY <= 25000;
  if (kind === 'silver') return buyTRY >= 10 && sellTRY <= 500;
  const spread = (sellTRY - buyTRY) / buyTRY;
  return spread <= 0.25;
}

async function fetchText(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': 'GraminiBuyut-MarketBot/1.0 (+https://github.com/)',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function extractTableCells(trHtml) {
  return [...trHtml.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
    .map((m) => m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

/** Kurum sayfası: Gram Altın + Gram Gümüş satırlarını birlikte parse eder. */
function parseInstitutionPage(html, label) {
  if (typeof html !== 'string') return null;

  const found = { gold: null, silver: null };
  const trRe = /<tr\b[\s\S]*?<\/tr>/gi;
  let tr;

  while ((tr = trRe.exec(html)) !== null) {
    const cells = extractTableCells(tr[0]);
    if (cells.length < 3) continue;

    const product = cells[0];
    const buyTRY = parseTRNumber(cells[1]);
    const sellTRY = parseTRNumber(cells[2]);

    if (isGoldProduct(product) && isReasonableQuote('gold', buyTRY, sellTRY)) {
      found.gold = { buyTRY, sellTRY };
      continue;
    }

    if (isSilverProduct(product) && isReasonableQuote('silver', buyTRY, sellTRY)) {
      found.silver = { buyTRY, sellTRY };
    }
  }

  if (!found.gold || !found.silver) return null;

  return {
    gold: { buyTRY: found.gold.buyTRY, sellTRY: found.gold.sellTRY, label },
    silver: { buyTRY: found.silver.buyTRY, sellTRY: found.silver.sellTRY, label },
  };
}

function hasMetalPrices(metal) {
  return (typeof metal?.buyTRY === 'number' && metal.buyTRY > 0)
    || (typeof metal?.sellTRY === 'number' && metal.sellTRY > 0);
}

function hasCompletePair(gold, silver) {
  return hasMetalPrices(gold) && hasMetalPrices(silver);
}

function resolveStatus(gold, silver) {
  if (hasCompletePair(gold, silver)) return 'ok';
  if (hasMetalPrices(gold) || hasMetalPrices(silver)) return 'partial';
  return 'empty';
}

function readExistingMarket() {
  try {
    if (!fs.existsSync(OUT_PATH)) return null;
    const parsed = JSON.parse(fs.readFileSync(OUT_PATH, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeMarket(market) {
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, `${JSON.stringify(market, null, 2)}\n`, 'utf8');
}

function metalsEqual(a, b) {
  if (!a || !b) return false;
  return a.buyTRY === b.buyTRY && a.sellTRY === b.sellTRY && a.label === b.label;
}

function preserveExistingAndExit(reason) {
  console.error(`HATA: ${reason}`);
  console.error('Yeni veri alınamadı; mevcut market.json korundu ve updatedAt güncellenmedi.');
  process.exit(1);
}

async function fetchInstitutionQuote(institution) {
  const url = `https://altin.doviz.com/${institution.slug}`;
  const html = await fetchText(url);
  const parsed = parseInstitutionPage(html, institution.label);
  if (!parsed) {
    throw new Error(`${institution.slug}: gram altın/gümüş birlikte parse edilemedi`);
  }
  return parsed;
}

async function fetchMarketFromInstitutions() {
  for (const institution of INSTITUTIONS) {
    try {
      const quote = await fetchInstitutionQuote(institution);
      console.log(`Kaynak seçildi: ${institution.label} (${institution.slug})`);
      return quote;
    } catch (err) {
      console.error(`${institution.slug} hatası:`, err.message);
    }
  }
  return null;
}

async function main() {
  const existing = readExistingMarket();
  const quote = await fetchMarketFromInstitutions();

  if (!quote) {
    if (existing && (hasMetalPrices(existing.gold) || hasMetalPrices(existing.silver))) {
      preserveExistingAndExit('Hiçbir kurumdan gram altın/gümüş fiyatı alınamadı.');
    }

    writeMarket({ ...EMPTY_MARKET, updatedAt: new Date().toISOString() });
    console.log('Hiçbir kurumdan veri alınamadı; market.json boş yazıldı.');
    process.exit(0);
  }

  const { gold, silver } = quote;
  const status = resolveStatus(gold, silver);
  const updatedAt = new Date().toISOString();
  const market = {
    gold,
    silver,
    updatedAt,
    source: 'auto',
    status,
  };

  writeMarket(market);

  const pricesUnchanged = existing
    && metalsEqual(existing.gold, gold)
    && metalsEqual(existing.silver, silver);
  if (pricesUnchanged) {
    console.log(`Fiyatlar değişmedi; updatedAt yine de güncellendi: ${updatedAt}`);
  }
  console.log(`market.json güncellendi (status: ${status}, updatedAt: ${updatedAt}).`);
}

main().catch((err) => {
  console.error('Beklenmeyen hata:', err.message);
  const existing = readExistingMarket();
  if (existing && (hasMetalPrices(existing.gold) || hasMetalPrices(existing.silver))) {
    preserveExistingAndExit(`Beklenmeyen hata: ${err.message}`);
  }
  writeMarket({ ...EMPTY_MARKET, updatedAt: new Date().toISOString() });
  process.exit(1);
});
