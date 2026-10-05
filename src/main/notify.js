'use strict';
// Native notifications (Windows: a toast in the Notification Center; macOS: Notification Center).

const path = require('path');
const { Notification } = require('electron');

const ICON = path.join(__dirname, '..', 'assets', 'icon.png');
// references kept until the notification closes; otherwise the click can be lost (garbage collection)
const alive = new Set();

/** @returns {boolean} false if the system doesn't support notifications */
function notify({ title, body, onClick }) {
  if (!Notification.isSupported()) return false;
  const n = new Notification({ title, body, icon: ICON, silent: false });
  alive.add(n);
  const drop = () => alive.delete(n);
  n.on('close', drop);
  n.on('failed', (_e, err) => { drop(); console.error('[notify] the notification failed:', err); });
  n.on('click', () => { drop(); if (onClick) onClick(); });
  n.on('show', () => console.log(`[notify] shown: ${title}`));
  n.show();
  return true;
}

module.exports = { notify };
