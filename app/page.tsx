import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import {
  ArrowRight,
  Camera,
  Check,
  FileCheck2,
  Globe,
  LockKeyhole,
  Megaphone,
  MessageCircleMore,
  ReceiptText,
  ShieldCheck,
  Sparkles,
  Wallet,
  Wrench,
} from 'lucide-react';

export const metadata: Metadata = {
  title: 'Workbench — You build it. We handle the business.',
  description:
    'The practical AI crew for Australian trades businesses. Tell Magic what needs doing, review the prepared work and stay in control.',
  alternates: { canonical: '/' },
  openGraph: {
    title: 'Workbench — You build it. We handle the business.',
    description: 'Your business. Your crew. One place.',
    images: ['/og.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Workbench — You build it. We handle the business.',
    description: 'Your business. Your crew. One place.',
    images: ['/og.png'],
  },
};

const crew = [
  {
    icon: Wallet,
    title: 'Know where the money goes',
    copy: 'Prepare clearer finance records and keep the paperwork moving.',
  },
  {
    icon: Megaphone,
    title: 'Keep the next job coming',
    copy: 'Turn business goals into useful marketing work ready to review.',
  },
  {
    icon: Camera,
    title: 'Make good work visible',
    copy: 'Shape job updates into social content without losing your voice.',
  },
  {
    icon: Wrench,
    title: 'Keep the gear working',
    copy: 'Organise maintenance knowledge so fewer important jobs slip past.',
  },
  {
    icon: Globe,
    title: 'Keep the business up to date',
    copy: 'Prepare website and business-information changes for your say-so.',
  },
];

export default function Home() {
  return (
    <main className="landing-page">
      <header className="landing-header">
        <Link className="landing-logo" href="/" aria-label="Workbench home">
          <Image
            src="/workbench/lockup.png"
            alt="Workbench"
            width={620}
            height={116}
            style={{ height: 'auto' }}
            priority
            unoptimized
          />
        </Link>
        <nav aria-label="Main navigation">
          <a href="#how-it-works">How it works</a>
          <a href="#crew">Your crew</a>
          <a href="#control">Your control</a>
          <Link className="landing-sign-in" href="/sign-in">
            Sign in
          </Link>
          <Link className="landing-header-cta" href="/sign-in?next=/onboarding">
            Join controlled pilot <ArrowRight size={15} />
          </Link>
        </nav>
      </header>

      <section className="landing-hero">
        <div className="hero-copy">
          <span className="eyebrow">AI CREW FOR TRADES BUSINESSES</span>
          <h1>
            You build it.
            <span>We handle the business.</span>
          </h1>
          <p className="hero-lede">
            Tell Magic what needs doing. The right crew prepares the business
            work behind the physical work — and you stay in control of what
            happens next.
          </p>
          <div className="hero-actions">
            <Link
              className="primary-landing-cta"
              href="/sign-in?next=/onboarding"
            >
              Start with Magic <ArrowRight size={18} />
            </Link>
            <Link className="secondary-landing-cta" href="/sign-in">
              Sign in to Workbench
            </Link>
          </div>
          <p className="pilot-note">
            Controlled pilot access. No public pricing or payment required on
            this page.
          </p>
        </div>

        <div className="hero-workbench-preview" aria-label="How Magic works">
          <div className="preview-topbar">
            <div className="preview-brand">
              <Image
                src="/workbench/mark.png"
                alt=""
                width={35}
                height={28}
                unoptimized
              />
              <div>
                <strong>Magic</strong>
                <span>Ready to help</span>
              </div>
            </div>
            <span className="preview-private">
              <LockKeyhole size={13} /> Private workspace
            </span>
          </div>
          <div className="preview-body">
            <div className="preview-message assistant">
              G’day. What can I get done for you today?
            </div>
            <div className="preview-message owner">
              Help me stay on top of the business while I’m on the tools.
            </div>
            <div className="preview-routing">
              <span>
                <Sparkles size={15} /> Magic routes the work
              </span>
              <div>
                <span>
                  <Wallet size={14} /> Finance
                </span>
                <span>
                  <Megaphone size={14} /> Marketing
                </span>
                <span>
                  <Wrench size={14} /> Maintenance
                </span>
              </div>
            </div>
            <div className="preview-result">
              <span className="section-label">READY FOR YOUR SAY-SO</span>
              <strong>Your crew prepares the result.</strong>
              <p>Review the detail before any separate external action.</p>
              <div className="preview-buttons">
                <span>Deny</span>
                <span>Accept</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section
        className="landing-proof-strip"
        aria-label="Workbench principles"
      >
        <div>
          <MessageCircleMore size={21} />
          <span>
            <strong>Talk normally</strong>No system training required
          </span>
        </div>
        <div>
          <FileCheck2 size={21} />
          <span>
            <strong>Useful work prepared</strong>Not another admin dashboard
          </span>
        </div>
        <div>
          <ShieldCheck size={21} />
          <span>
            <strong>Stay in control</strong>Review before external change
          </span>
        </div>
      </section>

      <section className="landing-section how-section" id="how-it-works">
        <div className="section-heading">
          <span className="eyebrow">SIMPLE, PRACTICAL</span>
          <h2>One front door for the work behind the work.</h2>
          <p>
            Magic keeps the conversation simple while your crew handles the
            specialist thinking behind the scenes.
          </p>
        </div>
        <div className="three-steps">
          <article>
            <span className="step-number">01</span>
            <MessageCircleMore size={28} />
            <h3>Talk to Magic</h3>
            <p>
              Say what needs doing in the same words you would use with a
              capable teammate.
            </p>
          </article>
          <ArrowRight className="step-arrow" aria-hidden="true" />
          <article>
            <span className="step-number">02</span>
            <Sparkles size={28} />
            <h3>Your crew prepares the work</h3>
            <p>
              The right specialists organise the context and prepare a useful
              result.
            </p>
          </article>
          <ArrowRight className="step-arrow" aria-hidden="true" />
          <article>
            <span className="step-number">03</span>
            <Check size={28} />
            <h3>You review the result</h3>
            <p>
              Approve, deny or correct the work. External changes remain a
              separate decision.
            </p>
          </article>
        </div>
      </section>

      <section className="landing-section crew-section" id="crew">
        <div className="section-heading light">
          <span className="eyebrow">YOUR CREW</span>
          <h2>Support for the parts of business that follow you home.</h2>
          <p>
            Five areas of practical support, coordinated through one
            conversation.
          </p>
        </div>
        <div className="crew-grid">
          {crew.map(({ icon: Icon, title, copy }) => (
            <article key={title}>
              <span className="crew-icon">
                <Icon size={23} />
              </span>
              <h3>{title}</h3>
              <p>{copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-section onboarding-preview-section">
        <div className="onboarding-preview-copy">
          <span className="eyebrow">MEET MAGIC</span>
          <h2>Five useful prompts. Not fifty setup fields.</h2>
          <p>
            Magic starts with a few high-information questions, builds a draft
            business profile and shows what each fact came from. You correct
            genuine gaps before anything is confirmed.
          </p>
          <ul>
            <li>
              <Check size={17} /> Your answers are marked as owner supplied.
            </li>
            <li>
              <Check size={17} /> Inferences are visible and easy to correct.
            </li>
            <li>
              <Check size={17} /> Public research is only claimed when a
              verified source actually ran.
            </li>
          </ul>
          <Link className="text-landing-link" href="/sign-in?next=/onboarding">
            Start a sourced first profile <ArrowRight size={16} />
          </Link>
        </div>
        <div className="onboarding-preview-card">
          <div className="preview-card-heading">
            <Image
              src="/workbench/mark.png"
              alt=""
              width={42}
              height={33}
              unoptimized
            />
            <div>
              <span className="section-label">MAGIC</span>
              <strong>What Magic found</strong>
            </div>
          </div>
          <div className="found-fact">
            <div>
              <strong>Business name</strong>
              <span className="owner-supplied">owner supplied</span>
            </div>
            <p>Your business name appears here</p>
            <small>High confidence · Your onboarding answer</small>
          </div>
          <div className="found-fact">
            <div>
              <strong>Work you want more of</strong>
              <span className="inferred">inferred</span>
            </div>
            <p>A useful draft, ready for your correction</p>
            <small>Medium confidence · Based on your stated goal</small>
          </div>
          <div className="source-boundary">
            <Globe size={17} /> Public-source research is clearly labelled
            connected or unavailable.
          </div>
        </div>
      </section>

      <section className="landing-section control-section" id="control">
        <div className="section-heading">
          <span className="eyebrow">BUILT AROUND YOUR SAY-SO</span>
          <h2>Prepared by your crew. Controlled by you.</h2>
          <p>
            Workbench is designed to make uncertainty and external action
            visible.
          </p>
        </div>
        <div className="trust-grid">
          <article>
            <LockKeyhole size={25} />
            <h3>Private workspaces</h3>
            <p>
              Business records, files and connections stay scoped to the
              selected workspace.
            </p>
          </article>
          <article>
            <ShieldCheck size={25} />
            <h3>Approval before change</h3>
            <p>
              Prepared work is not permission to send, book, connect or publish
              it.
            </p>
          </article>
          <article>
            <ReceiptText size={25} />
            <h3>Clear receipts</h3>
            <p>
              Confirmed external actions keep provider evidence; failures stay
              visible and honest.
            </p>
          </article>
        </div>
      </section>

      <section className="landing-final-cta">
        <Image
          src="/workbench/mark.png"
          alt=""
          width={68}
          height={54}
          unoptimized
        />
        <span className="eyebrow">YOUR BUSINESS. YOUR CREW. ONE PLACE.</span>
        <h2>Give the business work a place to get done.</h2>
        <p>
          Join the controlled pilot, answer Magic in your own words and review
          the first profile before you continue.
        </p>
        <div className="hero-actions">
          <Link
            className="primary-landing-cta"
            href="/sign-in?next=/onboarding"
          >
            Start with Magic <ArrowRight size={18} />
          </Link>
          <Link className="secondary-landing-cta dark" href="/sign-in">
            Existing owner sign in
          </Link>
        </div>
      </section>

      <footer className="landing-footer">
        <Image
          src="/workbench/lockup.png"
          alt="Workbench"
          width={620}
          height={116}
          style={{ height: 'auto' }}
          unoptimized
        />
        <p>
          Practical business support for Australian trades and small service
          businesses.
        </p>
        <Link href="/sign-in">Sign in</Link>
      </footer>
    </main>
  );
}
