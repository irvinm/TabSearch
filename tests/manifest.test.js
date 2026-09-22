const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Loads and parses a JSON file relative to the project root.
 *
 * @param {string} relativePath - The relative path to the JSON file from the project root.
 * @returns {object} The parsed JSON object.
 */
function loadJson(relativePath) {
  const fullPath = path.resolve(__dirname, '..', relativePath);
  const raw = fs.readFileSync(fullPath, 'utf8');
  return JSON.parse(raw);
}

test('manifest.json - version synchronization with package.json', () => {
  const manifest = loadJson('src/manifest.json');
  const pkg = loadJson('package.json');

  assert.equal(typeof manifest.version, 'string');
  assert.equal(typeof pkg.version, 'string');
  assert.equal(
    manifest.version,
    pkg.version,
    `manifest.json version (${manifest.version}) must match package.json version (${pkg.version})`
  );
});

test('manifest.json - does not declare unnecessary host_permissions or optional_permissions', () => {
  const manifest = loadJson('src/manifest.json');

  assert.equal(
    manifest.host_permissions,
    undefined,
    'manifest.json should not declare host_permissions to avoid intrusive optional permission prompts'
  );
  assert.equal(
    manifest.optional_permissions,
    undefined,
    'manifest.json should not declare optional_permissions'
  );
});

test('manifest.json - declares strictly required minimal permissions', () => {
  const manifest = loadJson('src/manifest.json');
  const expectedPermissions = ['tabs', 'tabHide', 'storage', 'find'];

  assert.ok(Array.isArray(manifest.permissions), 'permissions must be an array');
  assert.deepEqual(
    [...manifest.permissions].sort(),
    [...expectedPermissions].sort(),
    'manifest.json must only declare the strictly required permissions'
  );
});
