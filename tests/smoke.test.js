'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const config = require('../src/config');
const pkg = require('../package.json');

assert.strictEqual(pkg.main, 'src/app/bot.js');
assert.strictEqual(pkg.scripts.start, 'node src/app/bot.js');
assert.ok(config.ROOT_DIR.endsWith('Saving-Bot'));
assert.ok(config.TEMPLATE_PATH.endsWith(path.join('assets', 'templates', 'Template.xlsx')));
assert.ok(fs.existsSync(config.TEMPLATE_PATH), `Missing template at ${config.TEMPLATE_PATH}`);
assert.ok(fs.existsSync(path.join(config.ROOT_DIR, 'src', 'services', 'dashboard.js')));
assert.ok(fs.existsSync(path.join(config.ROOT_DIR, 'src', 'services', 'editor.js')));
assert.ok(fs.existsSync(path.join(config.ROOT_DIR, 'src', 'handlers', 'message-handler.js')));
assert.ok(Array.isArray(config.WHITELIST));
assert.ok(Array.isArray(config.NOTIFY_NUMBERS));

console.log('Smoke checks passed');
