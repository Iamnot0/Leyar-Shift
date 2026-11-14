import { createHttpClient, type ApiClient } from './client';
import { CONTRACT_VERSION, type Meta } from './types';

export interface Connection {
  client: ApiClient;
  meta: Meta;
  /** Set when the backend answers but speaks a different contract version than this app was built for. */
  versionWarning: string | null;
}

const sameMinorVersion = (a: string, b: string) => a.split('.').slice(0, 2).join('.') === b.split('.').slice(0, 2).join('.');

/** Connects to the data service and reads its vocabulary. Fails when the service cannot be reached. */
export async function connect(): Promise<Connection> {
  const client = createHttpClient(import.meta.env.VITE_API_BASE_URL ?? '');
  const meta = await client.getMeta();
  const version = meta.contract_version;
  const versionWarning = sameMinorVersion(version, CONTRACT_VERSION) ? null : `This app and the data service are on different versions (${CONTRACT_VERSION} and ${version}), so some values may not show.`;
  return { client, meta, versionWarning };
}
