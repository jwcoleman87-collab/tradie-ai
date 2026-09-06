import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';

export const privacyContact = 'james@greenvac.com.au';

export function PrivacyPage({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <main className="privacy-page">
      <header>
        <Link href="/" aria-label="Workbench home">
          <Image
            src="/workbench/lockup.png"
            alt="Workbench"
            width={248}
            height={46}
            unoptimized
          />
        </Link>
        <Link href="/sign-in">Sign in</Link>
      </header>
      <article>
        <p className="privacy-eyebrow">YOUR INFORMATION. YOUR CHOICES.</p>
        <h1>{title}</h1>
        <p className="privacy-date">Effective 6 September 2026</p>
        {children}
      </article>
      <footer>
        <Link href="/">Workbench home</Link>
        <Link href="/privacy">Privacy policy</Link>
        <Link href="/data-deletion">Data deletion</Link>
        <a href={`mailto:${privacyContact}`}>Privacy contact</a>
      </footer>
    </main>
  );
}
