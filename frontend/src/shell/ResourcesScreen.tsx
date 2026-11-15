import type { Dataset } from '../api/types';
import { Card, CardState, Reminder } from '../components/ui/kit';
import { SourceList } from '../components/ui/SourceList';
import { DATA_SOURCES } from '../content/sources';

const METHODS = [
  { name: 'FAO-56 Crop Evapotranspiration', provider: 'Allen and others, FAO Irrigation and Drainage Paper 56, 1998', url: 'https://www.fao.org/4/x0490e/x0490e00.htm' },
];

const nasa = DATA_SOURCES.filter((source) => /NASA/.test(source.provider) || /^NASA/.test(source.name));
const others = DATA_SOURCES.filter((source) => !nasa.includes(source));

function SourceGroup({ title, sources }: { title: string; sources: { name: string; provider: string; url: string }[] }) {
  return (
    <section className="card resources__group" aria-labelledby={`resources-${title}`}>
      <h2 id={`resources-${title}`} className="card__title">
        {title}
      </h2>
      <ul className="resources__list">
        {sources.map((source) => (
          <li key={source.name}>
            <a href={source.url} target="_blank" rel="noreferrer">
              {source.name}
            </a>
            <span className="secondary">{source.provider}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The sources behind this field's results, then every data source and method the tool uses, each linked to its own page. */
export function ResourcesScreen({ fieldName, datasets }: { fieldName: string | null; datasets: Dataset[] | null }) {
  return (
    <>
      <header className="page-head">
        <h1 className="page-title">Resources</h1>
        <p className="lead">The data behind your field's results, and every source and method Leyar Shift uses, each linked to its own page.</p>
      </header>
      <Card title={fieldName ? `Data used for ${fieldName}` : 'Data used for your field'}>
        {datasets ? (
          <SourceList datasets={datasets} />
        ) : (
          <CardState kind="empty" title="No field yet">
            Set up a field, or open a sample, to see which sources cover it.
          </CardState>
        )}
      </Card>
      <h2 className="resources__heading">Every data source Leyar Shift uses</h2>
      <div className="resources">
        <SourceGroup title="NASA data" sources={nasa} />
        <SourceGroup title="Partner and other data" sources={others} />
        <SourceGroup title="Methods" sources={METHODS} />
      </div>
      <Reminder />
    </>
  );
}
