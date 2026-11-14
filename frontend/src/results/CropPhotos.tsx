import type { Rotation } from '../api/types';
import { PHOTOS, photoCredit, photoKeys, photoSrc } from '../content/cropPhotos';

function keysOf(rotation: Rotation): string[] {
  const ids = rotation.years.flatMap((year) => [year.crop_id, ...(year.cover_crop_id ? [year.cover_crop_id] : [])]);
  return [...new Set(ids.flatMap(photoKeys))];
}

/** One photo per crop in the rotation, in the order they are grown. */
export function CropPhotos({ rotation }: { rotation: Rotation }) {
  const keys = keysOf(rotation);
  if (keys.length === 0) return null;
  return (
    <figure className="crop-photos">
      <ul className="crop-photos__list" aria-label={`The crops in ${rotation.label}`}>
        {keys.map((key) => (
          <li key={key} className="crop-photos__item">
            <a className="crop-photos__link" href={PHOTOS[key].source} target="_blank" rel="noreferrer">
              <img src={photoSrc(key)} alt={PHOTOS[key].alt} width={400} height={300} loading="lazy" decoding="async" />
              <span className="crop-photos__name">{PHOTOS[key].name}</span>
              <span className="visually-hidden">, photo source on Wikimedia Commons, opens in a new tab</span>
            </a>
          </li>
        ))}
      </ul>
      <figcaption className="crop-photos__credit caption">
        {photoCredit(keys)} Select a photo for its source.
      </figcaption>
    </figure>
  );
}
