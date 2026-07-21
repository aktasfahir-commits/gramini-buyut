/**
 * Günlük Piyasa verisi üretici.
 * GitHub Actions veya yerelde: node --use-system-ca scripts/update-market.js
 *
 * Kaynaklar (altin.doviz.com):
 * - Katılım: Dünya Katılım → DestekBank → Vakıf Katılım kurum sayfaları
 * - Serbest Piyasa: ana sayfa Serbest Piyasa tablosu (yalnızca exact "Gram Altın" / "Gram Gümüş")
 *
 * Güvenlik:
 * - Fiyat doğrulama (number, >0, aralık, alış < satış)
 * - Önceki değere göre aşırı sıçrama → overwrite yok, eski geçerli veri korunur
 * - Atomik yazım (tmp + rename); yarım JSON yazılmaz
 *
 * TODO: Resmi KTB / lisanslı serbest piyasa API erişimi sağlanınca
 *       FREE_MARKET_URL yerine o uç noktaya geç.
 *
 * market.json v1.3: per-source lastSuccessAt + dataStatus (live|stale|unavailable)
 */

const fs = require('fs');
const path = require('path');

const OUT_PATH = path.join(__dirname, '..', 'data', 'market.json');
const OUT_TMP_PATH = `${OUT_PATH}.tmp`;
const FETCH_TIMEOUT_MS = 25000;

/**
 * Olağan dışı sıçrama eşiği (%).
 * Günlük TRY gram altın/gümüş için ~%20 üzeri hareket şüpheli scrape/HTML hatası sayılır.
 * Önceki geçerli satış yoksa (ilk kurulum) bu kontrol atlanır.
 */
const MAX_JUMP_PERCENT = 20;

/** Kaynak lastSuccessAt bu süreden eskiyse dataStatus = stale (ms). 6 saat. */
const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

const PRICE_BOUNDS = {
  gold: { minBuy: 500, maxSell: 25000 },
  silver: { minBuy: 10, maxSell: 500 },
};

const INSTITUTIONS = [
  { slug: 'dunya-katilim', label: 'Dünya Katılım referans kuru' },
  { slug: 'destekbank', label: 'DestekBank referans kuru' },
  { slug: 'vakif-katilim', label: 'Vakıf Katılım referans kuru' },
];

const FREE_MARKET_URL = 'https://altin.doviz.com/';
const FREE_MARKET_LABEL = 'Serbest Piyasa referansı';

const EMPTY_SOURCE_METAL = { buy: null, sell: null, changePercent: null };

function emptySourceBlock(label) {
  return {
    label,
    sourceName: null,
    lastSuccessAt: null,
    dataStatus: 'unavailable',
    gold: { ...EMPTY_SOURCE_METAL },
    silver: { ...EMPTY_SOURCE_METAL },
  };
}

