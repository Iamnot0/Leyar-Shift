/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Call the backend directly at this origin instead of through the dev-server proxy. */
  readonly VITE_API_BASE_URL?: string;
  /** Place-search endpoint. Set it to an empty string to turn place search off. */
  readonly VITE_GEOCODER_URL?: string;
}
