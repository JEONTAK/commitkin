import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, access, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDemo } from '../src/index.mjs';
import { writePreviewDirectory } from '../src/infrastructure/preview-output.mjs';

test('both full fictional demos round-trip through the actual new-directory writer, with native Markdown and no overwrites', async t => {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'commitkin-profile-preview-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const faction of ['bloomguard', 'ashbound']) {
    const demo = buildDemo({ faction }), outputDirectory = join(root, faction);
    const result = await writePreviewDirectory({ previewRoot: root, outputDirectory, files: demo.files });
    assert.equal(result.fileCount, 11); assert.equal(result.publicationAuthorized, false);
    for (const file of demo.files) assert.deepEqual(await readFile(join(outputDirectory, file.path)), file.content);
    assert.match(await readFile(join(outputDirectory, 'PROFILE.md'), 'utf8'), /Fictional local data only/);
    await assert.rejects(writePreviewDirectory({ previewRoot: root, outputDirectory, files: demo.files }), { code: 'EEXIST' });
    assert.equal(demo.report.realOwnerRecordsChanged, false); assert.equal(demo.report.githubRequests, 0);
  }
});
test('new preview output paths do not grant arbitrary config/state writer destinations', async t => {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'commitkin-profile-preview-reject-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const outputDirectory = join(root, 'must-not-exist');
  for (const path of ['.github/commitkin.yml', '../README.md', '.commitkin/unapproved.json']) {
    await assert.rejects(writePreviewDirectory({ previewRoot: root, outputDirectory, files: [...buildDemo().files, { path, content: Buffer.from('no') }] }), /PREVIEW_FILES_INVALID/);
    await assert.rejects(access(outputDirectory), { code: 'ENOENT' });
  }
});
