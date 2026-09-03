import type { Metadata } from 'next';
import { EntryHome } from '@/components/entry-home';

export const metadata: Metadata = {
  title: 'Workbench — Your business, made lighter.',
  description:
    'Meet Workbench Chat, the simple AI guide for setting up your private Workbench.',
  alternates: { canonical: '/' },
  robots: { index: true, follow: true },
  openGraph: {
    title: 'Workbench — Your business, made lighter.',
    description: 'Your business. Your crew. One place.',
    images: ['/og.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Workbench — Your business, made lighter.',
    description: 'Your business. Your crew. One place.',
    images: ['/og.png'],
  },
};

export default function Home() {
  return <EntryHome />;
}
