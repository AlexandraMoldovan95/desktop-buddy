'use strict';
// The right-click menu in the panel (notes and fields): editing + text transforms + "Clean up text".
// A pure, tested function; the main process turns it into a Menu (main.js → panelContextMenu).
// Since 1.6.0 it has no spelling suggestions: the spellchecker was removed (see CLAUDE.md, "Portfolio 1.6.0").

/**
 * @param {object} p  params from the page's `context-menu` event
 * @returns {Array<object>} descriptions: separator | role | submenu | transform | clean
 */
function contextMenuModel(p) {
  const items = [];
  const flags = p.editFlags || {};
  if (p.isEditable) {
    items.push({ kind: 'role', role: 'undo', label: 'Undo', enabled: !!flags.canUndo });
    items.push({ kind: 'role', role: 'redo', label: 'Redo', enabled: !!flags.canRedo });
    items.push({ kind: 'separator' });
    items.push({ kind: 'role', role: 'cut', label: 'Cut', enabled: !!flags.canCut });
    items.push({ kind: 'role', role: 'copy', label: 'Copy', enabled: !!flags.canCopy });
    items.push({ kind: 'role', role: 'paste', label: 'Paste', enabled: !!flags.canPaste });
    items.push({ kind: 'role', role: 'selectAll', label: 'Select all', enabled: flags.canSelectAll !== false });
    if (p.formControlType === 'text-area') {
      const scope = p.selectionText ? 'the selection' : 'all text';
      items.push({ kind: 'separator' });
      items.push({ kind: 'submenu', label: `Change case of ${scope}`, items: [
        { kind: 'transform', value: 'upper', label: 'UPPERCASE' },
        { kind: 'transform', value: 'lower', label: 'lowercase' },
        { kind: 'transform', value: 'title', label: 'Title Case' },
        { kind: 'transform', value: 'sentence', label: 'Sentence case' },
      ] });
      items.push({ kind: 'clean', label: 'Clean up text…' });
    }
  } else if (p.selectionText) {
    items.push({ kind: 'role', role: 'copy', label: 'Copy', enabled: true });
  }
  while (items.length && items[items.length - 1].kind === 'separator') items.pop();
  return items;
}

// nothing listens on local port 9: if something still started the Chromium spellchecker, the dictionary download fails at once
const BLOCKED_DICTIONARY_URL = 'http://127.0.0.1:9/dictionary-download-blocked/';

module.exports = { contextMenuModel, BLOCKED_DICTIONARY_URL };
