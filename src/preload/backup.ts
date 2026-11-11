import type {
  BackupApi,
  BackupEntry,
  BackupReason,
  BackupSettings,
  RestoreResult,
} from '../shared/backup';
import { invoke } from './lib';

export const backup: BackupApi = {
  exportData: () => invoke('backup:export'),
  createSnapshot: (reason?: BackupReason) =>
    invoke('backup:snapshot-create', reason) as Promise<BackupEntry>,
  listSnapshots: () => invoke('backup:snapshot-list') as Promise<BackupEntry[]>,
  restoreSnapshot: (path: string) =>
    invoke('backup:snapshot-restore', path) as Promise<RestoreResult>,
  getSettings: () => invoke('backup:settings-get') as Promise<BackupSettings>,
  saveSettings: (input: BackupSettings) =>
    invoke('backup:settings-save', input) as Promise<BackupSettings>,
};
