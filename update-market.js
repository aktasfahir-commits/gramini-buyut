/**
 * Günlük Piyasa verisi üretici.
 * GitHub Actions veya yerelde: node scripts/update-market.js
 *
 * Kaynaklar:
 * - Gram Altın: https://doviz-api.onrender.com/api/altin (birincil)
 * - Gram Altın yedek: https://www.zulfumehmet.com/api/piyasa.json
 * - Gram Gümüş: https://altin.doviz.com/gumus (banka/kuyumcu alış-satış tablosu)
 */

const fs = require('fs');
const path = require('path');

const GOLD_DOVIZ_URL = 'https://doviz-api.onrender.com/api/altin';
const GOLD_ZULFU_URL = 'https://www.zulfumehmet.com/api/piyasa.json';
const SILVER_DOVIZ_COM_URL = 'https://altin.doviz.com/gumus';
const OUT_PATH = path.join(__dirname, '..', 'data', 'market.json');
const FETCH_TIMEOUT_MS = 25000;

const EMPTY_SILVER = { buyTRY: null, sellTRY: null, label: null };

const EMPTY_MARKET = {
  gold: { buyTRY: null, sellTRY: null },
  silver: { ...EMPTY_SILVER },
  updatedAt: null,
  source: 'auto',
  status: 'empty',
};

const PREFERRED_SILVER_BANKS = [
  { key: 'dunya katilim', label: 'Dünya Katılım gümüş kuru' },
  { key: 'vakif katilim', label: 'Vakıf Katılım gümüş kuru' },
  { key: 'destekbank', label: 'DestekBank gümüş kuru' },
];

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

function readField(obj, keys) {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const key of keys) {
    if (obj[key] != null && obj[key] !== '') return obj[key];
  }
  return undefined;
}

function normBankKey(name) {
  return String(name).toLowerCase()
    .replace(/ı/g, 'i').replace(/ğ/g, 'g').replace(/ü/g, 'u')
    .replace(/ş/g, 's').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function fetchJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: 'text/html,application/xhtml+xml' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/** Doviz-API: Altin = gram altın (serbest piyasa). */
function parseGoldFromDoviz(payload) {
  const item = payload?.data?.Altin;
  if (!item || typeof item !== 'object') return { buyTRY: null, sellTRY: null };

  return {
    buyTRY: parseTRNumber(readField(item, ['Alis', 'alis', 'buy', 'buying'])),
    sellTRY: parseTRNumber(readField(item, ['Satis', 'satis', 'sell', 'selling'])),
  };
}

/** Zülfü Mehmet: ikinci dizi altın ürünleri; giramaltin = gram altın. */
function parseGold(payload) {
  const rows = Array.isArray(payload?.[1]) ? payload[1] : Array.isArray(payload) ? payload : [];
  const item = rows.find((r) => {
    if (!r || typeof r !== 'object') return false;
    const code = String(r.kisaisim || r.code || '').toLowerCase();
    const name = String(r.cinsi || r.name || '').toLowerCase();
    return code === 'giramaltin' || code === 'gramaltin' || name.includes('gram altın') || name.includes('gram altin');
  });

  if (!item) return { buyTRY: null, sellTRY: null };

  return {
    buyTRY: parseTRNumber(readField(item, ['alis', 'Alis', 'buy', 'buying'])),
    sellTRY: parseTRNumber(readField(item, ['satis', 'Satis', 'sell', 'selling'])),
  };
}

function parseDovizComSilverRows(html) {
  const rows = [];
  const trRe = /<tr\b[\s\S]*?<\/tr>/gi;
  let tr;
  while ((tr = trRe.exec(html)) !== null) {
    const block = tr[0];
    if (!block.includes('data-socket-attr="bid"')) continue;

    const bidM = block.match(/data-socket-attr="bid"[^>]*>\s*([^<]+?)\s*</i);
    const askM = block.match(/data-socket-attr="ask"[^>]*>\s*([^<]+?)\s*</i);
    if (!bidM || !askM) continue;

    const buyTRY = parseTRNumber(bidM[1]);
    const sellTRY = parseTRNumber(askM[1]);

    let bankName = '';
    const altM = block.match(/alt="([^"]+?)\s*Gram\s*G[uü]m[uü][şs]/i);
    if (altM) bankName = altM[1].trim();
    if (!bankName) {
      const textM = block.match(/<a\b[^>]*>[\s\S]*?<img\b[^>]*>[\s\S]*?([^<]+?)<\/a>/i);
      if (textM) bankName = textM[1].trim();
    }

    if (!bankName || buyTRY == null || sellTRY == null) continue;
    rows.push({ bankName, buyTRY, sellTRY });
  }
  return rows;
}

