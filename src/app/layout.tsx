import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '卡路里记录 - AI 食物热量识别',
  description: '拍下食物照片，AI 帮你识别菜品与营养信息，轻松记录每一餐的热量。',
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
