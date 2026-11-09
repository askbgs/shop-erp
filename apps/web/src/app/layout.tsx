import type { Metadata, Viewport } from 'next';
import { QueryProvider } from '@/lib/session';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Shop ERP', template: '%s · Shop ERP' },
  description: 'Point of sale, stock and repairs for phone and computer shops',
};

export const viewport: Viewport = { themeColor: '#145c45', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
