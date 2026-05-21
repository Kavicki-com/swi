// Demo seed data: 5 admins shown in the "Selecionar responsáveis" modal
// (Figma 364:18017). Previously lived inside the modal component file
// `components/modals/ResponsiblesModal.tsx`, which entangled UI with
// data — `reports/new.tsx` had to import a singleton from a UI module
// just to read selection state. Extracted per the audit cleanup in
// 2026-05-17-mobile-routes-audit.md.
//
// Names are fictional. Replace with a query against the admins API in
// Phase 2.

export interface Admin {
  id: string;
  name: string;
  age: number;
  blood: string;
}

export const ADMINS: ReadonlyArray<Admin> = [
  { id: 'elisa', name: 'Elisa Siqueira Jordão', age: 32, blood: 'O+' },
  { id: 'mathias', name: 'Mathias Campos S.', age: 32, blood: 'AB-' },
  { id: 'joao', name: 'João Soares Ribeiro', age: 32, blood: 'A+' },
  { id: 'pedro', name: 'Pedro Carvalho Lima', age: 28, blood: 'O-' },
  { id: 'rita', name: 'Rita Sampaio Almeida', age: 41, blood: 'B+' },
];
