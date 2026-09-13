'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const RemoteBackup = require('../lib/RemoteBackup');

test('creates a schema v3 backup for exactly one remote', () => {
  const buttons = [
    {
      id: 'button-1',
      name: 'Power',
      type: 'switch_toggle',
      repetitions: 1,
    },
  ];
  const backup = RemoteBackup.create({
    appId: 'de.ftedv.irremote',
    name: 'Living room TV',
    buttons,
    output: {
      type: 'esphome',
      mqttSendTopic: 'homey/ir/living-room/send',
    },
    exportedAt: '2026-09-11T13:00:00.000Z',
  });

  assert.deepEqual(backup, {
    schemaVersion: 3,
    appId: 'de.ftedv.irremote',
    exportedAt: '2026-09-11T13:00:00.000Z',
    remote: {
      name: 'Living room TV',
      output: {
        type: 'esphome',
        mqttSendTopic: 'homey/ir/living-room/send',
      },
      buttons,
    },
  });
  assert.equal('remotes' in backup, false);
});

test('extracts a schema v3 single-remote backup', () => {
  const remote = {
    name: 'Amplifier',
    output: {
      type: 'esphome',
      mqttSendTopic: 'homey/ir/amplifier/send',
    },
    buttons: [{
      id: 'button-1',
      name: 'Mute',
      type: 'mute',
      repetitions: 1,
    }],
  };

  assert.deepEqual(RemoteBackup.extractRemote({
    schemaVersion: 3,
    remote,
  }), remote);
});

test('schema v2 backups default to Homey output', () => {
  const remote = {
    name: 'Old backup',
    buttons: [],
  };

  assert.deepEqual(RemoteBackup.extractRemote({
    schemaVersion: 2,
    remote,
  }), {
    ...remote,
    output: {
      type: 'homey',
      mqttSendTopic: '',
    },
  });
});

test('accepts a legacy schema v1 backup only when it contains one remote', () => {
  const remote = {
    name: 'Legacy',
    buttons: [],
  };
  assert.deepEqual(RemoteBackup.extractRemote({
    schemaVersion: 1,
    remotes: [remote],
  }), {
    ...remote,
    output: {
      type: 'homey',
      mqttSendTopic: '',
    },
  });

  assert.throws(
    () => RemoteBackup.extractRemote({
      schemaVersion: 1,
      remotes: [remote, remote],
    }),
    /multiple remotes/,
  );
});

test('rejects unsupported and malformed backup structures', () => {
  assert.throws(() => RemoteBackup.extractRemote(null), /Invalid IR Remote backup file/);
  assert.throws(
    () => RemoteBackup.extractRemote({ schemaVersion: 3 }),
    /remote is missing/,
  );
  assert.throws(
    () => RemoteBackup.extractRemote({ schemaVersion: 99 }),
    /Unsupported IR Remote backup schema/,
  );
});
