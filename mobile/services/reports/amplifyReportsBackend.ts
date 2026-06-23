import { generateClient } from 'aws-amplify/data';
import type { Report, ReportInput, ReportsBackend } from './types';

// Deploy-gated amplify backend for the Relatórios slice. Mirrors
// services/profile/amplifyProfileBackend.ts: an untyped client keeps mobile
// isolated from swi-backend's Schema type. There is NO generated Schema /
// amplify_outputs.json yet (no AWS account), so the real models.Report.* and
// Storage calls are kept guarded/commented and the methods throw until
// Phase 6 deploy wires the generated client. The point: this typechecks and
// getReportsBackend can import it; the mock-flag path never calls it.
const client = generateClient();

export const amplifyReportsBackend: ReportsBackend = {
  async list(): Promise<Report[]> {
    // Phase 6 (after `ampx sandbox` generates the typed client):
    //   const { data } = await (client as any).models.Report.list();
    //   return (data ?? []).map(toReport);
    void client;
    throw new Error('amplifyReportsBackend.list: deploy-gated (sem conta AWS)');
  },
  async get(id: string): Promise<Report | null> {
    // Phase 6:
    //   const { data } = await (client as any).models.Report.get({ id });
    //   return data ? toReport(data) : null;
    void id;
    throw new Error('amplifyReportsBackend.get: deploy-gated (sem conta AWS)');
  },
  async create(input: ReportInput): Promise<Report> {
    // Phase 6: upload input.imageUris to Storage, then
    //   const { data } = await (client as any).models.Report.create({ ... });
    //   return toReport(data);
    void input;
    throw new Error('amplifyReportsBackend.create: deploy-gated (sem conta AWS)');
  },
};
