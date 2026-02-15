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

  if (!barcode) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const url = `https://www.xn--kremarket-22b.com/Arama?1&kelime=${encodeURIComponent(barcode)}`;

  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0",
      accept: "text/html",
    },
    cache: "no-store",
  });

  const html = await res.text();
  const $ = cheerio.load(html);

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
