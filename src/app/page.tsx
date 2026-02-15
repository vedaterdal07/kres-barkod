"use client";

import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader, IScannerControls } from "@zxing/browser";

type LookupResp =
  | { ok: true; found: true; title: string; price: string }
  | { ok: true; found: false }
  | { ok: false };

type Product = { barcode: string; title: string; price: string };
type CartItem = Product & { qty: number };

type SavedCart = {
  id: string;
  name: string;
  createdAt: number;
  items: CartItem[];
};

function cleanText(s: string) {
  return (s || "").replace(/\s+/g, " ").trim();
}

function parseTRY(priceText: string) {
  const t = (priceText || "").replace(/\s+/g, " ").replace("TL", "₺").trim();
  const m = t.match(/(\d{1,3}(\.\d{3})*(,\d{2})?)/);
  if (!m) return 0;
  const num = m[1].replace(/\./g, "").replace(",", ".");
  const n = Number(num);
  return Number.isFinite(n) ? n : 0;
}

function formatTRY(n: number) {
  return "₺" + n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function toXlsHtml(cart: CartItem[], total: number) {
  const esc = (s: string) =>
    (s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const rows = cart
    .map((x) => {
      const rowTotal = parseTRY(x.price) * x.qty;
      return `
        <tr>
          <td style="mso-number-format:'\\@'">${esc(x.barcode)}</td>
          <td>${esc(x.title)}</td>
          <td>${esc(x.price)}</td>
          <td>${x.qty}</td>
          <td>${esc(formatTRY(rowTotal))}</td>
        </tr>
      `;
    })
    .join("");

  return `\uFEFF
<html>
<head><meta charset="utf-8" /></head>
<body>
  <table border="1">
    <tr>
      <th>barcode</th><th>urun_adi</th><th>urun_fiyati</th><th>adet</th><th>satir_toplam</th>
    </tr>
    ${rows}
    <tr>
      <td colspan="3"></td><td><b>SEPET_TOPLAMI</b></td><td><b>${esc(formatTRY(total))}</b></td>
    </tr>
  </table>
</body>
</html>`;
}
async function shareXlsViaWhatsApp(filename: string, html: string) {
  const blob = new Blob([html], {
    type: "application/vnd.ms-excel;charset=utf-8;",
  });
  const file = new File([blob], filename, {
    type: "application/vnd.ms-excel",
  });

  // 📱 Mobil + destek varsa → WhatsApp / Share Sheet
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    await navigator.share({
      title: filename,
      text: "Sepet Excel dosyası",
      files: [file],
    });
    return;
  }

  // 💻 Desktop fallback → indir
  downloadXls(filename, html);
}

function downloadXls(filename: string, html: string) {
  const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function Page() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const lockRef = useRef(false);

  const [barcode, setBarcode] = useState("");
  const [cameraOn, setCameraOn] = useState(false);
  const [camErr, setCamErr] = useState("");

  const [loading, setLoading] = useState(false);
  const [scanned, setScanned] = useState<Product | null>(null);
  const [notFound, setNotFound] = useState(false);

  const [cart, setCart] = useState<CartItem[]>([]);

  // ✅ Sepet kayıt
  const [savedCarts, setSavedCarts] = useState<SavedCart[]>([]);
  const [saveName, setSaveName] = useState("");

  useEffect(() => {
    try {
      const raw = localStorage.getItem("kres_saved_carts");
      if (raw) setSavedCarts(JSON.parse(raw));
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("kres_saved_carts", JSON.stringify(savedCarts));
    } catch {}
  }, [savedCarts]);

  const cartTotal = cart.reduce((sum, x) => sum + parseTRY(x.price) * x.qty, 0);

  function qtyOf(code: string) {
    return cart.find((x) => x.barcode === code)?.qty ?? 0;
  }

  function addToCart(p: Product) {
    setCart((prev) => {
      const idx = prev.findIndex((x) => x.barcode === p.barcode);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
        return next;
      }
      return [...prev, { ...p, qty: 1 }];
    });
  }

  function removeFromCart(code: string) {
    setCart((prev) =>
      prev
        .map((x) => (x.barcode === code ? { ...x, qty: x.qty - 1 } : x))
        .filter((x) => x.qty > 0)
    );
  }

  async function lookup(code: string) {
    const q = code.trim();
    if (!q) return;

    setLoading(true);
    setScanned(null);
    setNotFound(false);

    try {
      const r = await fetch(`/api/lookup?q=${encodeURIComponent(q)}`);
      const j = (await r.json()) as LookupResp;

      if (j.ok && "found" in j && j.found) {
        setScanned({ barcode: q, title: cleanText(j.title), price: cleanText(j.price) });
      } else {
        setNotFound(true);
      }
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }

  function stopCamera() {
    setCameraOn(false);
    lockRef.current = false;

    try {
      controlsRef.current?.stop();
    } catch {}
    controlsRef.current = null;

   
    readerRef.current = null;

    if (videoRef.current) {
      try {
        const s = videoRef.current.srcObject as MediaStream | null;
        s?.getTracks().forEach((t) => t.stop());
      } catch {}
      videoRef.current.srcObject = null;
    }
  }

  async function startCamera() {
    setCamErr("");
    setCameraOn(true);

    await new Promise((r) => setTimeout(r, 0));

    try {
      if (!videoRef.current) throw new Error("videoRef null");

      videoRef.current.setAttribute("playsinline", "true");
      videoRef.current.muted = true;
      videoRef.current.autoplay = true;

      // iPhone stabil: önce stream başlat
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: "environment" },
      });
      videoRef.current.srcObject = stream;
      await videoRef.current.play();

      // sonra ZXing decode
      const reader = new BrowserMultiFormatReader();
      readerRef.current = reader;

      const controls = await reader.decodeFromConstraints(
        {
          audio: false,
          video: { facingMode: "environment", width: 1280, height: 720 },
        },
        videoRef.current,
        (result) => {
          if (!result) return;
          if (lockRef.current) return;

          const text = result.getText()?.trim();
          if (!text) return;

          lockRef.current = true;
          setBarcode(text);
          lookup(text);

          setTimeout(() => {
            lockRef.current = false;
          }, 1200);
        }
      );

      controlsRef.current = controls;
    } catch (e: any) {
      console.error("ZXING_CAMERA_ERR", e);
      setCamErr(`${e?.name || "Error"}: ${e?.message || e}`);
      stopCamera();
    }
  }

  useEffect(() => {
    return () => stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function saveCartNow() {
    if (!cart.length) return alert("Sepet boş, kaydedemem.");

    const name = (saveName || "").trim() || `Sepet ${new Date().toLocaleString("tr-TR")}`;
    const id = `${Date.now()}_${Math.random().toString(16).slice(2)}`;

    const payload: SavedCart = { id, name, createdAt: Date.now(), items: cart };
    setSavedCarts((prev) => [payload, ...prev]);
    setSaveName("");
    alert("Sepet kaydedildi ✅");
  }

  function deleteSavedCart(id: string) {
    if (!confirm("Bu kayıtlı sepet silinsin mi?")) return;
    setSavedCarts((prev) => prev.filter((x) => x.id !== id));
  }

  const btnOrange: React.CSSProperties = {
    padding: "14px 18px",
    minWidth: 220,
    fontWeight: 800,
    borderRadius: 10,
    border: "none",
    cursor: "pointer",
    background: "#ff7a00",
    color: "white",
  };

  const btnGray: React.CSSProperties = {
    padding: "12px 14px",
    borderRadius: 10,
    border: "1px solid #ddd",
    background: "white",
    cursor: "pointer",
    fontWeight: 700,
  };

  return (
    <main style={{ maxWidth: 760, margin: "40px auto", padding: 16, fontFamily: "system-ui" }}>
      <h2>Barkod Oku</h2>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          placeholder="Barkod"
          value={barcode}
          onChange={(e) => setBarcode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") lookup(barcode);
          }}
          style={{ flex: 1, padding: 10 }}
        />
        <button onClick={() => lookup(barcode)} disabled={loading} style={btnGray}>
          {loading ? "Aranıyor..." : "Ara"}
        </button>
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
        {!cameraOn ? (
          <button onClick={startCamera} style={btnOrange}>
            🎥 KAMERAYI AÇ
          </button>
        ) : (
          <button onClick={stopCamera} style={{ ...btnGray, padding: "14px 18px", minWidth: 220 }}>
            ⛔ KAMERAYI KAPAT
          </button>
        )}
      </div>

      {camErr && <div style={{ marginTop: 10, color: "crimson" }}>Kamera Hatası: {camErr}</div>}

      <div
        style={{
          marginTop: 12,
          border: "1px solid #ddd",
          padding: 10,
          borderRadius: 8,
          display: cameraOn ? "block" : "none",
        }}
      >
        <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 6 }}>Telefonda arka kamera ile barkodu okut.</div>
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          style={{
            width: "100%",
            maxHeight: 240, // ✅ yarıya indirildi
            objectFit: "cover",
            borderRadius: 8,
          }}
        />
      </div>

      <div style={{ marginTop: 16, border: "1px solid #eee", padding: 12, borderRadius: 8 }}>
        <div style={{ fontWeight: 800, marginBottom: 6 }}>Ürün</div>

        {loading && <div>Yükleniyor...</div>}

        {!loading && scanned && (
          <>
            <div style={{ fontWeight: 700 }}>{scanned.title}</div>
            <div style={{ marginTop: 4 }}>{scanned.price}</div>

            <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10 }}>
              <button onClick={() => removeFromCart(scanned.barcode)} style={btnGray}>
                -
              </button>
              <div>
                <b>{qtyOf(scanned.barcode)}</b> adet
              </div>
              <button onClick={() => addToCart(scanned)} style={btnGray}>
                +
              </button>
            </div>
          </>
        )}

        {!loading && notFound && <div>Ürün bulunamadı</div>}
        {!loading && !scanned && !notFound && <div>Bir barkod okut / yaz.</div>}
      </div>

      <h3 style={{ marginTop: 22 }}>Sepet</h3>

      {!cart.length ? (
        <div>Sepet boş</div>
      ) : (
        <div style={{ border: "1px solid #eee", padding: 12, borderRadius: 8 }}>
          {cart.map((x) => (
            <div
              key={x.barcode}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 0",
                borderBottom: "1px solid #f2f2f2",
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700 }}>{x.title}</div>
                <div style={{ fontSize: 12, opacity: 0.8 }}>{x.price}</div>
              </div>

              <button onClick={() => removeFromCart(x.barcode)} style={btnGray}>
                -
              </button>
              <div style={{ minWidth: 70, textAlign: "center" }}>
                <b>{x.qty}</b> adet
              </div>
              <button
                onClick={() => addToCart({ barcode: x.barcode, title: x.title, price: x.price })}
                style={btnGray}
              >
                +
              </button>
            </div>
          ))}

          <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ fontWeight: 800 }}>Sepet Toplamı: {formatTRY(cartTotal)}</div>

            <button
              onClick={() => {
                const xls = toXlsHtml(cart, cartTotal);
                const name = `sepet_${new Date().toISOString().slice(0, 10)}.xls`;
                downloadXls(name, xls);
              }}
              style={btnGray}
            >
              📄 Excel (.XLS) İndir
            </button>

            <button onClick={() => setCart([])} style={btnGray}>
              🗑️ Sepeti Temizle
            </button>
          </div>

          <div style={{ marginTop: 16, borderTop: "1px solid #eee", paddingTop: 12 }}>
            <div style={{ fontWeight: 800, marginBottom: 8 }}>Sepeti Kaydet</div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <input
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder="Kayıt adı (opsiyonel)"
                style={{ padding: 10, minWidth: 240, flex: 1 }}
              />
              <button onClick={saveCartNow} style={btnGray}>
                💾 Sepet Kayıt Et
              </button>
            </div>

            <div style={{ marginTop: 14, fontWeight: 800 }}>Kayıtlı Sepetler</div>

            {!savedCarts.length ? (
              <div style={{ marginTop: 6, opacity: 0.8 }}>Henüz kayıt yok.</div>
            ) : (
              <div style={{ marginTop: 8, border: "1px solid #eee", borderRadius: 8, padding: 10 }}>
                {savedCarts.map((s) => (
                  <div
                    key={s.id}
                    style={{
                      display: "flex",
                      gap: 10,
                      alignItems: "center",
                      padding: "10px 0",
                      borderBottom: "1px solid #f2f2f2",
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700 }}>{s.name}</div>
                      <div style={{ fontSize: 12, opacity: 0.75 }}>
                        {new Date(s.createdAt).toLocaleString("tr-TR")} • {s.items.reduce((a, b) => a + b.qty, 0)} adet
                      </div>
                    </div>

                    {/* ✅ Yükle yerine Excel */}
<button
  onClick={async () => {
    const total = s.items.reduce((sum, x) => sum + parseTRY(x.price) * x.qty, 0);
    const xls = toXlsHtml(s.items, total);
    const safe = s.name.replace(/[^\w\-]+/g, "_");
    await shareXlsViaWhatsApp(`${safe}.xls`, xls);
  }}
  style={btnGray}
>
  📲 Excel’i WhatsApp’tan Gönder
</button>
                    

                    <button onClick={() => deleteSavedCart(s.id)} style={btnGray}>
                      🗑️ Sil
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
