import type { Metadata } from 'next';
import './styles.css';
import './features.css';

export const metadata: Metadata = {
  title: 'Deadline · 作业追踪器',
  description: '一个清晰、专注的作业截止日期追踪器。',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
