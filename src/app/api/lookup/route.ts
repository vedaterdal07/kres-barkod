import { NextResponse } from "next/server";
import * as cheerio from "cheerio";

function cleanText(s: string) {
  return (s || "").replace(/\s+/g, " ").trim();
}

function firstNonEmpty(...vals: string[]) {
  for (const v of vals) {
    const t = cleanText(v);
    if (t) return t;
  }
  return "";
}

// "₺399,00 KDV Dahil ₺599,00 KDV Dahil" -> "₺399,00"
function pickFirstPrice(text: string) {
  const t = cleanText(text);

  const m =
    t.match(/₺\s*\d{1,3}(\.\d{3})*(,\d{2})?/) ||
    t.match(/\d{1,3}(\.\d{3})*(,\d{2})?\s*₺/) ||
    t.match(/\d+([.,]\d{2})?/);

  return m ? cleanText(m[0]) : t;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const barcode = (searchParams.get("q") || "").trim();
  const { searchParams } = new URL(req.url);
const barcode = (searchParams.get("q") || "").trim();
const debug = searchParams.get("debug") === "1";

if (debug) {
  return Response.json({
    ok: true,
    found: false,
    debug: {
      note: "DEBUG_MODE_ON",
      barcode,
      build: "2026-02-16-1",
    },
  });
}


  if (!barcode) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const urls = [
  `${BASE}/Arama?1&kelime=${encodeURIComponent(q)}`,
  `${BASE}/?s=${encodeURIComponent(q)}&post_type=product`,
];

  let html = "";
let status = 0;

for (const url of urls) {
  const res = await fetch(url, {
    method: "GET",
    cache: "no-store",
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "accept-language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
      referer: BASE + "/",
    },
  });

  status = res.status;
  const t = await res.text();

  // iyi bir HTML geldiyse bunu kullan
  if (res.ok && t.length > 500) {
    html = t;
    break;
  }
}

if (!html) {
  return NextResponse.json({ ok: false, found: false, upstream_status: status });
}


  const product = $(".productItem, .ProductItem, .urunItem, .product-item").first();
  if (!product.length) {
    return NextResponse.json({ ok: true, found: false });
  }

  const title = firstNonEmpty(
    product.find(".productTitle").first().text(),
    product.find(".ProductName").first().text(),
    product.find(".product-title").first().text(),
    product.find(".productName").first().text(),
    product.find("h3").first().text(),
    product.find("h2").first().text(),
    product.find("a[title]").first().attr("title") || "",
    product.find("img[alt]").first().attr("alt") || ""
  );

  const rawPrice = firstNonEmpty(
    product
      .find(".discountPrice, .salePrice, .price, .productPrice, .Price, .product-price")
      .first()
      .text(),
    product.find("[class*='price']").first().text()
  );

  const price = pickFirstPrice(rawPrice);

  return NextResponse.json({
    ok: true,
    found: true,
    title,
    price,
  });
}

import { NextResponse } from "next/server";

const BASE = "https://www.xn--kremarket-22b.com";

function stripTags(s: string) {
  return s.replace(/<[^>]*>/g, " ");
}
function decodeBasicEntities(s: string) {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
function cleanText(s: string) {
  return decodeBasicEntities(stripTags(s)).replace(/\s+/g, " ").trim();
}

function pickFirst(html: string, patterns: RegExp[]) {
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return cleanText(m[1]);
  }
  return "";
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim();
  const debug = searchParams.get("debug") === "1";

  if (!q) return NextResponse.json({ ok: false, found: false, error: "missing_q" });

 const urls = [
  `${BASE}/Arama?1&kelime=${encodeURIComponent(q)}`,
  `${BASE}/?s=${encodeURIComponent(q)}&post_type=product`,
];
  // Prod'da bot/koruma yüzünden HTML farklı gelebiliyor: header şart
  const res = await fetch(url, {
    method: "GET",
    cache: "no-store",
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "accept-language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
      referer: BASE + "/",
    },
  });

  const html = await res.text();

  // Upstream sorun varsa "found:false" diye saklamayalım
  if (!res.ok || html.length < 200) {
    return NextResponse.json({
      ok: false,
      found: false,
      upstream_status: res.status,
      upstream_len: html.length,
    });
  }

  // TITLE için birden fazla olası yer:
  const title = pickFirst(html, [
    // ürün sayfası H1
    /<h1[^>]*class="[^"]*product_title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i,
    // search/list kart başlığı
    /<h2[^>]*class="[^"]*woocommerce-loop-product__title[^"]*"[^>]*>([\s\S]*?)<\/h2>/i,
    /<h3[^>]*class="[^"]*product-title[^"]*"[^>]*>([\s\S]*?)<\/h3>/i,
    // title tag fallback
    /<title[^>]*>([\s\S]*?)<\/title>/i,
  ]);

  // PRICE için:
  // WooCommerce genelde: <span class="woocommerce-Price-amount amount">₺399,00</span>
  let priceRaw = pickFirst(html, [
    /<span[^>]*class="[^"]*woocommerce-Price-amount[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
    /<bdi[^>]*>([\s\S]*?)<\/bdi>/i,
    // meta price fallback (bazı temalarda olur)
    /property="product:price:amount"\s+content="([^"]+)"/i,
  ]);

  // fiyat temizle: "KDV Dahil" vb kırp
  let price = priceRaw
    .replace(/KDV\s*Dahil/gi, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // İlk fiyat içinde iki fiyat gelirse ilkini al (399,00 599,00 gibi)
  // "₺" geçen ilk parçayı çekmeye çalış
  const mTry = price.match(/(₺\s*[\d\.\,]+)/);
  if (mTry?.[1]) price = mTry[1].replace(/\s+/g, "");

  const found = Boolean(title && price);

  if (!found && debug) {
    // Debug modunda küçük ipucu (HTML’i dökmüyoruz)
    return NextResponse.json({
      ok: true,
      found: false,
      debug: {
        upstream_status: res.status,
        upstream_len: html.length,
        title_guess: title,
        price_guess: priceRaw?.slice(0, 80) || "",
        html_title_snip: (html.match(/<title[^>]*>[\s\S]{0,120}<\/title>/i)?.[0] || "").slice(0, 140),
      },
    });
  }
if (!found && debug) {
  const titleTag = html.match(/<title[^>]*>([\s\S]{0,160})<\/title>/i)?.[1] || "";
  const hasCaptcha = /captcha|cloudflare|just a moment|verify you are/i.test(html);

  return NextResponse.json({
    ok: true,
    found: false,
    debug: {
      upstream_status: res.status,
      upstream_len: html.length,
      title_tag: cleanText(titleTag),
      hasCaptcha,
      sample: cleanText(html.slice(0, 400)), // ilk 400 karakter ipucu
    },
  });
}

  return NextResponse.json({
    ok: true,
    found,
    title: found ? title : "",
    price: found ? price : "",
  });
}



