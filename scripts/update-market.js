
 * Günlük Piyasa verisi üretici.
 * GitHub Actions veya yerelde: node scripts/update-market.js
 *
 * Kaynaklar:
 * - Gram Altın: https://www.zulfumehmet.com/api/piyasa.json
 * - Gram Gümüş: https://doviz-api.onrender.com/api/gumus
 */

const fs = require('fs');
const path = require('path');

const GOLD_URL = 'https://www.zulfumehmet.com/api/piyasa.json';
const SILVER_URL = 'https://doviz-api.onrender.com/api/gumus';
const OUT_PATH = path.join(__dirname, '..', 'data', 'market.json');
const FETCH_TIMEOUT_MS = 25000;

const EMPTY_MARKET = {
  gold: { buyTRY: null, sellTRY: null },
  silver: { buyTRY: null, sellTRY: null },
  updatedAt: null,
  source: 'auto',
  status: 'empty',
};

/** TR sayı formatını (6.307,25 / 134.752,00 / 6307.25) güvenli number'a çevirir. */
function parseTRNumber(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return Math.round(raw * 100) / 100;
  if (typeof raw !== 'string') return null;

  let s = raw.trim().replace(/\s/g, '');
  if (!s) return null;

  // Para birimi / yüzde gibi ekleri temizle
  s = s.replace(/[^\d.,-]/g, '');
  if (!s) return null;

  // Türkçe: binlik nokta + ondalık virgül (ör. 6.307,25 veya 134,75)
  if (s.includes(',')) {
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

/** Gram gümüş için makul TRY aralığı; Doviz-API bazen 1000× büyük TR formatı döner. */
function normalizeSilverGramTRY(n) {
  if (n == null) return null;
  if (n > 500) return Math.round((n / 1000) * 100) / 100;
  return n;
}

/** Doviz-API: GumusGramSpot = gram gümüş (öncelikli). */
function parseSilver(payload) {
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  const item = data?.GumusGramSpot || data?.GumusGram || data?.gumusGram || data?.gumusgram;
  if (!item || typeof item !== 'object') return { buyTRY: null, sellTRY: null };

  return {
    buyTRY: normalizeSilverGramTRY(parseTRNumber(readField(item, ['Alis', 'alis', 'buy', 'buying']))),
    sellTRY: normalizeSilverGramTRY(parseTRNumber(readField(item, ['Satis', 'satis', 'sell', 'selling']))),
  };
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
  let silver = { buyTRY: null, sellTRY: null };
  let hadError = false;

  try {
    const goldPayload = await fetchJson(GOLD_URL);
    gold = parseGold(goldPayload);
  } catch (err) {
    hadError = true;
    console.error('Altın kaynağı hatası:', err.message);
    if (existing?.gold) gold = existing.gold;
  }

  try {
    const silverPayload = await fetchJson(SILVER_URL);
    silver = parseSilver(silverPayload);
  } catch (err) {
    hadError = true;
    console.error('Gümüş kaynağı hatası:', err.message);
    if (existing?.silver) silver = existing.silver;
  }

  const status = resolveStatus(gold, silver);
  const market = {
    gold,
    silver,
    updatedAt: status === 'empty' ? (existing?.updatedAt ?? null) : new Date().toISOString(),
    source: 'auto',
    status,
  };

  // Tamamen boş ve eski veri varsa eski dosyayı koru
  if (status === 'empty' && existing && (hasMetalPrices(existing.gold) || hasMetalPrices(existing.silver))) {
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
