// Fachada do monitoramento — Fase 3: derivado do diretório REAL da org com
// vitais simulados rotulados (api/monitoring.ts). O eixo DATA_BACKEND
// (mock vs amplify) morreu pro monitoring — mesmo movimento do dashboard.
// Re-export fino mantém os imports existentes (@/services/monitoring).
export * from './api/monitoring'
