'use strict';

const Homey = require('homey');
const { randomUUID } = require('crypto');

module.exports = class IRRemoteDriver extends Homey.Driver {

  async onPair(session) {
    session.setHandler('create_remote', async ({ name }) => ({
      name: this.validateName(name),
      data: { id: randomUUID() },
      store: { buttons: [] },
    }));

    session.setHandler('validate_import', async (data) => this.validateImport(data));
  }

  async onRepair(session, device) {
    session.setHandler('get_remote', async () => ({
      name: device.getName(),
      buttons: device.getButtons(),
    }));

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

  validateImport(data) {
    if (!data || data.schemaVersion !== 1 || !Array.isArray(data.remotes)) {
      throw new Error('Invalid IR Remote export file');
    }

    return data.remotes.map((remote) => ({
      name: this.validateName(remote.name),
      data: { id: randomUUID() },
      store: {
        buttons: this.homey.app.validateButtons(remote.buttons),
      },
    }));
  }

};
