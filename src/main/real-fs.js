'use strict';

// Electron patches the global `fs` so that any `.asar` path is presented as a
// virtual DIRECTORY — that lets application code read files *inside* the asar
// archive as if it were a folder. For a sync/backup tool that operates on the
// USER's files, that virtualization is actively wrong: a synced Electron app's
// `app.asar` then stats as a 0-byte directory and cannot be snapshotted,
// archived (File History before-overwrite), or copied/restored correctly.
//
// `original-fs` is Electron's un-patched fs module: it treats `.asar` as the
// ordinary file it is on disk. Every part of the app that reads/copies/stats
// user files via Node's fs (rather than the robocopy/rsync child process, which
// is unaffected) should go through here.
//
// Outside Electron (the `node --test` runner, plain Node) the module does not
// exist, so fall back to plain fs — behavior there is identical, since only
// Electron applies the asar patch in the first place.
let realFs;
try {
  realFs = require('original-fs');
} catch {
  realFs = require('fs');
}

module.exports = realFs;
