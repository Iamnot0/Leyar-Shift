import type { ForecastDay, MonthOutlook, Reading, RecentRain, SoilMoisture, YearClimate } from '../api/fieldBriefing';
import { Card, CardState, Pill, Tile, type PillTone } from '../components/ui/kit';
import { MONTHS, formatDay, joinList } from '../lib/format';
import { groundOf, type Ground } from './ground';
import { REAL_RAIN_MM, dayLabel, degrees, monthOf, percent, rainWords } from './words';

export { SuggestedCropsCard, type PredictionHorizon } from './SuggestedCropsCard';

interface Judged {
  pill: string;
  tone: PillTone;
}

function judgeWeather(today: ForecastDay, ground: Ground | null): Judged {
  if (today.frost) return { pill: 'Frost tonight', tone: 'care' };
  if (today.heat) return { pill: 'Very hot', tone: 'care' };
  if (today.rainMm >= REAL_RAIN_MM) return { pill: 'Rain today', tone: 'care' };
  if (ground?.state === 'wet') return { pill: 'Dry day', tone: 'good' };
  return { pill: 'Good for field work', tone: 'good' };
}

const chanceNote = (day: ForecastDay) =>
  day.rainChance !== null && (day.rainMm >= REAL_RAIN_MM || day.rainChance >= 0.2) ? ` (${percent(day.rainChance)} chance)` : '';

function rainSentence(today: ForecastDay, tomorrow: ForecastDay | undefined): string {
  const first =
    today.rainMm >= REAL_RAIN_MM
      ? `About ${Math.round(today.rainMm)} mm of rain is expected today${chanceNote(today)}.`
      : `No real rain is expected today${chanceNote(today)}.`;
  if (!tomorrow) return first;
  if (tomorrow.rainMm >= REAL_RAIN_MM) {
    return `${first} About ${Math.round(tomorrow.rainMm)} mm is expected tomorrow${chanceNote(tomorrow)}.`;
  }
  return `${first} Tomorrow looks dry${today.rainMm >= REAL_RAIN_MM ? '' : ' too'}.`;
}

interface WeatherProps {
  days: ForecastDay[] | null;
  loading: boolean;
  why: string;
  onRetry: (() => void) | null;
}

export function WeatherCard({ ground, days, loading, why, onRetry }: WeatherProps & { ground: Ground | null }) {
  if (!days) {
    return (
      <Card title="Weather today" smallTitle>
        {loading ? (
          <CardState kind="loading" title="Fetching today’s weather…" />
        ) : (
          <CardState kind={onRetry ? 'error' : 'empty'} title="No forecast for your field right now" action={onRetry ? { label: 'Try again', run: onRetry } : undefined}>
            {why}
          </CardState>
        )}
      </Card>
    );
  }
  const [today, tomorrow] = days;
  const judged = judgeWeather(today, ground);
  return (
    <Card title="Weather today" smallTitle aside={<Pill tone={judged.tone}>{judged.pill}</Pill>}>
      <p className="reading__value">
        <span className="reading__big number">{degrees(today.highC)}</span>
        <span className="secondary">by day, {degrees(today.lowC)} tonight</span>
      </p>
      <p>{rainSentence(today, tomorrow)}</p>
    </Card>
  );
}

export function RainCard({ rain }: { rain: Reading<RecentRain> }) {
  if (!rain.available) {
    return (
      <Card title="Rain" smallTitle>
        <CardState kind="empty" title="Not available yet">
          {rain.why}
        </CardState>
      </Card>
    );
  }
  const dry = rain.last7DaysMm < REAL_RAIN_MM;
  return (
    <Card title="Rain" smallTitle aside={<Pill tone={dry ? 'care' : 'good'}>{dry ? 'No rain this week' : 'Rain this week'}</Pill>}>
      <p className="reading__value">
        <span className="reading__big number">{rainWords(rain.last7DaysMm) === 'Dry' ? '0 mm' : rainWords(rain.last7DaysMm)}</span>
        <span className="secondary">in the last 7 days</span>
      </p>
      <p>
        {Math.round(rain.last30DaysMm)} mm in the last 30 days.{rain.lastRealRain ? ` The last real rain was on ${formatDay(rain.lastRealRain)}.` : ' No real rain in that time.'}
      </p>
      {rain.readThrough && <p className="caption">Through {formatDay(rain.readThrough)}, {rain.source}.</p>}
    </Card>
  );
}

