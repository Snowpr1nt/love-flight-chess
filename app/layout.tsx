import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "恋爱飞行计划 · 双人联机体验",
  description: "和另一半各自在自己的设备上，一起沿心动棋盘飞向见面。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
