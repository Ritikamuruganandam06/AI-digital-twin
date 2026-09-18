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
