import { brands, findBrandIdsInText, type BrandId } from '@/lib/brands';

export function BrandMark({
  brand,
  showLabel = false,
  compact = false,
}: {
  brand: BrandId;
  showLabel?: boolean;
  compact?: boolean;
}) {
  const value = brands[brand];
  return (
    <span
      className={`brand-mark ${compact ? 'compact' : ''}`}
      data-brand={brand}
      title={`${value.label} branding`}
      aria-label={showLabel ? value.label : undefined}
    >
      <span className={`brand-logo-box ${value.format}`}>
        {/* Curated local trademark assets do not need Next image transformation. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={value.asset} alt="" aria-hidden="true" />
      </span>
      {showLabel && !value.imageIncludesLabel && (
        <span className="brand-label">{value.label}</span>
      )}
    </span>
  );
}

export function BrandMentions({
  text,
  exclude = [],
}: {
  text: string;
  exclude?: BrandId[];
}) {
  const matches = findBrandIdsInText(text).filter(
    (brand) => !exclude.includes(brand),
  );
  if (!matches.length) return null;
  return (
    <div className="brand-mentions" aria-label="Brands mentioned">
      {matches.map((brand) => (
        <BrandMark key={brand} brand={brand} showLabel compact />
      ))}
    </div>
  );
}
