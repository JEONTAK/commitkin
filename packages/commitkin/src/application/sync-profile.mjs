const SHA = /^[a-f0-9]{40}$/;
const diagnostic = value => typeof value === 'string' && /^[A-Z][A-Z0-9_]{1,95}$/.test(value) ? value : 'PROFILE_SYNC_UNAVAILABLE';
function hold(code, stage, dryRun, profileChanged = false) {
  return { reportVersion: 1, reportType: 'profile-sync', decision: 'hold', code: diagnostic(code), stage, dryRun,
    published: false, profileChanged, growthRecordsChanged: false, progressionAuthorized: false,
    publicationOutcome: profileChanged === null ? 'outcome_unknown' : 'not_published' };
}

/** Display-only orchestration. No network, filesystem or publisher is implicit. */
export function createProfileSyncUseCase({ acquire, render, updateReadme, createPublisher }) {
  return async function syncProfile({ workflowContext, sourceRepository, dryRun = true, initializeIfMissing = false } = {}) {
    let stage = 'input'; let publicationStarted = false;
    try {
      if (typeof dryRun !== 'boolean' || typeof initializeIfMissing !== 'boolean' || typeof acquire !== 'function' || typeof render !== 'function' || typeof updateReadme !== 'function') return hold('PROFILE_SYNC_INPUT_INVALID', stage, true);
      stage = 'acquisition';
      const source = await acquire({ workflowContext, sourceRepository });
      if (source?.decision !== 'acquired') return hold(source?.code, stage, dryRun);
      const target = source.target;
      if (!target || target.expectedRepositoryId !== workflowContext?.repositoryId || target.expectedOwnerAccountId !== workflowContext?.ownerAccountId || target.expectedHead !== workflowContext?.sha || typeof source.readme !== 'string') return hold('PROFILE_SYNC_BINDING_INVALID', stage, dryRun);
      if (source.model?.analysis?.phase !== 'ready') return hold('PROFILE_SOURCE_ANALYSIS_PENDING', stage, dryRun);
      stage = 'render';
      const content = render({ model: source.model, characterImageUrl: source.characterImageUrl });
      const readme = updateReadme(source.readme, content, { initializeIfMissing });
      if (typeof readme !== 'string' || !readme.isWellFormed()) return hold('PROFILE_README_INVALID', stage, dryRun);
      const bytes = new TextEncoder().encode(readme);
      if (bytes.length < 1 || bytes.length > 1048576) return hold('PROFILE_README_TOO_LARGE', stage, dryRun);
      const changed = readme !== source.readme;
      const report = { reportVersion: 1, reportType: 'profile-sync', decision: changed ? 'prepared' : 'unchanged',
        code: changed ? 'PROFILE_SYNC_PREPARED' : 'PROFILE_ALREADY_CURRENT', stage: 'complete', dryRun,
        published: false, profileChanged: false, growthRecordsChanged: false, progressionAuthorized: false,
        publicationOutcome: 'not_published', filesPrepared: changed ? 1 : 0 };
      if (dryRun || !changed) return report;
      stage = 'publication';
      if (typeof createPublisher !== 'function') return hold('PROFILE_PUBLISHER_REQUIRED', stage, false);
      const publisher = createPublisher();
      if (typeof publisher?.publish !== 'function') return hold('PROFILE_PUBLISHER_REQUIRED', stage, false);
      publicationStarted = true;
      const result = await publisher.publish({ ...target, files: [{ path: 'README.md', content: bytes }] });
      if (result?.published !== true || result.actualRecordsChanged !== true || result.publicationOutcome !== 'published' || typeof result.commitSha !== 'string' || !SHA.test(result.commitSha)) {
        const unchanged = result?.published === false && result.actualRecordsChanged === false && result.publicationOutcome === 'not_published';
        return hold(result?.code, stage, false, unchanged ? false : null);
      }
      return { ...report, decision: 'published', code: diagnostic(result.code), stage: 'complete', published: true,
        profileChanged: true, publicationOutcome: 'published', commitSha: result.commitSha };
    } catch {
      return hold('PROFILE_SYNC_UNAVAILABLE', stage, typeof dryRun === 'boolean' ? dryRun : true, publicationStarted ? null : false);
    }
  };
}
