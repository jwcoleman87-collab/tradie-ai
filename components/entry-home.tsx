'use client';

import Image from 'next/image';
import Link from 'next/link';
import {
  ArrowRight,
  Globe2,
  LockKeyhole,
  Megaphone,
  Share2,
  Wallet,
  Wrench,
} from 'lucide-react';
import { useWorkbenchAuth } from '@/lib/use-workbench-auth';

const crew = [
  { icon: Megaphone, name: 'Marketing', blurb: 'Drive more leads' },
  { icon: Share2, name: 'Social', blurb: 'Grow your presence' },
  { icon: Globe2, name: 'Website', blurb: 'Look professional' },
  { icon: Wallet, name: 'Finance', blurb: 'Keep cash flowing' },
  { icon: Wrench, name: 'Maintenance', blurb: 'Keep everything running' },
];

export function EntryHome() {
  const { session, loading } = useWorkbenchAuth();
  const signedIn = !loading && Boolean(session);
  const destination = signedIn
    ? '/workspace'
    : '/sign-in?view=signup&next=/onboarding';

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
        <Link
          className="entry-sign-in"
          href={signedIn ? '/workspace' : '/sign-in'}
        >
          {signedIn ? 'Open workspace' : 'Sign in'}
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
          <Link className="entry-primary" href={destination}>
            {signedIn ? 'Open my Workbench' : 'Start chatting'}{' '}
            <ArrowRight size={18} />
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

      <section className="entry-crew">
        <span className="entry-crew-eyebrow">YOUR AI CREW</span>
        <h2>One crew, working behind the scenes.</h2>
        <p>
          Chat brings in a specialist the moment a job needs one — you never
          manage them directly, and nothing they prepare goes out without your
          say-so.
        </p>
        <div className="entry-crew-grid">
          {crew.map(({ icon: Icon, name, blurb }) => (
            <div className="entry-crew-card" key={name}>
              <span className="entry-crew-icon" aria-hidden="true">
                <Icon size={18} />
              </span>
              <span className="entry-crew-name">{name}</span>
              <span className="entry-crew-blurb">{blurb}</span>
            </div>
          ))}
        </div>
      </section>

      <footer className="entry-footer">
        <span>Controlled pilot</span>
        <span>Workbench prepares. You decide.</span>
      </footer>
    </main>
  );
}
