// Pin cep-promise to its browser-safe bundle. The package's `main` field
// resolves to a UMD that does `require('node-fetch')` — fine in Node, broken
// in React Native (node-fetch isn't in the dep tree, Metro fails to bundle).
// The `browser` bundle uses the global `fetch` instead.
//
// Metro normally picks the `browser` field, but the EAS local build env was
// resolving `main` regardless — importing the file path directly removes
// the ambiguity. Types are declared inline since the package's own d.ts is
// scoped to `declare module "cep-promise"`.

// @ts-expect-error — explicit subpath import, no bundled types for this path.
import cepBrowser from 'cep-promise/dist/cep-promise-browser.min.js';

export interface CepResult {
  cep: string;
  state: string;
  city: string;
  street: string;
  neighborhood: string;
  service: string;
}

export interface CepConfigurations {
  timeout?: number;
  providers?: string[];
}

export const cep: (
  cepCode: string | number,
  configurations?: CepConfigurations,
) => Promise<CepResult> = cepBrowser as unknown as (
  cepCode: string | number,
  configurations?: CepConfigurations,
) => Promise<CepResult>;
