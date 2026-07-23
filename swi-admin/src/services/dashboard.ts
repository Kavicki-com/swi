// Fachada do dashboard — hoje 100% real (fan-out em api/dashboard.ts sobre
// admins/funcionários/relatórios/tarefas/clima, com os vitais mock sobrepostos).
// O eixo DATA_BACKEND (mock vs amplify) morreu pro dashboard: os tipos e o
// dashboardApi vivem em api/dashboard.ts. Este re-export fino mantém os imports
// existentes (@/services/dashboard) resolvendo — mesmo movimento do Passo 4 em
// Reports, sem repontar os 4 consumidores.
export * from './api/dashboard'
