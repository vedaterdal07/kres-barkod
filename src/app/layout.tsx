import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "kres-barkod",
  description: "Barcode lookup",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr" suppressHydrationWarning>
      <body suppressHydrationWarning style={{ margin: 0 }}>
        {children}
      </body>
    </html>
  );
}
