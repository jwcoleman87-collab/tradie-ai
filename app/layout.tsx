import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import './workspace.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_ORIGIN || 'http://localhost:3000'),
  title: 'Tradie AI — Your private business team',
  description:
    'One conversation. Five managed agents. Your approval before anything changes.',
  robots: { index: false, follow: false },
  openGraph: {
    title: 'Tradie AI',
    description: 'Your private business team',
    images: ['/og.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Tradie AI',
    description: 'Your private business team',
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
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