function judgeSoil(surface: Reading<SoilMoisture>, rootZone: Reading<SoilMoisture>): Judged | null {
  const ground = groundOf(surface, rootZone);
  if (!ground) return null;
  if (ground.state === 'dry') return { pill: 'Drier than usual', tone: 'care' };
  if (ground.state === 'wet') return { pill: 'Wetter than usual', tone: 'care' };
  return { pill: 'About usual', tone: 'good' };
}

function SoilRow({ label, reading, scale }: { label: string; reading: Reading<SoilMoisture>; scale: number }) {
  if (!reading.available) {
    return (
      <div className="soil__row">
        <p className="soil__head">
          <span>{label}</span>
          <span className="caption">{reading.why}</span>
        </p>
        <div className="soil__track" aria-hidden="true" />
      </div>
    );
  }
  const usual = reading.usual;
  return (
    <div className="soil__row">
      <p className="soil__head">
        <span>{label}</span>
        <span>
          <strong className="number">{percent(reading.now)}</strong>
          {usual !== null && <span className="caption"> usual {percent(usual)}</span>}
        </span>
      </p>
      <div className="soil__track" role="img" aria-label={`${label}: ${percent(reading.now)} soil wetness${usual !== null ? `. Usual for ${monthOf(reading.readOn)}: ${percent(usual)}` : ''}.`}>
        <span className="soil__fill" style={{ inlineSize: `${(reading.now / scale) * 100}%` }} />
        {usual !== null && <span className="soil__usual" style={{ insetInlineStart: `${(usual / scale) * 100}%` }} />}
      </div>
    </div>
  );
}

interface SoilProps {
  surface: Reading<SoilMoisture>;
  rootZone: Reading<SoilMoisture>;
  loading: boolean;
}

export function SoilCard({ surface, rootZone, loading }: SoilProps) {
  if (!rootZone.available && !surface.available) {
    return (
      <Card title="Soil moisture" smallTitle>
        {loading ? <CardState kind="loading" title="Reading the soil moisture for your field…" /> : <CardState kind="empty" title="No soil moisture reading">{rootZone.why}</CardState>}
      </Card>
    );
  }
  const known = [surface, rootZone].flatMap((reading) => (reading.available ? [reading] : []));
  const judged = judgeSoil(surface, rootZone);
  // The bars share one scale, with room past the wettest value shown, so the two can be compared by eye.
  const largest = Math.max(0.2, ...known.flatMap((reading) => [reading.now, reading.usual ?? 0, reading.usualHigh ?? 0]));
  const scale = Math.ceil((largest * 1.25) / 0.1) * 0.1;
  const latest = known[0];
  return (
    <Card title="Soil moisture" smallTitle aside={judged && <Pill tone={judged.tone}>{judged.pill}</Pill>}>
      <div className="soil">
        <SoilRow label="Top of the soil" reading={surface} scale={scale} />
        <SoilRow label="Where the roots are" reading={rootZone} scale={scale} />
      </div>
      <ul className="legend">
        <li>
          <span className="legend__swatch" data-kind="usual" aria-hidden="true" />
          The line shows what is usual for {monthOf(latest.readOn)}
        </li>
      </ul>
      <p className="caption">
        {formatDay(latest.readOn)}, {latest.source} (wide-area grid, not your field alone).
      </p>
    </Card>
  );
}

