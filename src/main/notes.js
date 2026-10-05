'use strict';
// The rules for notes (pure, tested functions).
// Since 1.7.0 a note can have a reminder: remind = { at: ms, status: 'pending' | 'fired' | 'missed', firedAt? }.
const crypto = require('crypto');
const RT = require('../shared/reminder-time');

const REMIND_STATUSES = ['pending', 'fired', 'missed'];

const MAX_NOTE_LENGTH = 100000;
const MAX_NOTES = 1000;

function createNote(now = Date.now()) {
  return { id: crypto.randomUUID(), body: '', createdAt: now, updatedAt: now };
}

const MAX_EMPTY_NOTES = 5;

/**
 * A new empty note at the top. Older empty notes beyond MAX_EMPTY_NOTES are dropped (they are pruned at quit anyway),
 * so a page calling create in a loop cannot grow notes.json. Saving to a dropped id re-creates it (see saveNote).
 */
function addNewNote(notes, now = Date.now()) {
  const note = createNote(now);
  let empty = 0;
  const kept = notes.filter((n) => (n.body === '' && !n.remind ? ++empty < MAX_EMPTY_NOTES : true));
  if (kept.length >= MAX_NOTES) throw new Error(`You've reached the limit of ${MAX_NOTES} notes.`);
  return { note, notes: [note, ...kept] };
}

/** Saves the text of an existing note; empty notes are not kept on exit (see pruneEmpty). */
function saveNote(notes, id, body, now = Date.now()) {
  if (typeof body !== 'string') throw new Error('The note text is invalid.');
  const text = body.slice(0, MAX_NOTE_LENGTH);
  const i = notes.findIndex((n) => n.id === id);
  if (i === -1) {
    if (notes.length >= MAX_NOTES) throw new Error(`You've reached the limit of ${MAX_NOTES} notes.`);
    return [{ id, body: text, createdAt: now, updatedAt: now }, ...notes];
  }
  if (notes[i].body === text) return notes;
  const next = [...notes];
  next[i] = { ...notes[i], body: text, updatedAt: now };
  return next;
}

/** A reminder read from the file: valid or null (the file may be edited by hand / broken). */
function cleanRemind(r) {
  if (!r || typeof r !== 'object' || typeof r.at !== 'number' || !Number.isFinite(r.at) || !REMIND_STATUSES.includes(r.status)) return null;
  const out = { at: Math.round(r.at), status: r.status };
  if (typeof r.firedAt === 'number' && Number.isFinite(r.firedAt)) out.firedAt = Math.round(r.firedAt);
  return out;
}

/** A note read from the file, with its reminder validated (no reminder → no remind field). */
function normalizeNote(n) {
  const { remind, ...rest } = n;
  const r = cleanRemind(remind);
  return r ? { ...rest, remind: r } : rest;
}

/**
 * Sets (at = ms) or removes (at = null) a note's reminder. Does not change updatedAt: the list keeps its order.
 * @throws if the note doesn't exist or the time isn't in the future (at most 2 years)
 */
function setReminder(notes, id, at, now = Date.now()) {
  const i = notes.findIndex((n) => n.id === id);
  if (i === -1) throw new Error('This note no longer exists.');
  if (at !== null && !RT.isValidAt(at, now)) throw new Error('Pick a time in the future (at most 2 years ahead).');
  const next = [...notes];
  const { remind, ...rest } = notes[i];
  next[i] = at === null ? rest : { ...rest, remind: { at: Math.round(at), status: 'pending' } };
  return next;
}

function deleteNote(notes, id) {
  return notes.filter((n) => n.id !== id);
}

function pruneEmpty(notes) {
  return notes.filter((n) => n.body.trim() !== '');
}

function sortNotes(notes) {
  return [...notes].sort((a, b) => b.updatedAt - a.updatedAt);
}

function titleOf(body) {
  const first = (body || '').split(/\r?\n/).find((l) => l.trim()) || '';
  return first.trim().slice(0, 80) || 'New note';
}

module.exports = { createNote, addNewNote, MAX_EMPTY_NOTES, saveNote, deleteNote, pruneEmpty, sortNotes, titleOf, cleanRemind, normalizeNote, setReminder, REMIND_STATUSES, MAX_NOTE_LENGTH, MAX_NOTES };