function isReasonableSilverQuote(buyTRY, sellTRY) {
  if (buyTRY == null || sellTRY == null) return false;
  if (sellTRY <= buyTRY) return false;
  if (buyTRY < 70 || sellTRY > 250) return false;
  const spread = (sellTRY - buyTRY) / buyTRY;
  return spread <= 0.2;
}

function median(nums) {
  if (!nums.length) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 100) / 100;
}

function trimOutliers(rows) {
  if (rows.length < 4) return rows;
  const buys = rows.map((r) => r.buyTRY).sort((a, b) => a - b);
  const sells = rows.map((r) => r.sellTRY).sort((a, b) => a - b);
  const buyLo = buys[Math.floor(buys.length * 0.1)];
  const buyHi = buys[Math.ceil(buys.length * 0.9) - 1];
  const sellLo = sells[Math.floor(sells.length * 0.1)];
  const sellHi = sells[Math.ceil(sells.length * 0.9) - 1];
  return rows.filter((r) => r.buyTRY >= buyLo && r.buyTRY <= buyHi
    && r.sellTRY >= sellLo && r.sellTRY <= sellHi);
}

/** altin.doviz.com: banka gram gümüş alış/satış tablosu. */
function parseDovizComSilver(html) {
  if (typeof html !== 'string') return { ...EMPTY_SILVER };

  const rows = parseDovizComSilverRows(html).filter((r) => isReasonableSilverQuote(r.buyTRY, r.sellTRY));
  if (!rows.length) return { ...EMPTY_SILVER };

  for (const pref of PREFERRED_SILVER_BANKS) {
    const hit = rows.find((r) => normBankKey(r.bankName).includes(pref.key));
    if (hit) {
      return { buyTRY: hit.buyTRY, sellTRY: hit.sellTRY, label: pref.label };
    }
  }

  const trimmed = trimOutliers(rows);
  const pool = trimmed.length >= 3 ? trimmed : rows;
  const buyTRY = median(pool.map((r) => r.buyTRY));
  const sellTRY = median(pool.map((r) => r.sellTRY));
  if (buyTRY == null || sellTRY == null || !isReasonableSilverQuote(buyTRY, sellTRY)) {
    return { ...EMPTY_SILVER };
  }

  return { buyTRY, sellTRY, label: 'Temsilci banka gümüş kuru' };
}

function hasMetalPrices(metal) {
  return (typeof metal?.buyTRY === 'number' && metal.buyTRY > 0)
    || (typeof metal?.sellTRY === 'number' && metal.sellTRY > 0);
}

function resolveStatus(gold, silver) {
  const g = hasMetalPrices(gold);
  const s = hasMetalPrices(silver);
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
  let gold = { buyTRY: null, sellTRY: null };
  let silver = { ...EMPTY_SILVER };
  let hadError = false;

  try {
    const goldPayload = await fetchJson(GOLD_DOVIZ_URL);
    gold = parseGoldFromDoviz(goldPayload);
    if (!hasMetalPrices(gold)) {
      const fallbackPayload = await fetchJson(GOLD_ZULFU_URL);
      gold = parseGold(fallbackPayload);
    }
  } catch (err) {
    hadError = true;
    console.error('Altın kaynağı hatası:', err.message);
    try {
      const fallbackPayload = await fetchJson(GOLD_ZULFU_URL);
      gold = parseGold(fallbackPayload);
    } catch (fallbackErr) {
      console.error('Altın yedek kaynağı hatası:', fallbackErr.message);
      if (existing?.gold) gold = existing.gold;
    }
  }

  try {
    const html = await fetchText(SILVER_DOVIZ_COM_URL);
    silver = parseDovizComSilver(html);
    if (!hasMetalPrices(silver)) {
      hadError = true;
      console.error('Gümüş parse edilemedi; fiyat boş bırakıldı.');
      silver = { ...EMPTY_SILVER };
    }
  } catch (err) {
    hadError = true;
    console.error('Gümüş kaynağı hatası:', err.message);
    silver = { ...EMPTY_SILVER };
  }

  const status = resolveStatus(gold, silver);
  const market = {
    gold,
    silver,
    updatedAt: status === 'empty' ? (existing?.updatedAt ?? null) : new Date().toISOString(),
    source: 'auto',
    status,
  };

  if (status === 'empty' && existing && hasMetalPrices(existing.gold)) {
    console.log('Yeni veri alınamadı; mevcut market.json korundu.');
    process.exit(hadError ? 1 : 0);
  }

  if (status !== 'empty') {
    market.updatedAt = new Date().toISOString();
  }

  writeMarket(market);
  console.log(`market.json güncellendi (status: ${market.status}).`);
  if (hadError && status !== 'empty') process.exit(0);
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