export function WeekOutlook({ days, loading, why, waterLossMm, onRetry }: WeatherProps & { waterLossMm: number | null }) {
  if (!days) {
    return (
      <Card className="wide" title="The next 7 days">
        {loading ? (
          <CardState kind="loading" title="Fetching the forecast…" />
        ) : (
          <CardState kind={onRetry ? 'error' : 'empty'} title="No forecast for your field right now" action={onRetry ? { label: 'Try again', run: onRetry } : undefined}>
            {why}
          </CardState>
        )}
      </Card>
    );
  }
  const total = days.reduce((sum, day) => sum + day.rainMm, 0);
  const rain = total < REAL_RAIN_MM ? 'No real rain is expected' : `About ${Math.round(total)} mm of rain is expected`;
  const summary = waterLossMm === null ? `${rain} over the next ${days.length} days.` : `${rain} over the next ${days.length} days. The soil will lose about ${Math.round(waterLossMm)} mm in that time.`;

  return (
    <Card className="wide" title="The next 7 days">
      <p>{summary}</p>
      <div className="scroll-x" tabIndex={0} role="group" aria-label="Day by day. Scroll sideways to see every day.">
        <ol className="days">
          {days.map((day, index) => (
            <li key={day.date} className="day" data-today={index === 0}>
              <span className="day__label">{dayLabel(day.date, index)}</span>
              <span className="day__high number">
                <span className="visually-hidden">High </span>
                {degrees(day.highC)}
              </span>
              <span className="day__detail">{degrees(day.lowC)} night</span>
              <span className="day__detail">{rainWords(day.rainMm)}</span>
              {day.frost && <strong className="day__detail">Frost</strong>}
              {day.heat && <strong className="day__detail">Very hot</strong>}
            </li>
          ))}
        </ol>
      </div>
      <p className="caption">This is a forecast. It is less sure with each day ahead.</p>
    </Card>
  );
}

const LABELLED_MONTHS = 4;

