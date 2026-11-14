import { useId } from 'react';
import { formatDay } from '../../lib/format';
import type { MapPicture, PictureChoice } from '../map/imagery';
import { Drawer } from './Drawer';

const SHARPEST = 'sharpest';
const NONE = 'none';
const PICTURE = 'picture:';
/** From here up, a picture is visibly soft once a single field fills the map. */
const SOFT_FROM_M = 10;

interface ImageryPickerProps {
  pictures: MapPicture[];
  choice: PictureChoice;
  /** The picture named and credited: the one chosen, or the sharpest that exists here. */
  shown: MapPicture | null;
  /** The picture kept under it while it loads. */
  backdrop: MapPicture | null;
  /** The picture chosen by hand does not exist here, so another one is shown. */
  choiceMissing: boolean;
  onChange: (choice: PictureChoice) => void;
}

function toValue(choice: PictureChoice): string {
  return choice.mode === 'picture' ? `${PICTURE}${choice.id}` : choice.mode === 'none' ? NONE : SHARPEST;
}

function toChoice(value: string): PictureChoice {
  if (value === NONE) return { mode: 'none' };
  return value.startsWith(PICTURE) ? { mode: 'picture', id: value.slice(PICTURE.length) } : { mode: 'sharpest' };
}

const detailWords = (metres: number) => (metres >= 1000 ? `${metres / 1000} km` : `${metres} m`);

function Credit({ picture, lead }: { picture: MapPicture; lead: string }) {
  return (
    <div className="credit">
      <p>
        {lead} {picture.attribution.replace(/\.$/, '')}.{picture.license && !picture.credit_links?.some((link) => link.label.includes(picture.license ?? '')) && ` ${picture.license}.`}
      </p>
      {picture.credit_links && (
        <ul className="credit-links" aria-label={`Source and licence: ${picture.title}`}>
          {picture.credit_links.map((link) => (
            <li key={link.href}>
              <a href={link.href} target="_blank" rel="noopener noreferrer">
                {link.label}
                <span className="visually-hidden"> (opens in a new tab)</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** One line naming whose picture is on the map, for a caption. The full credits sit behind the licence link. */
export function PhotoCredit({ shown }: { shown: MapPicture | null }) {
  return shown ? <>Photo: {shown.attribution.replace(/\.$/, '')}.</> : null;
}

/** Chooses the picture on the map. The picture is for finding your way only: it never carries risk. */
export function ImageryPicker({ pictures, choice, shown, backdrop, choiceMissing, onChange }: ImageryPickerProps) {
  const id = useId();
  const detail = shown?.native_resolution_m ?? null;
  // A layer with a range of dates shows one day of it. A yearly composite names its year in the title.
  const takenOn = shown?.time && shown.time.start !== shown.time.end ? shown.time.default : null;
  return (
    <div className="picture">
      <div className="field">
        <label htmlFor={id}>Map picture</label>
        <select id={id} value={toValue(choice)} onChange={(event) => onChange(toChoice(event.target.value))}>
          <option value={SHARPEST}>Sharpest available here</option>
          {pictures.map((picture) => (
            <option key={picture.id} value={`${PICTURE}${picture.id}`}>
              {picture.title}
            </option>
          ))}
          <option value={NONE}>No picture</option>
        </select>
      </div>
      {choiceMissing && <p className="note">That picture is not available here. Showing the sharpest one that is.</p>}
      {!shown && choice.mode !== 'none' && <p className="note">No picture could be loaded here. The field edge is still drawn.</p>}
      {shown && (
        <Drawer title="Photo credits and licence">
          <p className="secondary">
            {(choice.mode === 'sharpest' || choiceMissing) && `Showing: ${shown.title}. `}
            {takenOn && `Taken on ${formatDay(takenOn)}. `}
            It helps you find your way. It may not show the field as it is today.
          </p>
          <Credit picture={shown} lead="Credit:" />
          {backdrop && <Credit picture={backdrop} lead={`Underneath it: ${backdrop.title}. Credit:`} />}
          <p className="note">
            The map stops zooming in where the picture has no more detail.
            {detail !== null && detail >= SOFT_FROM_M && ` It shows about ${detailWords(detail)} of detail, so it looks soft close up.`}
            {backdrop && ' A coarser picture shows first and this one loads over it, so the map is never empty.'}
            {shown.detail && ' Close up it sharpens once the full-detail photo arrives, which can take 10 seconds or more.'}
          </p>
        </Drawer>
      )}
    </div>
  );
}
