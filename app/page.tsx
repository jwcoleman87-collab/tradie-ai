import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, LockKeyhole } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Workbench — Your business, made lighter.',
  description:
    'Meet Workbench Chat, the simple AI guide for setting up your private Workbench.',
  alternates: { canonical: '/' },
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
  return (
    <main className="entry-page">
      <header className="entry-header">
        <Link href="/" aria-label="Workbench home">
          <Image
            src="/workbench/lockup.png"
            alt="Workbench"
            width={620}
            height={116}
            priority
            unoptimized
          />
        </Link>
        <Link className="entry-sign-in" href="/sign-in">
          Sign in
        </Link>
      </header>

      <section className="entry-hero">
        <div className="entry-copy">
          <span className="eyebrow">YOUR BUSINESS. MADE LIGHTER.</span>
          <h1>
            Meet your Chat.
            <span>Your business starts with a conversation.</span>
          </h1>
          <p>
            Tell Chat about the work behind your work. It will guide the setup,
            one useful question at a time.
          </p>
          <Link
            className="entry-primary"
            href="/sign-in?view=signup&next=/onboarding"
          >
            Start chatting <ArrowRight size={18} />
          </Link>
          <span className="entry-private-note">
            <LockKeyhole size={13} /> Private setup. You stay in control.
          </span>
        </div>

        <div className="entry-magic" aria-hidden="true">
          <div className="entry-magic-mark">
            <Image
              src="/workbench/mark.png"
              alt=""
              width={167}
              height={132}
              unoptimized
            />
          </div>
          <div className="entry-message">
            <span>CHAT</span>
            <p>G’day. Let’s get your Workbench ready.</p>
          </div>
        </div>
      </section>

      <footer className="entry-footer">
        <span>Controlled pilot</span>
        <span>Workbench prepares. You decide.</span>
      </footer>
    </main>
  );
}
