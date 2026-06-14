/**
 * Günlük Piyasa verisi üretici.
 * GitHub Actions veya yerelde: node scripts/update-market.js
 *
 * Referans kaynak: Investing.com
 * - Gram Altın (GAU/TRY): https://tr.investing.com/currencies/gau-try
 * - Gram Gümüş (XAGg/TRY): https://tr.investing.com/currencies/xagg-try
 *
 * Sunucu tarafı erişim:
 * 1) Birincil: Investing grafik altyapısı (tvc6.investing.com) — investiny ile aynı uç nokta
 * 2) Yedek: Investing.com sayfa HTML parse (Cloudflare engeli olabilir)
 *
 * Not: Investing.com resmi public API sunmaz; bot trafiği Cloudflare ile 403 dönebilir.
 */

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const OUT_PATH = path.join(__dirname, '..', 'data', 'market.json');
const FETCH_TIMEOUT_MS = 25000;
const MARKET_SOURCE_LABEL = 'Investing.com piyasa verisi';

const INVESTING_INSTRUMENTS = {
  gold: {
    pageUrl: 'https://tr.investing.com/currencies/gau-try',
    searchQuery: 'GAU/TRY',
    minPrice: 500,
    maxPrice: 20000,
  },
  silver: {
    pageUrl: 'https://tr.investing.com/currencies/xagg-try',
    searchQuery: 'XAGg/TRY',
    minPrice: 10,
    maxPrice: 500,
  },
};

const EMPTY_METAL = {
  buyTRY: null,
  sellTRY: null,
  referenceTRY: null,
  label: MARKET_SOURCE_LABEL,
};

const EMPTY_MARKET = {
  gold: { ...EMPTY_METAL },
  silver: { ...EMPTY_METAL },
  updatedAt: null,
  source: 'investing.com',
  status: 'empty',
};

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

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

function isCloudflareBlock(text) {
  return typeof text === 'string' && (text.includes('Just a moment') || text.includes('cf-chl'));
}

function isReasonablePrice(value, minPrice, maxPrice) {
  return typeof value === 'number' && value >= minPrice && value <= maxPrice;
}

function finalizeMetalQuote(raw, limits) {
  const buyTRY = isReasonablePrice(raw.buyTRY, limits.minPrice, limits.maxPrice) ? raw.buyTRY : null;
  const sellTRY = isReasonablePrice(raw.sellTRY, limits.minPrice, limits.maxPrice) ? raw.sellTRY : null;
  const referenceTRY = isReasonablePrice(raw.referenceTRY, limits.minPrice, limits.maxPrice)
    ? raw.referenceTRY
    : null;

  if (buyTRY != null && sellTRY != null && sellTRY > buyTRY) {
    return { buyTRY, sellTRY, referenceTRY: null, label: MARKET_SOURCE_LABEL };
  }

  if (referenceTRY != null) {
    return { buyTRY: null, sellTRY: null, referenceTRY, label: MARKET_SOURCE_LABEL };
  }

  return { ...EMPTY_METAL };
}

function hasMetalData(metal) {
  return (typeof metal?.buyTRY === 'number' && metal.buyTRY > 0)
    || (typeof metal?.sellTRY === 'number' && metal.sellTRY > 0)
    || (typeof metal?.referenceTRY === 'number' && metal.referenceTRY > 0);
}

async function fetchWithTimeout(url, options = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url, headers) {
  const res = await fetchWithTimeout(url, { headers });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (isCloudflareBlock(text)) throw new Error('Cloudflare engeli');
  return text;
}

async function fetchJson(url, headers) {
  const res = await fetchWithTimeout(url, { headers });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (isCloudflareBlock(text)) throw new Error('Cloudflare engeli');
  return JSON.parse(text);
}

function investingPageHeaders(pageUrl) {
  return {
    'User-Agent': BROWSER_UA,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
    Referer: pageUrl,
  };
}

function investingTvcHeaders() {
  return {
    'User-Agent': BROWSER_UA,
    Referer: 'https://tvc-invdn-com.investing.com/',
    Accept: 'application/json,text/plain,*/*',
    'Content-Type': 'application/json',
  };
}

function investingTvcUrl(endpoint) {
  return `https://tvc6.investing.com/${randomUUID().replace(/-/g, '')}/0/0/0/0/${endpoint}`;
}

async function investingTvcRequest(endpoint, params) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value != null) qs.set(key, String(value));
  });
  const url = `${investingTvcUrl(endpoint)}?${qs.toString()}`;
  const data = await fetchJson(url, investingTvcHeaders());
  if (endpoint === 'search') {
    if (!Array.isArray(data)) throw new Error('Arama yanıtı geçersiz');
    return data;
  }
  if (!data || data.s !== 'ok') throw new Error(`tvc6 ${endpoint} başarısız`);
  return data;
}

function normalizeSearchKey(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, '');
}

async function resolveInvestingPairId(searchQuery) {
  const results = await investingTvcRequest('search', {
    query: searchQuery,
    limit: 10,
    type: 'FX',
    exchange: '',
  });

  const target = normalizeSearchKey(searchQuery);
  const hit = results.find((row) => normalizeSearchKey(row.symbol) === target)
    || results.find((row) => normalizeSearchKey(row.description).includes(normalizeSearchKey(searchQuery)))
    || results[0];

  const pairId = Number.parseInt(hit?.ticker, 10);
  return Number.isFinite(pairId) && pairId > 0 ? pairId : null;
}

