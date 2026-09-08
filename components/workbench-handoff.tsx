'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Image from 'next/image';
import { ArrowRight, ChevronDown, Droplets, Globe, MapPin, Phone, ShieldCheck, Zap } from 'lucide-react';
import { BrandMark } from './brand';
import { findWorkspaceBrand } from '@/lib/brands';
import type { Snapshot } from '@/lib/contracts';
import type { ConnectionInfo } from '@/lib/integrations';
import { MessageCopy } from './message-copy';

export function SplitTitle({ title }: { title: string }) {
  const separator = title.indexOf(' — ');
  return <><span className="title-main">{separator < 0 ? title : title.slice(0, separator)}</span>{separator >= 0 && <span className="title-sub">{title.slice(separator + 3)}</span>}</>;
}

function businessFacts(snapshot: Snapshot) {
  const greenVac = findWorkspaceBrand(snapshot.workspace.name) === 'green_vac';
  return {
    greenVac,
    location: snapshot.businessProfile?.base_location || (greenVac ? 'Canberra & Southern NSW' : ''),
    services: snapshot.businessProfile?.services.join(' · ') || (greenVac ? 'Compact hydro excavation · locate & expose' : ''),
  };
}

export function BusinessBanner({ snapshot, connections, onConnections }: { snapshot: Snapshot; connections: ConnectionInfo[]; onConnections: () => void }) {
  const facts = businessFacts(snapshot);
  const connected = connections.filter((connection) => connection.status === 'connected');
  return <section className={`business-band ${facts.greenVac ? 'business-band-greenvac' : ''}`} aria-label="Your business">
    {facts.greenVac && <Image className="business-banner-photo" src="/brands/greenvac-banner.jpg" alt="" fill sizes="100vw" unoptimized priority />}
    <div className="business-band-scrim" />
    <div className="business-band-content">
      <div className="business-band-identity">
        <div className="business-logo-badge"><BrandMark brand={findWorkspaceBrand(snapshot.workspace.name)} alt={snapshot.workspace.name} initials={snapshot.workspace.name.slice(0, 2).toUpperCase()} /></div>
        <div className="business-band-copy">
          <span className="business-trade">{facts.greenVac ? 'Non-destructive trenching' : snapshot.workspace.workspace_type === 'sandbox' ? 'Sandbox workspace' : 'My business'}</span>
          <h2 title={snapshot.workspace.name}>{snapshot.workspace.name}</h2>
          <p>{facts.location}{facts.greenVac && <>{facts.location && ' · '}0408 362 590</>}{!facts.location && !facts.greenVac && 'Your private business workspace'}</p>
        </div>
      </div>
      <div className="business-connections"><span>{connected.length ? 'Connected' : 'Your connections'}</span><div>{connected.length ? connected.map((connection) => <button key={connection.provider} type="button" onClick={onConnections}>{connection.provider === 'google_ads' ? 'Google Ads' : connection.provider === 'google_calendar' ? 'Calendar' : 'Facebook'}</button>) : <button type="button" onClick={onConnections}>Manage connections <ArrowRight size={12} /></button>}</div></div>
    </div>
  </section>;
}

export function BusinessDetails({ snapshot }: { snapshot: Snapshot | null }) {
  const facts = snapshot ? businessFacts(snapshot) : null;
  return <footer className="crew-footer">
    {snapshot && facts && <details className="business-details"><summary>Business details <ChevronDown size={13} /></summary><div>
      {facts.location && <p><MapPin size={13} /><span>{facts.location}</span></p>}
      {facts.services && <p><Droplets size={13} /><span>{facts.services}</span></p>}
      {facts.greenVac && <><p><Zap size={13} /><span>Electrical · NBN · Gas · Water · Stormwater</span></p><p><Phone size={13} /><a href="tel:0408362590">0408 362 590</a></p><p><Globe size={13} /><a href="https://greenvac.com.au" target="_blank" rel="noreferrer">greenvac.com.au</a></p></>}
      {!facts.location && !facts.services && <p>Business information appears here after setup.</p>}
    </div></details>}
    <div className="crew-privacy"><ShieldCheck size={16} /><div><strong>Private by default</strong><p>Nothing goes out without your say-so.</p></div></div>
  </footer>;
}

/** Persist only disclosure preferences; business content stays in the authenticated API. */
export function MetadataDisclosure({ id, className = '', summary, children }: { id: string; className?: string; summary: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const key = `workbench:disclosure:${id}`;
  useEffect(() => { try { setOpen(window.localStorage.getItem(key) === 'true'); } catch { /* Session state works without storage. */ } }, [key]);
  return <details className={`metadata-disclosure ${className}`} open={open} onToggle={(event) => {
    const value = event.currentTarget.open;
    setOpen(value);
    try { window.localStorage.setItem(key, String(value)); } catch { /* Session state works without storage. */ }
  }}><summary>{summary}<ChevronDown className="disclosure-chevron" size={14} /></summary><div className="metadata-disclosure-body">{children}</div></details>;
}

export function CompactChatReply({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const shouldFold = text.length > 400;
  if (!shouldFold) return <MessageCopy text={text} />;
  const paragraphs = text.split(/\n\s*\n/);
  const hasCoverage = text.startsWith('Data coverage: ');
  const first = paragraphs[hasCoverage ? 1 : 0] || text;
  const summary = first.length > 260 ? `${first.slice(0, 257).trimEnd()}…` : first;
  return <div className="compact-chat-reply">
    {expanded ? <MessageCopy text={text} /> : <MessageCopy text={hasCoverage ? `${paragraphs[0]}\n\n${summary}` : summary} />}
    <button className="brief-toggle" type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? 'Hide full brief' : 'Show full brief'}<ChevronDown size={13} /></button>
  </div>;
}