/** Usual rain for each month. The four wettest months carry their value; every value is in the description. */
function RainChart({ monthlyRainMm }: { monthlyRainMm: number[] }) {
  const most = Math.max(...monthlyRainMm, 1);
  const labelled = new Set(
    monthlyRainMm
      .map((mm, month) => ({ mm, month }))
      .sort((a, b) => b.mm - a.mm)
      .slice(0, LABELLED_MONTHS)
      .map((entry) => entry.month),
  );
  const described = monthlyRainMm.map((mm, month) => `${MONTHS[month]} ${Math.round(mm)} mm`).join(', ');
  return (
    <div className="scroll-x" tabIndex={0} role="group" aria-label="Usual rain by month. Scroll sideways to see the whole year.">
      <div className="rain-chart" role="img" aria-label={`Usual rain by month: ${described}.`}>
        {monthlyRainMm.map((mm, month) => (
          <div key={MONTHS[month]} className="rain-chart__month">
            <div className="rain-chart__column">
              {labelled.has(month) && <span className="rain-chart__value">{Math.round(mm)}</span>}
              <span className="rain-chart__bar" style={{ blockSize: `${(mm / most) * 100}%` }} />
            </div>
            <span>{MONTHS[month].slice(0, 3)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

interface YearProps {
  climate: Reading<YearClimate>;
  loading: boolean;
}

export function MonthOutlookCard({ outlook, loading }: { outlook: Reading<MonthOutlook>; loading: boolean }) {
  if (!outlook.available) {
    return (
      <Card className="wide" title="The next month">
        {loading ? (
          <CardState kind="loading" title="Reading the long weather record for your field…" />
        ) : (
          <CardState kind="empty" title="Not available yet">
            {outlook.why} It will show the rain to expect, the coldest nights and the chance of frost, from the long weather record.
          </CardState>
        )}
      </Card>
    );
  }
  const monthName = MONTHS[outlook.month - 1] ?? 'next month';
  const span = outlook.recordYears ? `the record from ${outlook.recordYears}` : 'the long weather record';
  return (
    <Card className="wide" title="The next month">
      <p>
        What {monthName} usually brings here, from {span}.{outlook.usualPattern && ' This is the usual pattern, not a day-by-day forecast.'}
      </p>
      <div className="tile-grid">
        <Tile label="Rain to expect" value={`About ${Math.round(outlook.rainMm.value)} mm`} note={outlook.rainMm.basis} />
        <Tile label="Coldest nights" value={`About ${degrees(outlook.coldestNightC.value)}`} note={outlook.coldestNightC.basis} />
        <Tile label={`Frost in ${monthName}`} value={outlook.frost.words} note={outlook.frost.basis} />
      </div>
    </Card>
  );
}

function rainSeasonSentence(monthlyRainMm: number[] | null): string {
  if (!monthlyRainMm || monthlyRainMm.length !== 12) return '';
  const total = monthlyRainMm.reduce((sum, mm) => sum + mm, 0);
  if (total <= 0) return '';
  const top = monthlyRainMm
    .map((mm, month) => ({ mm, month }))
    .sort((a, b) => b.mm - a.mm)
    .slice(0, 3);
  const topSum = top.reduce((sum, entry) => sum + entry.mm, 0);
  const share = topSum / total;
  if (share < 0.5) return '';
  const inCalendarOrder = top.sort((a, b) => a.month - b.month).map((entry) => MONTHS[entry.month]);
  return ` About ${Math.round(share * 100)}% of it falls in ${joinList(inCalendarOrder)}.`;
}

export function YearOutlook({ climate, loading }: YearProps) {
  if (!climate.available) {
    return (
      <Card className="wide" title="A usual year on your field">
        {loading ? <CardState kind="loading" title="Reading the long weather record for your field…" /> : <CardState kind="empty" title="No long weather record">{climate.why}</CardState>}
      </Card>
    );
  }
  const rain = Math.round(climate.usualRainMm);
  const dryBasis = climate.interval === 'p10_p90' ? 'About 1 year in 10 brings less than this.' : 'The low end of what the record shows.';
  const hotNote =
    climate.hottestDayC !== null
      ? `Peak day about ${degrees(climate.hottestDayC)}.${climate.hotDayWords ? ` ${climate.hotDayWords}.` : ''}`
      : climate.hotDayWords;
  return (
    <Card className="wide" title="A usual year on your field">
      <p>
        This field gets about {rain} mm of rain in a usual year{climate.recordYears ? `, going by the record from ${climate.recordYears}` : ''}.{rainSeasonSentence(climate.monthlyRainMm)}
      </p>
      {climate.monthlyRainMm ? (
        <>
          <RainChart monthlyRainMm={climate.monthlyRainMm} />
          <p className="caption">
            Usual rain in each month, in mm{climate.recordYears ? `, ${climate.recordYears}` : ''}.
          </p>
        </>
      ) : (
        <CardState kind="empty" title="Rain month by month is not available yet">
          We have the yearly total, but the month-by-month pattern is not connected to this page yet.
        </CardState>
      )}
      <div className="tile-grid">
        {climate.dryYearMm !== null && <Tile label="A dry year" value={`Under ${Math.round(climate.dryYearMm)} mm`} note={dryBasis} />}
        {climate.hotDaysPerYear !== null && <Tile label="The hottest days" value={`${Math.round(climate.hotDaysPerYear)} a year`} note={hotNote} />}
        {climate.frostDaysPerYear !== null && (
          <Tile
            label="Frost nights"
            value={Math.round(climate.frostDaysPerYear) === 0 ? 'None most years' : `${Math.round(climate.frostDaysPerYear)} a year`}
            note={climate.coldestNightC !== null ? `Coldest night about ${degrees(climate.coldestNightC)}.` : null}
          />
        )}
      </div>
      <p className="caption">This is the usual pattern, not a day-by-day forecast.</p>
    </Card>
  );
}
