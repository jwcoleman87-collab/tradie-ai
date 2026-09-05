import { brands, findBrandIdsInText, type BrandId } from '@/lib/brands';
import Image from 'next/image';

export function BrandMark({
  brand,
  src,
  alt,
  initials,
  showLabel = false,
  compact = false,
  size = compact ? 'sm' : 'md',
}: {
  brand?: BrandId;
  src?: string;
  alt?: string;
  initials?: string;
  showLabel?: boolean;
  compact?: boolean;
  size?: 'sm' | 'md';
}) {
  const value = brand ? brands[brand] : undefined;
  const label = alt || value?.label || 'Business';
  const asset = src || value?.asset;
  return (
    <span
      className={`brand-mark ${compact ? 'compact' : ''}`}
      data-brand={brand}
      data-brand-size={size}
      title={label}
      aria-label={label}
    >
      <span
        className={`brand-logo-box ${value?.format || 'icon'} ${asset ? '' : 'brand-initials'}`}
      >
        {asset ? (
          <Image
            src={asset}
            alt=""
            aria-hidden="true"
            width={32}
            height={32}
            unoptimized
          />
        ) : (
          <span aria-hidden="true">
            {initials || label.slice(0, 2).toUpperCase()}
          </span>
        )}
      </span>
      {showLabel && <span className="brand-label">{label}</span>}
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
