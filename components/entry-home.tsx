'use client';

import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, LockKeyhole } from 'lucide-react';
import { useWorkbenchAuth } from '@/lib/use-workbench-auth';

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

      <footer className="entry-footer">
        <span>Controlled pilot</span>
        <span>Workbench prepares. You decide.</span>
      </footer>
    </main>
  );
}
