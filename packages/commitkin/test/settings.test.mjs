import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSettings, effectiveRepositories, chooseFaction } from '../src/domain/settings.mjs';
import { parseSettings } from '../src/infrastructure/settings-yaml.mjs';
const bytes = value => Buffer.from(value);

test('settings parser accepts approved example and normalizes without mutation', () => {
  const input = 'version: 1\nrepositories:\n  additional:\n    - Your-Org/Repo\n    - your-org/repo # public\n  exclude: []\n';
  assert.deepEqual(parseSettings(bytes(input)), { version: 1, repositories: { additional: ['your-org/repo'], exclude: [] } });
});
for (const value of ['version: 2\nrepositories:', 'version: 1\nversion: 1\nrepositories:', 'version: 1\nrepositories:\n  owner: attacker', 'version: 1\nrepositories:\n  additional:\n    - https://github.com/a/b', 'version: 1\nrepositories:\n  additional: &alias []', '\uFEFFversion: 1\nrepositories:', 'version: 1\nrepositories:\n\tadditional: []']) {
  test('reject unsafe/unknown YAML ' + JSON.stringify(value), () => assert.throws(() => parseSettings(bytes(value))));
}
test('missing settings never silently changes ongoing scope', () => {
  assert.throws(() => parseSettings(null), /CONFIRMATION/);
  assert.throws(() => parseSettings(null, { previouslyUsed: true, firstInstallVerified: true }), /CONFIRMATION/);
  assert.deepEqual(parseSettings(null, { firstInstallVerified: true }).repositories, { additional: [], exclude: [] });
});
test('size and UTF8 defenses', () => {
  assert.throws(() => parseSettings(Buffer.alloc(65537)), /INPUT/);
  assert.throws(() => parseSettings(Buffer.from([255])), /UTF8/);
});
test('strict public shape and bounded entries', () => {
  assert.throws(() => normalizeSettings({ version: 1, repositories: { additional: [], exclude: [] }, token: 'never' }));
  assert.throws(() => normalizeSettings({ version: 1, repositories: { additional: Array(201).fill('a/b'), exclude: [] } }));
});
const repo = { id: '9007199254740993', name: 'Org/Repo', ownerId: '10', visibility: 'public', fork: false, availability: 'available' };
test('scope retains tracked repositories, ID-deduplicates and exclusions win', () => {
  const resolved = effectiveRepositories({ automatic: [repo], additional: [{ ...repo, name: 'org/renamed' }], tracked: [{ ...repo, id: '2', name: 'org/old' }] });
  assert.deepEqual(resolved.repositories.map(row => row.id), ['2', repo.id]);
  assert.deepEqual(effectiveRepositories({ additional: [repo], excludedNames: ['ORG/REPO'] }).repositories, []);
  assert.deepEqual(effectiveRepositories({ tracked: [repo], excludedIds: [repo.id] }).repositories, []);
});
test('unavailable known repositories hold; confirmed private differs from 404', () => {
  assert.equal(effectiveRepositories({ tracked: [{ ...repo, availability: 'unavailable' }] }).decision, 'hold');
  assert.deepEqual(effectiveRepositories({ tracked: [{ ...repo, visibility: 'private' }] }).repositories, []);
});
test('faction is permanent and missing record is not first installation', () => {
  assert.equal(chooseFaction({ requestedFaction: 'ashbound' }).code, 'RECOVERY_REQUIRED');
  assert.equal(chooseFaction({ savedFaction: 'bloomguard', requestedFaction: 'ashbound' }).code, 'FACTION_PERMANENT');
  assert.equal(chooseFaction({ firstInstallVerified: true, requestedFaction: 'ashbound' }).faction, 'ashbound');
  assert.equal(chooseFaction({ savedFaction: 'bloomguard' }).decision, 'retained');
});
