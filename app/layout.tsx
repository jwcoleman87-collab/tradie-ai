import type { Metadata } from 'next';
import { Inter, Work_Sans } from 'next/font/google';
import './globals.css';
import './workspace.css';
import './workbench.css';

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
});

const workSans = Work_Sans({
  variable: '--font-work-sans',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_ORIGIN || 'http://localhost:3000'),
  title: 'Workbench — Your business. Your crew. One place.',
  description:
    'The practical AI crew that helps trades businesses run the work behind the work.',
  robots: { index: false, follow: false },
  icons: {
    icon: { url: '/workbench/mark.png?v=workbench-1', type: 'image/png' },
  },
  openGraph: {
    title: 'Workbench',
    description: 'Your business. Your crew. One place.',
    images: ['/og.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Workbench',
    description: 'Your business. Your crew. One place.',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${workSans.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
