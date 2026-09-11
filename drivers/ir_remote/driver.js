'use strict';

const Homey = require('homey');
const { randomUUID } = require('crypto');
const RemoteBackup = require('../../lib/RemoteBackup');

module.exports = class IRRemoteDriver extends Homey.Driver {

  async onPair(session) {
    session.setHandler('create_remote', async ({ name }) => ({
      name: this.validateName(name),
      data: { id: randomUUID() },
      store: { buttons: [] },
    }));
  }

  async onRepair(session, device) {
    session.setHandler('get_remote', async () => ({
      name: device.getName(),
      buttons: device.getButtons(),
    }));

    session.setHandler('export_remote', async () => RemoteBackup.create({
      appId: this.homey.app.id,
      name: device.getName(),
      buttons: device.getButtons(),
    }));

    session.setHandler('import_remote', async (data) => {
      const remote = RemoteBackup.extractRemote(data);
      const name = this.validateName(remote.name);
      const buttons = this.homey.app.validateButtons(remote.buttons);

      // Restore the selected Homey device in place. Its device identity and
      // satellite/Bridge selection remain untouched; only user-managed remote
      // data from the backup is restored.
      await device.setButtons(buttons);
      await device.setName(name);

      return {
        name: device.getName(),
        buttons: device.getButtons(),
      };
    });

    session.setHandler('add_button', async (button) => {
      const buttons = device.getButtons();
      const [validated] = this.homey.app.validateButtons([{
        ...button,
        id: randomUUID(),
      }]);
      buttons.push(validated);
      await device.setButtons(buttons);
      return buttons;
    });

    session.setHandler('update_button', async ({ id, ...changes }) => {
      const buttons = device.getButtons();
      const index = buttons.findIndex((button) => button.id === id);
      if (index < 0) throw new Error('Button not found');
      const [validated] = this.homey.app.validateButtons([{
        ...buttons[index],
        ...changes,
        id,
      }]);
      buttons[index] = validated;
      await device.setButtons(buttons);
      return buttons;
    });

    session.setHandler('delete_button', async (buttonId) => {
      const buttons = device.getButtons();
      const filtered = buttons.filter((button) => button.id !== buttonId);
      if (filtered.length === buttons.length) throw new Error('Button not found');
      await device.setButtons(filtered);
      return filtered;
    });

    session.setHandler('learn_button', async (buttonId) => {
      const buttons = device.getButtons();
      const index = buttons.findIndex((button) => button.id === buttonId);
      if (index < 0) throw new Error('Button not found');
      buttons[index] = {
        ...buttons[index],
        code: await this.homey.app.mqtt.learn(),
      };
      await device.setButtons(buttons);
      return buttons;
    });

    session.setHandler('send_button', async (buttonId) => {
      await device.sendButton(buttonId);
      return true;
    });
  }

  validateName(name) {
    if (typeof name !== 'string' || !name.trim()) throw new Error('Name is required');
    return name.trim().slice(0, 80);
  }

};
