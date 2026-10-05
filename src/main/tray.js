'use strict';
// The system tray icon: the only safe place to quit the app,
// because the buddy, panel and timer windows don't show in the taskbar.

const path = require('path');
const { Tray, Menu, nativeImage } = require('electron');
const ID = require('../shared/app-identity');

function createTray({ onOpenPanel, onOpenStats, onToggleBuddy, onResetBuddy, onQuit, isBuddyVisible, sessionItems = () => [], recorderItems = () => [], captureItems = () => [] }) {
  const file = process.platform === 'win32' ? 'icon.ico' : 'tray.png';
  const tray = new Tray(nativeImage.createFromPath(path.join(__dirname, '..', 'assets', file)));
  tray.setToolTip(ID.NAME);

  const build = () => Menu.buildFromTemplate([
    { label: 'Open the window', click: () => onOpenPanel() },
    { label: 'Statistics', click: () => onOpenStats() },
    { type: 'separator' },
    ...sessionItems(),
    { type: 'separator' },
    ...recorderItems(),
    { type: 'separator' },
    ...captureItems(),
    { type: 'separator' },
    { label: isBuddyVisible() ? 'Hide the buddy' : 'Show the buddy', click: () => { onToggleBuddy(); refresh(); } },
    { label: 'Reset buddy position', click: () => onResetBuddy() },
    { type: 'separator' },
    { label: 'Quit', click: () => onQuit() },
  ]);
  const refresh = () => tray.setContextMenu(build());
  refresh();
  tray.on('click', () => onOpenPanel());
  return { tray, refresh };
}

module.exports = { createTray };