const EMPTY_MARKET = {
  updatedAt: null,
  source: 'auto',
  status: 'empty',
  sources: {
    participation: emptySourceBlock('Katılım'),
    freeMarket: emptySourceBlock('Serbest Piyasa'),
  },
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

/** Yalnızca exact "Gram Altın" — "Gram Has Altın", çeyrek vb. eşleşmez. */
function isExactGramGold(name) {
  return normText(name) === 'gram altin';
}

/** Yalnızca exact "Gram Gümüş". */
function isExactGramSilver(name) {
  return normText(name) === 'gram gumus';
}

function isValidPriceNumber(n) {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

/**
 * Tek metal çifti doğrulama:
 * - number, >0, NaN/null/0 yok
 * - negatif yok
 * - mantıklı aralık
 * - satış > alış (ters sıra reddedilir)
 */
function validateQuotePair(kind, buyTRY, sellTRY) {
  if (!isValidPriceNumber(buyTRY) || !isValidPriceNumber(sellTRY)) {
    return { ok: false, reason: `${kind}: buy/sell number ve >0 olmalı` };
  }
  if (buyTRY < 0 || sellTRY < 0) {
    return { ok: false, reason: `${kind}: negatif fiyat` };
  }
  if (sellTRY <= buyTRY) {
    return { ok: false, reason: `${kind}: satış ≤ alış (ters sıra)` };
  }
  const bounds = PRICE_BOUNDS[kind];
  if (!bounds) return { ok: false, reason: `${kind}: bilinmeyen metal` };
  if (buyTRY < bounds.minBuy || sellTRY > bounds.maxSell) {
    return { ok: false, reason: `${kind}: aralık dışı (${buyTRY}/${sellTRY})` };
  }
  const spread = (sellTRY - buyTRY) / buyTRY;
  if (spread > 0.25) {
    return { ok: false, reason: `${kind}: spread çok geniş (%${(spread * 100).toFixed(1)})` };
  }
  return { ok: true };
}

/**
 * Önceki geçerli satışa göre aşırı sıçrama kontrolü.
 * Eşik: MAX_JUMP_PERCENT. Aşılırsa overwrite yok.
 */
function isJumpTooLarge(previousSell, nextSell) {
  if (!isValidPriceNumber(previousSell) || !isValidPriceNumber(nextSell)) return false;
  const pct = Math.abs((nextSell - previousSell) / previousSell) * 100;
  return pct > MAX_JUMP_PERCENT;
}

function validateIncomingQuote(quote, previousSource, sourceKey) {
  if (!quote?.gold || !quote?.silver) {
    return { ok: false, reason: `${sourceKey}: gold/silver eksik` };
  }

  const buyG = quote.gold.buyTRY ?? quote.gold.buy;
  const sellG = quote.gold.sellTRY ?? quote.gold.sell;
  const buyS = quote.silver.buyTRY ?? quote.silver.buy;
  const sellS = quote.silver.sellTRY ?? quote.silver.sell;

  const goldCheck = validateQuotePair('gold', buyG, sellG);
  if (!goldCheck.ok) return goldCheck;
  const silverCheck = validateQuotePair('silver', buyS, sellS);
  if (!silverCheck.ok) return silverCheck;

  const prevGoldSell = previousSource?.gold?.sell;
  const prevSilverSell = previousSource?.silver?.sell;
  if (isJumpTooLarge(prevGoldSell, sellG)) {
    return {
      ok: false,
      reason: `${sourceKey}: altın satış sıçraması >%${MAX_JUMP_PERCENT} (${prevGoldSell} → ${sellG})`,
    };
  }
  if (isJumpTooLarge(prevSilverSell, sellS)) {
    return {
      ok: false,
      reason: `${sourceKey}: gümüş satış sıçraması >%${MAX_JUMP_PERCENT} (${prevSilverSell} → ${sellS})`,
    };
  }

  return {
    ok: true,
    gold: { buyTRY: buyG, sellTRY: sellG },
    silver: { buyTRY: buyS, sellTRY: sellS },
  };
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

function parseRowsFromHtml(html) {
  const rows = [];
  const trRe = /<tr\b[\s\S]*?<\/tr>/gi;
  let tr;
  while ((tr = trRe.exec(html)) !== null) {
    const cells = extractTableCells(tr[0]);
    if (cells.length < 3) continue;
    rows.push({ product: cells[0], buyRaw: cells[1], sellRaw: cells[2] });
  }
  return rows;
}

/**
 * Exact gram altın + gram gümüş satırlarını birlikte bulur.
 * Belirsiz / birden fazla exact eşleşme → hata (sessiz yanlış fiyat yok).
 */
function pickExactGramPair(rows, label) {
  const goldHits = [];
  const silverHits = [];

  for (const row of rows) {
    const buyTRY = parseTRNumber(row.buyRaw);
    const sellTRY = parseTRNumber(row.sellRaw);
    if (isExactGramGold(row.product)) {
      goldHits.push({ product: row.product, buyTRY, sellTRY });
    }
    if (isExactGramSilver(row.product)) {
      silverHits.push({ product: row.product, buyTRY, sellTRY });
    }
  }

  if (goldHits.length === 0) throw new Error(`${label}: exact "Gram Altın" satırı yok`);
  if (silverHits.length === 0) throw new Error(`${label}: exact "Gram Gümüş" satırı yok`);
  if (goldHits.length > 1) throw new Error(`${label}: birden fazla "Gram Altın" satırı (${goldHits.length})`);
  if (silverHits.length > 1) throw new Error(`${label}: birden fazla "Gram Gümüş" satırı (${silverHits.length})`);

  const gold = goldHits[0];
  const silver = silverHits[0];
  const gCheck = validateQuotePair('gold', gold.buyTRY, gold.sellTRY);
  if (!gCheck.ok) throw new Error(`${label}: ${gCheck.reason}`);
  const sCheck = validateQuotePair('silver', silver.buyTRY, silver.sellTRY);
  if (!sCheck.ok) throw new Error(`${label}: ${sCheck.reason}`);

  return {
    gold: { buyTRY: gold.buyTRY, sellTRY: gold.sellTRY, label },
    silver: { buyTRY: silver.buyTRY, sellTRY: silver.sellTRY, label },
  };
}

/** Kurum sayfası: tüm tablolarda exact gram satırları. */
function parseInstitutionPage(html, label) {
  if (typeof html !== 'string' || !html.trim()) {
    throw new Error(`${label}: boş HTML`);
  }
  return pickExactGramPair(parseRowsFromHtml(html), label);
}

/**
 * Serbest Piyasa: mümkünse "Serbest Piyasa" başlığından sonraki bloktan oku.
 * Başlık yoksa / blok yetersizse hata ver — başka sekmelerin fiyatını alma.
 */
function parseFreeMarketPage(html, label) {
  if (typeof html !== 'string' || !html.trim()) {
    throw new Error(`${label}: boş HTML`);
  }

  const marker = /Serbest\s*Piyasa/i.exec(html);
  if (!marker) {
    throw new Error(`${label}: "Serbest Piyasa" başlığı bulunamadı`);
  }

  // Başlıktan sonraki ~80KB'lık dilimde ara (sonraki kurum sekmelerine taşmayı sınırla)
  const slice = html.slice(marker.index, marker.index + 80000);
  return pickExactGramPair(parseRowsFromHtml(slice), label);
}

function normalizeMetalPrice(metal) {
  const buy = typeof metal?.buy === 'number' ? metal.buy : metal?.buyTRY;
  const sell = typeof metal?.sell === 'number' ? metal.sell : metal?.sellTRY;
  return {
    buy: isValidPriceNumber(buy) ? buy : null,
    sell: isValidPriceNumber(sell) ? sell : null,
  };
}

function hasMetalPrices(metal) {
  const { buy, sell } = normalizeMetalPrice(metal);
  return buy != null || sell != null;
}

function hasCompletePair(gold, silver) {
  const g = normalizeMetalPrice(gold);
  const s = normalizeMetalPrice(silver);
  return g.buy != null && g.sell != null && s.buy != null && s.sell != null;
}

function computeChangePercent(currentSell, previousSell) {
  if (!isValidPriceNumber(currentSell) || !isValidPriceNumber(previousSell)) return null;
  return Math.round(((currentSell - previousSell) / previousSell) * 10000) / 100;
}

function quoteToSourceMetal(metal, previousMetal) {
  const buy = metal?.buyTRY ?? metal?.buy ?? null;
  const sell = metal?.sellTRY ?? metal?.sell ?? null;
  const prevSell = previousMetal?.sell ?? previousMetal?.sellTRY ?? null;
  return {
    buy: isValidPriceNumber(buy) ? buy : null,
    sell: isValidPriceNumber(sell) ? sell : null,
    changePercent: computeChangePercent(
      isValidPriceNumber(sell) ? sell : null,
      isValidPriceNumber(prevSell) ? prevSell : null
    ),
  };
}

function resolveDataStatus(sourceBlock, nowMs) {
  if (!hasCompletePair(sourceBlock?.gold, sourceBlock?.silver)) return 'unavailable';
  const last = sourceBlock?.lastSuccessAt;
  if (typeof last !== 'string') return 'stale';
  const t = Date.parse(last);
  if (Number.isNaN(t)) return 'stale';
  if (nowMs - t > STALE_AFTER_MS) return 'stale';
  return 'live';
}

function normalizeExistingSource(raw, fallbackLabel) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const gold = quoteToSourceMetal(src.gold);
  const silver = quoteToSourceMetal(src.silver);
  const block = {
    label: typeof src.label === 'string' && src.label.trim() ? src.label.trim() : fallbackLabel,
    sourceName: typeof src.sourceName === 'string' && src.sourceName.trim()
      ? src.sourceName.trim()
      : (typeof src.gold?.label === 'string' ? src.gold.label : null),
    lastSuccessAt: typeof src.lastSuccessAt === 'string' ? src.lastSuccessAt : null,
    dataStatus: 'unavailable',
    gold,
    silver,
  };
  // Eski şemada lastSuccessAt yoksa updatedAt dosya düzeyinden sonradan basılır
  block.dataStatus = resolveDataStatus(block, Date.now());
  return block;
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

function getParticipationFromExisting(existing) {
  if (existing?.sources?.participation) {
    return normalizeExistingSource(existing.sources.participation, 'Katılım');
  }
  if (existing?.gold || existing?.silver) {
    return normalizeExistingSource({
      label: 'Katılım',
      gold: existing.gold,
      silver: existing.silver,
      lastSuccessAt: existing.updatedAt || null,
    }, 'Katılım');
  }
  return emptySourceBlock('Katılım');
}

function getFreeMarketFromExisting(existing) {
  if (existing?.sources?.freeMarket) {
    const block = normalizeExistingSource(existing.sources.freeMarket, 'Serbest Piyasa');
    // Eski dosyalarda lastSuccessAt yokken fiyat varsa, dosya updatedAt'ini kullan
    if (!block.lastSuccessAt && hasCompletePair(block.gold, block.silver) && typeof existing.updatedAt === 'string') {
      block.lastSuccessAt = existing.updatedAt;
      block.dataStatus = resolveDataStatus(block, Date.now());
    }
    return block;
  }
  return emptySourceBlock('Serbest Piyasa');
}

function existingHasAnyPrices(existing) {
  if (!existing) return false;
  const p = getParticipationFromExisting(existing);
  const f = getFreeMarketFromExisting(existing);
  return hasCompletePair(p.gold, p.silver) || hasCompletePair(f.gold, f.silver)
    || hasMetalPrices(p.gold) || hasMetalPrices(p.silver)
    || hasMetalPrices(f.gold) || hasMetalPrices(f.silver);
}

function buildSourceFromQuote(label, sourceName, quote, previous, successAt) {
  return {
    label,
    sourceName,
    lastSuccessAt: successAt,
    dataStatus: 'live',
    gold: quoteToSourceMetal(quote.gold, previous?.gold),
    silver: quoteToSourceMetal(quote.silver, previous?.silver),
  };
}

function markSourcePreserved(previous, nowMs) {
  const block = {
    label: previous.label,
    sourceName: previous.sourceName,
    lastSuccessAt: previous.lastSuccessAt,
    dataStatus: resolveDataStatus(previous, nowMs),
    gold: { ...previous.gold },
    silver: { ...previous.silver },
  };
  return block;
}

function overallFileStatus(participation, freeMarket) {
  const pOk = hasCompletePair(participation.gold, participation.silver);
  const fOk = hasCompletePair(freeMarket.gold, freeMarket.silver);
  if (pOk && fOk) return 'ok';
  if (pOk || fOk) return 'partial';
  if (hasMetalPrices(participation.gold) || hasMetalPrices(participation.silver)
    || hasMetalPrices(freeMarket.gold) || hasMetalPrices(freeMarket.silver)) {
    return 'partial';
  }
  return 'empty';
}

function assertWritableMarket(market) {
  if (!market || typeof market !== 'object') throw new Error('market nesnesi geçersiz');
  if (!market.sources?.participation || !market.sources?.freeMarket) {
    throw new Error('sources.participation / freeMarket zorunlu');
  }
  const json = JSON.stringify(market, null, 2);
  JSON.parse(json); // round-trip
  return `${json}\n`;
}

/** Atomik yazım: tmp dosyaya yaz → fsync → rename. Yarım JSON kalmaz. */
function writeMarketAtomic(market) {
  const payload = assertWritableMarket(market);
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_TMP_PATH, payload, 'utf8');
  const fd = fs.openSync(OUT_TMP_PATH, 'r+');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(OUT_TMP_PATH, OUT_PATH);
}

function preserveExistingAndExit(reason) {
  console.error(`HATA: ${reason}`);
  console.error('Yeni veri alınamadı; mevcut market.json korundu (overwrite yok).');
  try {
    if (fs.existsSync(OUT_TMP_PATH)) fs.unlinkSync(OUT_TMP_PATH);
  } catch { /* ignore */ }
  process.exit(1);
}

async function fetchInstitutionQuote(institution) {
  const url = `https://altin.doviz.com/${institution.slug}`;
  const html = await fetchText(url);
  return parseInstitutionPage(html, institution.label);
}

async function fetchMarketFromInstitutions() {
  for (const institution of INSTITUTIONS) {
    try {
      const quote = await fetchInstitutionQuote(institution);
      console.log(`Kaynak seçildi: ${institution.label} (${institution.slug})`);
      return { quote, sourceName: institution.label };
    } catch (err) {
      console.error(`${institution.slug} hatası:`, err.message);
    }
  }
  return null;
}

async function fetchFreeMarketQuote() {
  const html = await fetchText(FREE_MARKET_URL);
  const quote = parseFreeMarketPage(html, FREE_MARKET_LABEL);
  return { quote, sourceName: FREE_MARKET_LABEL };
}

async function main() {
  const existing = readExistingMarket();
  const prevParticipation = getParticipationFromExisting(existing);
  const prevFreeMarket = getFreeMarketFromExisting(existing);
  const nowIso = new Date().toISOString();
  const nowMs = Date.parse(nowIso);

  let participationResult = null;
  try {
    participationResult = await fetchMarketFromInstitutions();
  } catch (err) {
    console.error('Katılım beklenmeyen hata:', err.message);
  }

  let freeMarketResult = null;
  try {
    freeMarketResult = await fetchFreeMarketQuote();
    console.log(`Serbest Piyasa kaynağı: ${FREE_MARKET_LABEL}`);
  } catch (err) {
    console.error('Serbest Piyasa hatası:', err.message);
  }

  // Geçici nesne — yalnızca tamamen kurulunca atomik yazılır
  let participation = markSourcePreserved(prevParticipation, nowMs);
  let freeMarket = markSourcePreserved(prevFreeMarket, nowMs);
  let participationUpdated = false;
  let freeMarketUpdated = false;

  if (participationResult?.quote) {
    const checked = validateIncomingQuote(
      participationResult.quote,
      prevParticipation,
      'participation'
    );
    if (checked.ok) {
      participation = buildSourceFromQuote(
        'Katılım',
        participationResult.sourceName,
        checked,
        prevParticipation,
        nowIso
      );
      participationUpdated = true;
    } else {
      console.warn(`Katılım reddedildi (önceki korundu): ${checked.reason}`);
    }
  } else {
    console.warn('Katılım scrape başarısız; önceki geçerli veri korundu.');
  }

  if (freeMarketResult?.quote) {
    const checked = validateIncomingQuote(
      freeMarketResult.quote,
      prevFreeMarket,
      'freeMarket'
    );
    if (checked.ok) {
      freeMarket = buildSourceFromQuote(
        'Serbest Piyasa',
        freeMarketResult.sourceName,
        checked,
        prevFreeMarket,
        nowIso
      );
      freeMarketUpdated = true;
    } else {
      console.warn(`Serbest Piyasa reddedildi (önceki korundu): ${checked.reason}`);
    }
  } else {
    console.warn('Serbest Piyasa scrape başarısız; önceki geçerli veri korundu.');
  }

  const anyFresh = participationUpdated || freeMarketUpdated;
  const hasAnyValid = hasCompletePair(participation.gold, participation.silver)
    || hasCompletePair(freeMarket.gold, freeMarket.silver);

  if (!anyFresh && !hasAnyValid && !existingHasAnyPrices(existing)) {
    const empty = {
      ...EMPTY_MARKET,
      updatedAt: nowIso,
      status: 'empty',
    };
    writeMarketAtomic(empty);
    console.log('Hiçbir geçerli fiyat yok; boş market.json yazıldı.');
    process.exit(0);
  }

  if (!anyFresh && existingHasAnyPrices(existing)) {
    // Hiçbir kaynak yenilenmedi — dosyayı dokunma (updatedAt şişmesin, stale doğru kalsın)
    console.warn('Hiçbir kaynak güvenle güncellenemedi; market.json değiştirilmedi.');
    process.exit(1);
  }

  const market = {
    updatedAt: nowIso,
    source: 'auto',
    status: overallFileStatus(participation, freeMarket),
    sources: {
      participation,
      freeMarket,
    },
  };

  writeMarketAtomic(market);

  if (participationUpdated) {
    console.log(`Katılım yazıldı [${participation.dataStatus}]: altın ${participation.gold.sell}, gümüş ${participation.silver.sell}`);
  }
  if (freeMarketUpdated) {
    console.log(`Serbest Piyasa yazıldı [${freeMarket.dataStatus}]: altın ${freeMarket.gold.sell}, gümüş ${freeMarket.silver.sell}`);
  }
  console.log(`market.json atomik güncellendi (status: ${market.status}, updatedAt: ${nowIso}).`);
}

main().catch((err) => {
  console.error('Beklenmeyen hata:', err.message);
  const existing = readExistingMarket();
  if (existingHasAnyPrices(existing)) {
    preserveExistingAndExit(`Beklenmeyen hata: ${err.message}`);
  }
  try {
    writeMarketAtomic({ ...EMPTY_MARKET, updatedAt: new Date().toISOString() });
  } catch (writeErr) {
    console.error('Boş market yazılamadı:', writeErr.message);
  }
  process.exit(1);
});
