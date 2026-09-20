'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  sanitizeFolderLabel,
  dedupeLabel,
  withUniqueDestinationLabels
} = require('../src/main/job-model');

// sanitizeFolderLabel merges the former sanitizeSourceLabel (main.js) and
// sanitizeDestinationLabel (job-model). Lock the shared behavior.
test('sanitizeFolderLabel strips unsafe chars, trailing dots/spaces, and edge dashes', () => {
  assert.equal(sanitizeFolderLabel('My:Folder*', 'fb', 'Source'), 'My-Folder');
  assert.equal(sanitizeFolderLabel('  spaced  ', 'fb', 'Source'), 'spaced');
  assert.equal(sanitizeFolderLabel('trailing...', 'fb', 'Source'), 'trailing');
  assert.equal(sanitizeFolderLabel('a/b\\c', 'fb', 'Source'), 'a-b-c');
});

test('sanitizeFolderLabel falls back to the provided fallback, then defaultLabel', () => {
  assert.equal(sanitizeFolderLabel('', 'Fallback', 'Source'), 'Fallback');
  assert.equal(sanitizeFolderLabel('', '', 'Destination'), 'Destination');
  assert.equal(sanitizeFolderLabel('', '', 'Source'), 'Source');
  assert.equal(sanitizeFolderLabel('', ''), 'Folder'); // default defaultLabel
  // A label that sanitizes down to nothing falls back too.
  assert.equal(sanitizeFolderLabel('***', 'Fallback', 'Source'), 'Fallback');
});

test('dedupeLabel appends -2, -3 on case-insensitive collisions and mutates the map', () => {
  const used = new Map();
  assert.equal(dedupeLabel('Music', used), 'Music');
  assert.equal(dedupeLabel('Music', used), 'Music-2');
  assert.equal(dedupeLabel('music', used), 'music-3'); // case-insensitive base key
  assert.equal(dedupeLabel('Photos', used), 'Photos');
});

test('withUniqueDestinationLabels uses the merged sanitizer + dedup loop', () => {
  const out = withUniqueDestinationLabels([
    { path: 'C:/Backups/Music', required: true },
    { path: 'D:/Music', required: true } // same basename -> must disambiguate
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].label, 'Music');
  assert.equal(out[1].label, 'Music-2');
});
