const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const { sendTelegramMessage } = require('../src/services/telegram');

const SETTINGS = { enabled: true, botToken: 'tok', chatId: '42' };

// Fake https.request: returns an EventEmitter req; `script(req, respond)`
// decides how each attempt behaves. `respond(statusCode, body)` simulates a
// full server reply.
function makeRequestFn(script) {
  let attempt = 0;
  const attempts = [];
  const requestFn = (options, onResponse) => {
    attempt += 1;
    attempts.push(options);
    const req = new EventEmitter();
    req.written = '';
    req.write = (chunk) => { req.written += chunk; };
    req.end = () => {};
    req.destroy = (error) => {
      // Node semantics: destroy(err) surfaces as an 'error' event.
      process.nextTick(() => req.emit('error', error || new Error('socket destroyed')));
    };
    const respond = (statusCode, body) => {
      const res = new EventEmitter();
      res.statusCode = statusCode;
      res.setEncoding = () => {};
      onResponse(res);
      process.nextTick(() => {
        if (body != null) res.emit('data', body);
        res.emit('end');
      });
      return res;
    };
    script(req, respond, attempt);
    return req;
  };
  requestFn.attempts = attempts;
  return requestFn;
}

test('a successful send resolves ok on the first attempt', async () => {
  const requestFn = makeRequestFn((req, respond) => {
    process.nextTick(() => respond(200, '{"ok":true}'));
  });

  const result = await sendTelegramMessage(SETTINGS, 'hello', { requestFn });

  assert.equal(result.ok, true);
  assert.equal(requestFn.attempts.length, 1, 'no retry on success');
});

test('a pre-response connection error is retried once', async () => {
  const requestFn = makeRequestFn((req, respond, attempt) => {
    if (attempt === 1) process.nextTick(() => req.emit('error', new Error('ECONNRESET')));
    else process.nextTick(() => respond(200, '{"ok":true}'));
  });

  const result = await sendTelegramMessage(SETTINGS, 'hello', { requestFn });

  assert.equal(result.ok, true, 'the retry succeeded');
  assert.equal(requestFn.attempts.length, 2, 'exactly one retry');
});

test('two consecutive transient failures give up after the single retry', async () => {
  const requestFn = makeRequestFn((req) => {
    process.nextTick(() => req.emit('error', new Error('EHOSTUNREACH')));
  });

  const result = await sendTelegramMessage(SETTINGS, 'hello', { requestFn });

  assert.equal(result.ok, false);
  assert.match(result.message, /EHOSTUNREACH/);
  assert.equal(requestFn.attempts.length, 2, 'one initial + one retry, never more');
});

test('an HTTP error reply is NOT retried (response already started)', async () => {
  const requestFn = makeRequestFn((req, respond) => {
    process.nextTick(() => respond(403, '{"ok":false,"description":"Forbidden: bot was blocked"}'));
  });

  const result = await sendTelegramMessage(SETTINGS, 'hello', { requestFn });

  assert.equal(result.ok, false);
  assert.match(result.message, /Forbidden/);
  assert.equal(requestFn.attempts.length, 1, 'a definitive server reply is final — retrying could double-send');
});

test('the absolute deadline fires for a request that never responds', async () => {
  // The request neither errors nor responds — only the deadline can end it.
  const requestFn = makeRequestFn(() => {});

  const start = Date.now();
  const result = await sendTelegramMessage(SETTINGS, 'hello', { requestFn, deadlineMs: 40 });

  assert.equal(result.ok, false);
  assert.match(result.message, /deadline/i);
  assert.ok(Date.now() - start < 5000, 'resolved via the deadline, not an idle timeout');
  assert.equal(requestFn.attempts.length, 2, 'a deadline kill is pre-response, so it earns the one retry');
});

test('disabled settings resolve immediately without any request', async () => {
  const requestFn = makeRequestFn(() => { throw new Error('must not be called'); });
  const result = await sendTelegramMessage({ enabled: false }, 'hello', { requestFn });
  assert.equal(result.ok, false);
  assert.equal(requestFn.attempts.length, 0);
});
