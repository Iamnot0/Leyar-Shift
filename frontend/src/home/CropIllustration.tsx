import type { ReactNode } from 'react';
import { photoKeys, photoSrc } from '../content/cropPhotos';

interface CropIllustrationProps {
  cropId: string;
  size?: 'tile' | 'dialog';
}

function normalizeCropKey(cropId: string): string {
  const id = cropId.toLowerCase();
  if (id.includes('sunflower')) return 'sunflower';
  if (id.includes('cotton')) return 'cotton';
  if (id.includes('soybean')) return 'soybean';
  if (id.includes('alfalfa')) return 'alfalfa';
  if (id.includes('sorghum')) return 'sorghum';
  if (id.includes('dry_beans') || id.includes('pulses') || id.includes('bean')) return 'dry_beans';
  if (id.includes('rice')) return 'rice';
  if (id.includes('corn') || id.includes('maize')) return 'corn';
  if (id.includes('wheat')) return 'winter_wheat';
  if (id.includes('small_grain') || id.includes('rye') || id.includes('oat') || id.includes('triticale')) return 'small_grain';
  if (id.includes('cover')) return 'cover_crop';
  return id;
}

function renderArtwork(key: string): ReactNode {
  switch (key) {
    case 'corn':
      return (
        <>
          <path d="M24 42V28" stroke="var(--crop-stem)" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M24 35C16 34 11 27 12 18C17 20 21 26 24 33Z" fill="var(--crop-leaf)" />
          <path d="M24 35C32 34 37 27 36 18C31 20 27 26 24 33Z" fill="var(--crop-leaf-deep)" />
          <rect x="18" y="9" width="12" height="22" rx="6" fill="var(--crop-gold)" stroke="var(--crop-stroke)" strokeWidth="1.5" />
          <path d="M21 12V28M24 11V29M27 12V28M19 16H29M19 20H29M19 24H29" stroke="var(--crop-gold-shade)" strokeWidth="1.2" strokeLinecap="round" />
          <path d="M22 9C21 6 19 5 17 5M24 9V4M26 9C27 6 29 5 31 5" stroke="var(--crop-warm)" strokeWidth="1.4" strokeLinecap="round" />
        </>
      );

    case 'winter_wheat':
      return (
        <>
          <path d="M24 43V11" stroke="var(--crop-gold-shade)" strokeWidth="2.2" strokeLinecap="round" />
          <path d="M24 38C17 36 14 30 15 24C19 27 22 31 24 36Z" fill="var(--crop-leaf)" />
          <ellipse cx="20.5" cy="26" rx="3" ry="4.5" transform="rotate(-25 20.5 26)" fill="var(--crop-gold)" />
          <ellipse cx="27.5" cy="26" rx="3" ry="4.5" transform="rotate(25 27.5 26)" fill="var(--crop-gold)" />
          <ellipse cx="20.5" cy="19.5" rx="3" ry="4.5" transform="rotate(-25 20.5 19.5)" fill="var(--crop-gold)" />
          <ellipse cx="27.5" cy="19.5" rx="3" ry="4.5" transform="rotate(25 27.5 19.5)" fill="var(--crop-gold)" />
          <ellipse cx="24" cy="13" rx="2.8" ry="4.5" fill="var(--crop-gold)" />
          <path d="M18 16L14 10M21 11L18 6M24 9V4M27 11L30 6M30 16L34 10" stroke="var(--crop-gold-shade)" strokeWidth="1.3" strokeLinecap="round" />
        </>
      );

    case 'sorghum':
      return (
        <>
          <path d="M24 43V25" stroke="var(--crop-stem)" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M24 37C16 35 12 29 12 22C17 24 21 29 24 35Z" fill="var(--crop-leaf)" />
          <path d="M24 39C31 37 35 31 35 24C30 26 27 31 24 37Z" fill="var(--crop-leaf-deep)" />
          <path d="M24 8C18 8 15 14 16 21C17 25 20 27 24 27C28 27 31 25 32 21C33 14 30 8 24 8Z" fill="var(--crop-warm)" />
          <circle cx="21" cy="14" r="1.6" fill="var(--crop-gold)" />
          <circle cx="26" cy="13" r="1.6" fill="var(--crop-gold)" />
          <circle cx="19" cy="19" r="1.6" fill="var(--crop-gold)" />
          <circle cx="24" cy="18" r="1.8" fill="var(--crop-gold)" />
          <circle cx="28" cy="20" r="1.6" fill="var(--crop-gold)" />
          <circle cx="22" cy="23" r="1.5" fill="var(--crop-gold)" />
          <circle cx="26" cy="24" r="1.5" fill="var(--crop-gold)" />
        </>
      );

    case 'soybean':
      return (
        <>
          <path d="M22 42C22 31 24 21 28 11" stroke="var(--crop-stem)" strokeWidth="2.3" strokeLinecap="round" fill="none" />
          <ellipse cx="16" cy="17" rx="5.5" ry="3.8" transform="rotate(-25 16 17)" fill="var(--crop-leaf)" />
          <ellipse cx="32" cy="15" rx="5.5" ry="3.8" transform="rotate(20 32 15)" fill="var(--crop-leaf-deep)" />
          <path d="M23 23C16 24 13 30 16 35C20 35 25 30 24 24Z" fill="var(--crop-leaf)" stroke="var(--crop-stroke)" strokeWidth="1.2" />
          <path d="M25 26C32 27 35 33 32 38C28 38 23 33 24 27Z" fill="var(--crop-gold)" stroke="var(--crop-stroke)" strokeWidth="1.2" />
          <circle cx="19.5" cy="29.5" r="2" fill="var(--crop-gold)" />
          <circle cx="28.5" cy="32.5" r="2" fill="var(--crop-leaf-deep)" />
        </>
      );

    case 'sunflower':
      return (
        <>
          <path d="M24 43V26" stroke="var(--crop-stem)" strokeWidth="2.6" strokeLinecap="round" />
          <path d="M24 37C17 36 13 31 14 26C18 27 22 31 24 35Z" fill="var(--crop-leaf)" />
          <path d="M24 37C31 36 35 31 34 26C30 27 26 31 24 35Z" fill="var(--crop-leaf-deep)" />
          <g fill="var(--crop-gold)">
            <ellipse cx="24" cy="8.5" rx="2.6" ry="5" />
            <ellipse cx="24" cy="27.5" rx="2.6" ry="5" />
            <ellipse cx="14.5" cy="18" rx="5" ry="2.6" />
            <ellipse cx="33.5" cy="18" rx="5" ry="2.6" />
            <ellipse cx="17.2" cy="11.2" rx="2.6" ry="4.8" transform="rotate(-45 17.2 11.2)" />
            <ellipse cx="30.8" cy="24.8" rx="2.6" ry="4.8" transform="rotate(-45 30.8 24.8)" />
            <ellipse cx="30.8" cy="11.2" rx="2.6" ry="4.8" transform="rotate(45 30.8 11.2)" />
            <ellipse cx="17.2" cy="24.8" rx="2.6" ry="4.8" transform="rotate(45 17.2 24.8)" />
          </g>
          <circle cx="24" cy="18" r="6.2" fill="var(--crop-earth)" stroke="var(--crop-gold-shade)" strokeWidth="1.5" />
          <circle cx="22" cy="16.5" r="1" fill="var(--crop-gold)" />
          <circle cx="26" cy="16.5" r="1" fill="var(--crop-gold)" />
          <circle cx="24" cy="19.8" r="1" fill="var(--crop-gold)" />
        </>
      );

    case 'cotton':
      return (
        <>
          <path d="M24 43V27" stroke="var(--crop-earth)" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M16 27C18 31 21 33 24 33C27 33 30 31 32 27L28 24H20L16 27Z" fill="var(--crop-leaf-deep)" />
          <circle cx="19.5" cy="20" r="6" fill="var(--crop-boll)" stroke="var(--crop-stroke)" strokeWidth="1.3" />
          <circle cx="28.5" cy="20" r="6" fill="var(--crop-boll)" stroke="var(--crop-stroke)" strokeWidth="1.3" />
          <circle cx="24" cy="14.5" r="6.5" fill="var(--crop-boll)" stroke="var(--crop-stroke)" strokeWidth="1.3" />
          <path d="M24 27L20 22M24 27L28 22M24 27V19" stroke="var(--crop-earth)" strokeWidth="1.5" strokeLinecap="round" />
        </>
      );

    case 'dry_beans':
      return (
        <>
          <path d="M15 34C13 24 19 14 29 12C32 19 27 31 15 34Z" fill="var(--crop-gold)" stroke="var(--crop-stroke)" strokeWidth="1.4" />
          <circle cx="20" cy="25" r="2.6" fill="var(--crop-warm)" />
          <circle cx="24.5" cy="19.5" r="2.6" fill="var(--crop-warm)" />
          <ellipse cx="30" cy="29" rx="5.5" ry="4" transform="rotate(-18 30 29)" fill="var(--crop-leaf)" stroke="var(--crop-stroke)" strokeWidth="1.3" />
          <path d="M28 29C29 28 31 28 32 29" stroke="var(--crop-boll)" strokeWidth="1.4" strokeLinecap="round" />
        </>
      );

    case 'alfalfa':
      return (
        <>
          <path d="M24 43V20" stroke="var(--crop-stem)" strokeWidth="2.4" strokeLinecap="round" />
          <circle cx="18" cy="27" r="4.5" fill="var(--crop-leaf)" />
          <circle cx="30" cy="27" r="4.5" fill="var(--crop-leaf-deep)" />
          <circle cx="24" cy="22" r="4.5" fill="var(--crop-leaf)" />
          <circle cx="21" cy="13" r="3.2" fill="var(--crop-bloom)" />
          <circle cx="27" cy="13" r="3.2" fill="var(--crop-bloom)" />
          <circle cx="24" cy="9.5" r="3.2" fill="var(--crop-bloom)" />
        </>
      );

    case 'rice':
      return (
        <>
          <path d="M13 39C17 37 21 37 24 39C27 41 31 41 35 39" stroke="var(--crop-water)" strokeWidth="2" strokeLinecap="round" fill="none" />
          <path d="M22 36C21 25 24 16 32 11" stroke="var(--crop-stem)" strokeWidth="2.2" strokeLinecap="round" fill="none" />
          <path d="M20 36C18 27 15 21 12 17" stroke="var(--crop-leaf)" strokeWidth="2.2" strokeLinecap="round" fill="none" />
          <ellipse cx="27" cy="15" rx="2.2" ry="3.4" transform="rotate(30 27 15)" fill="var(--crop-gold)" />
          <ellipse cx="31" cy="13" rx="2.2" ry="3.4" transform="rotate(35 31 13)" fill="var(--crop-gold)" />
          <ellipse cx="33" cy="18" rx="2.2" ry="3.4" transform="rotate(45 33 18)" fill="var(--crop-gold)" />
          <ellipse cx="28" cy="21" rx="2.1" ry="3.2" transform="rotate(35 28 21)" fill="var(--crop-gold)" />
        </>
      );

    case 'small_grain':
      return (
        <>
          <path d="M18 42V15M24 42V11M30 42V16" stroke="var(--crop-stem)" strokeWidth="2" strokeLinecap="round" />
          <ellipse cx="18" cy="14" rx="2.6" ry="5" fill="var(--crop-gold)" />
          <ellipse cx="24" cy="10" rx="2.8" ry="5.5" fill="var(--crop-gold)" />
          <ellipse cx="30" cy="15" rx="2.6" ry="5" fill="var(--crop-gold)" />
          <path d="M14 36C16 29 20 26 24 26C28 26 32 29 34 36" stroke="var(--crop-leaf)" strokeWidth="2.2" strokeLinecap="round" fill="none" />
        </>
      );

    case 'cover_crop':
    default:
      return (
        <>
          <path d="M11 29H37" stroke="var(--crop-earth)" strokeWidth="2" strokeLinecap="round" />
          <path d="M24 29V13" stroke="var(--crop-stem)" strokeWidth="2.4" strokeLinecap="round" />
          <path d="M24 22C17 22 14 17 15 11C20 12 23 16 24 21Z" fill="var(--crop-leaf)" />
          <path d="M24 20C31 20 34 15 33 9C28 10 25 14 24 19Z" fill="var(--crop-leaf-deep)" />
          <path d="M24 29C22 34 18 37 15 40M24 29V41M24 29C26 34 30 37 33 40" stroke="var(--crop-gold-shade)" strokeWidth="1.6" strokeLinecap="round" fill="none" />
        </>
      );
  }
}

export function CropIllustration({ cropId, size = 'tile' }: CropIllustrationProps) {
  // A real photo where there is one; the drawing stays for crops without one.
  const [photo] = photoKeys(cropId);
  if (photo) {
    return (
      <span className={`crop-pic crop-pic--${size} crop-pic--photo`} data-crop={photo} aria-hidden="true">
        <img src={photoSrc(photo)} alt="" width={400} height={300} loading="lazy" decoding="async" />
      </span>
    );
  }
  const key = normalizeCropKey(cropId);
  return (
    <span className={`crop-pic crop-pic--${size}`} data-crop={key} aria-hidden="true">
      <svg viewBox="0 0 48 48" className="crop-pic__svg" focusable="false">
        {renderArtwork(key)}
      </svg>
    </span>
  );
}
