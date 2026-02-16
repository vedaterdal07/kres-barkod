import { NextResponse } from "next/server";

export const runtime = "edge"; // Vercel'de daha stabil (fetch + html parse için)

const BASE = "https://www.xn--kremarket-22b.com";

function cleanText(s: string) {
  return (s || "").replace(/\s+/g, " ").trim();
}

function parseTRY(priceText: string) {
  // "₺399,00" -> 399.00
  const t = (priceText || "")
    .replace(/[^\d,\.]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const barcode = (url.searchParams.get("q") || "").trim();
  const debug = url.searchParams.get("debug") === "1";

  if (!barcode) {
    return NextResponse.json({ ok: true, found: false, error: "q param yok" });
  }

  // Ticimax arama sayfası
  const searchUrl = `${BASE}/Arama?1&kelime=${encodeURIComponent(barcode)}`;

  try {
    const res = await fetch(searchUrl, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        accept: "text/html,application/xhtml+xml",
      },
      // cache istemiyoruz
      cache: "no-store",
    });

    const html = await res.text();

    // Basit ve dayanıklı parse:
    // 1) Ürün adı için sayfa title (genelde barkod - Ürün Adı - site)
    let title = "";
    const mTitle = html.match(/<title>(.*?)<\/title>/i);
    if (mTitle?.[1]) {
      const t = cleanText(mTitle[1]);
      // "868... - Aktivite Halkaları 6 Renk - Dünya Kreş Market ..." gibi
      const parts = t.split(" - ");
      if (parts.length >= 2) title = cleanText(parts[1]);
      else title = t;
    }

    // 2) Fiyat için en basit: ₺ ile başlayan ilk fiyatı yakala (KDV Dahil yazısı varsa ilkini al)
    // Örn: "₺399,00 KDV Dahil ₺599,00 KDV Dahil" -> ₺399,00
    let price = "";
    const mPrice = html.match(/₺\s*\d{1,3}(?:\.\d{3})*(?:,\d{2})?/);
    if (mPrice?.[0]) price = cleanText(mPrice[0]).replace(/\s+/g, "");

    const found = Boolean(title && price);

    if (debug) {
      return NextResponse.json({
        ok: true,
        found,
        barcode,
        searchUrl,
        upstream_status: res.status,
        title_probe: title,
        price_probe: price,
        html_sample: html.slice(0, 500),
      });
    }

    if (!found) {
      return NextResponse.json({ ok: true, found: false });
    }

    // İstersen price numeric de ekleyebiliriz (sepet hesabı için)
    return NextResponse.json({
      ok: true,
      found: true,
      title,
      price,
      priceValue: parseTRY(price),
    });
  } catch (e: any) {
    return NextResponse.json({
      ok: false,
      found: false,
      error: e?.message || String(e),
    });
  }
}