function parseTvcQuotes(payload, limits) {
  const row = Array.isArray(payload?.d)
    ? payload.d.find((item) => item?.s === 'ok' && item?.v) || payload.d[0]
    : null;
  const values = row?.v;
  if (!values || typeof values !== 'object') return { ...EMPTY_METAL };

  return finalizeMetalQuote({
    buyTRY: parseTRNumber(values.bid),
    sellTRY: parseTRNumber(values.ask),
    referenceTRY: parseTRNumber(values.lp ?? values.last ?? values.close ?? values.prev_close_price),
  }, limits);
}

function parseInvestingHtmlQuote(html, limits) {
  if (typeof html !== 'string' || isCloudflareBlock(html)) return { ...EMPTY_METAL };

  let buyTRY = null;
  let sellTRY = null;
  let referenceTRY = null;

  const bidTest = html.match(/data-test="instrument-price-bid"[^>]*>\s*([^<]+)/i);
  const askTest = html.match(/data-test="instrument-price-ask"[^>]*>\s*([^<]+)/i);
  if (bidTest) buyTRY = parseTRNumber(bidTest[1]);
  if (askTest) sellTRY = parseTRNumber(askTest[1]);

  const faqTr = html.match(/için alış fiyatı\s*([\d.,]+)\s*ve satış fiyatı:\s*([\d.,]+)/i);
  if (faqTr) {
    buyTRY = buyTRY ?? parseTRNumber(faqTr[1]);
    sellTRY = sellTRY ?? parseTRNumber(faqTr[2]);
  }

  const faqEn = html.match(/bid price is\s*([\d.,]+)\s*and the ask price is\s*([\d.,]+)/i);
  if (faqEn) {
    buyTRY = buyTRY ?? parseTRNumber(faqEn[1]);
    sellTRY = sellTRY ?? parseTRNumber(faqEn[2]);
  }

  const bidAskLine = html.match(/Bid\/Ask:\s*([\d.,]+)\s*\/\s*([\d.,]+)/i);
  if (bidAskLine) {
    buyTRY = buyTRY ?? parseTRNumber(bidAskLine[1]);
    sellTRY = sellTRY ?? parseTRNumber(bidAskLine[2]);
  }

  const lastTest = html.match(/data-test="instrument-price-last"[^>]*>\s*([^<]+)/i);
  if (lastTest) referenceTRY = parseTRNumber(lastTest[1]);

  const faqLastTr = html.match(/kuru şu anda\s*([\d.,]+)\s*seviyesinden/i);
  if (faqLastTr) referenceTRY = referenceTRY ?? parseTRNumber(faqLastTr[1]);

  const faqLastEn = html.match(/exchange rate is\s*([\d.,]+),/i);
  if (faqLastEn) referenceTRY = referenceTRY ?? parseTRNumber(faqLastEn[1]);

  const jsonBidAsk = html.match(/"bid"\s*:\s*([\d.]+)[\s\S]{0,120}?"ask"\s*:\s*([\d.]+)/i);
  if (jsonBidAsk) {
    buyTRY = buyTRY ?? parseTRNumber(jsonBidAsk[1]);
    sellTRY = sellTRY ?? parseTRNumber(jsonBidAsk[2]);
  }

  return finalizeMetalQuote({ buyTRY, sellTRY, referenceTRY }, limits);
}

async function fetchInvestingMetal(key, config) {
  let quote = { ...EMPTY_METAL };
  let lastError = null;

  try {
    const pairId = await resolveInvestingPairId(config.searchQuery);
    if (pairId) {
      const payload = await investingTvcRequest('quotes', { symbols: String(pairId) });
      const parsed = parseTvcQuotes(payload, config);
      if (hasMetalData(parsed)) return parsed;
      lastError = new Error('tvc6 quotes boş döndü');
    }
  } catch (err) {
    lastError = err;
    console.error(`${key} tvc6 hatası:`, err.message);
  }

  try {
    const html = await fetchText(config.pageUrl, investingPageHeaders(config.pageUrl));
    const parsed = parseInvestingHtmlQuote(html, config);
    if (hasMetalData(parsed)) return parsed;
    lastError = new Error('HTML parse sonucu boş');
  } catch (err) {
    lastError = err;
    console.error(`${key} HTML hatası:`, err.message);
  }

  if (lastError) console.error(`${key} için Investing verisi alınamadı.`);
  return quote;
}

function resolveStatus(gold, silver) {
  const g = hasMetalData(gold);
  const s = hasMetalData(silver);
  if (g && s) return 'ok';
  if (g || s) return 'partial';
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

async function main() {
  const existing = readExistingMarket();
  let hadError = false;

  const gold = await fetchInvestingMetal('gold', INVESTING_INSTRUMENTS.gold);
  if (!hasMetalData(gold)) hadError = true;

  const silver = await fetchInvestingMetal('silver', INVESTING_INSTRUMENTS.silver);
  if (!hasMetalData(silver)) hadError = true;

  const status = resolveStatus(gold, silver);
  const market = {
    gold,
    silver,
    updatedAt: status === 'empty' ? (existing?.updatedAt ?? null) : new Date().toISOString(),
    source: 'investing.com',
    status,
  };

  if (status === 'empty' && existing && (hasMetalData(existing.gold) || hasMetalData(existing.silver))) {
    console.log('Yeni veri alınamadı; mevcut market.json korundu.');
    process.exit(hadError ? 1 : 0);
  }

  if (status !== 'empty') {
    market.updatedAt = new Date().toISOString();
  }

  writeMarket(market);
  console.log(`market.json güncellendi (status: ${market.status}, kaynak: Investing.com).`);
  if (hadError && status === 'empty') process.exit(1);
}

main().catch((err) => {
  console.error('Beklenmeyen hata:', err.message);
  const existing = readExistingMarket();
  if (existing) {
    console.log('Mevcut market.json korundu.');
    process.exit(1);
  }
  writeMarket({ ...EMPTY_MARKET });
  process.exit(1);
});
