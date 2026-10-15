const MODEL = 'observed-api-v1';
const hold = (code, actualRecordsChanged = false) => ({ reportVersion: 1, decision: 'hold', code, published: false, progressionAuthorized: false, actualRecordsChanged, publicationOutcome: actualRecordsChanged === null ? 'outcome_unknown' : 'not_published' });

/** Publication is an explicit, separately injected capability; dry run is default. */
export function createActionRunUseCase({ prepare, publish }) {
  return async function runAction({ workflowContext, initialSelection = null, dryRun = true }) {
    let publicationStarted = false;
    try {
      if (typeof dryRun !== 'boolean' || typeof prepare !== 'function') return hold('ACTION_INPUT_INVALID');
      const result = await prepare({ workflowContext, initialSelection });
      if (!['prepared', 'pending', 'unchanged'].includes(result.decision)) return { ...hold(result.code), stage: result.stage };
      const report = { reportVersion: 1, decision: result.decision, code: result.code, sourceModel: result.sourceModel ?? MODEL, summary: result.summary, published: false, progressionAuthorized: false, actualRecordsChanged: false, publicationOutcome: 'not_published' };
      if (dryRun || result.decision === 'unchanged') return { ...report, dryRun, filesPrepared: result.files?.length ?? 0 };
      const pending = result.decision === 'pending' && result.verification?.decision === 'initial_pending_reservation' && result.verification.initialConfirmation === 'verified' && result.candidate?.state.growth.phase === 'pending' && result.candidate.state.growth.totalXp === null && result.candidate.state.class === null && result.candidate.state.evaluation === null;
      if (result.sourceModel !== MODEL || !pending && result.verification?.decision !== 'accept_relative_to_capture' && result.verification?.code !== 'PRIMARY_SNAPSHOT_UNCHANGED') return hold('ACTION_SOURCE_VERIFICATION_REQUIRED');
      if (!result.owner || result.owner.accountId !== workflowContext.ownerAccountId || result.owner.profileRepositoryId !== workflowContext.repositoryId || typeof publish !== 'function') return hold('ACTION_PUBLICATION_BINDING_INVALID');
      publicationStarted = true;
      const written = await publish({ repository: result.repository, defaultBranch: result.defaultBranch, expectedHead: result.expectedHead, expectedRepositoryId: result.owner.profileRepositoryId, expectedOwnerAccountId: result.owner.accountId, files: result.files });
      if (written.published !== true) return { ...hold(written.code, written.actualRecordsChanged === false && written.publicationOutcome === 'not_published' ? false : null), stage: 'publication', dryRun: false };
      return { ...report, decision: 'published', code: written.code, dryRun: false, published: true, progressionAuthorized: !pending, actualRecordsChanged: true, publicationOutcome: 'published', commitSha: written.commitSha };
    } catch { return { ...hold('ACTION_RUN_UNAVAILABLE', publicationStarted ? null : false), ...(publicationStarted ? { stage: 'publication', dryRun: false } : {}) }; }
  };
}
