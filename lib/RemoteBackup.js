'use strict';

const CURRENT_SCHEMA_VERSION = 2;

class RemoteBackup {

  static create({ appId, name, buttons, exportedAt = new Date().toISOString() }) {
    if (typeof name !== 'string' || !name.trim()) throw new Error('Remote name is required');
    if (!Array.isArray(buttons)) throw new Error('Remote buttons must be an array');

    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      appId,
      exportedAt,
      remote: {
        name: name.trim(),
        buttons,
      },
    };
  }

  static extractRemote(data) {
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid IR Remote backup file');
    }

    if (data.schemaVersion === CURRENT_SCHEMA_VERSION) {
      if (!data.remote || typeof data.remote !== 'object') {
        throw new Error('Invalid IR Remote backup file: remote is missing');
      }
      return data.remote;
    }

    // Backwards compatibility for the old global schema. Importing it into one
    // repaired device is only unambiguous when the file contains exactly one remote.
    if (data.schemaVersion === 1 && Array.isArray(data.remotes)) {
      if (data.remotes.length !== 1) {
        throw new Error(
          'This legacy backup contains multiple remotes. Export/import is now per device; '
          + 'only legacy backups containing exactly one remote can be restored here.',
        );
      }
      return data.remotes[0];
    }

    throw new Error(`Unsupported IR Remote backup schema: ${data.schemaVersion}`);
  }

}

RemoteBackup.CURRENT_SCHEMA_VERSION = CURRENT_SCHEMA_VERSION;

module.exports = RemoteBackup;
