import { DiagnosticPing, type DiagnosticPingDocument } from '../models/diagnosticPing.model';

export interface DiagnosticPingRecord {
  id: string;
  message: string;
  createdAt: Date;
}

function toRecord(doc: DiagnosticPingDocument): DiagnosticPingRecord {
  return {
    id: doc._id.toString(),
    message: doc.message,
    createdAt: doc.createdAt,
  };
}

/**
 * Data-access layer: controllers never import the Mongoose model directly.
 * This is the seam later phases' repositories (services, incidents, agent
 * executions) will follow, and the seam that makes it possible to unit-test
 * a controller against a fake repository without a database at all.
 */
export const diagnosticPingRepository = {
  async create(message: string): Promise<DiagnosticPingRecord> {
    const doc = await DiagnosticPing.create({ message });
    return toRecord(doc);
  },

  async findRecent(limit: number): Promise<DiagnosticPingRecord[]> {
    const docs = await DiagnosticPing.find().sort({ createdAt: -1 }).limit(limit).exec();
    return docs.map(toRecord);
  },
};
