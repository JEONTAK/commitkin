import { createValidator } from '../../record-validator/src/index.js';
import { parseStrictJson } from '../../record-validator/src/infrastructure/strict-json.js';
import { createPreflightValidator } from './infrastructure/preflight-factory.mjs';
import { DEVELOPMENT_POLICY_REGISTRY } from './infrastructure/policies.mjs';
import { createSnapshotEvaluationUseCase } from './application/evaluate.mjs';
import { createEvidenceVerificationUseCase } from './application/verify-evidence.mjs';
import { buildDemoUseCase } from './application/demo.mjs';

/** Composition root. Factories construct capabilities; importing never performs I/O/network writes. */
export { createPreflightValidator };
export function createSnapshotEvaluator(){return createSnapshotEvaluationUseCase({validateRecords:createValidator()});}
export function createEvidenceVerifier({policyRegistry=DEVELOPMENT_POLICY_REGISTRY}={}){
  return createEvidenceVerificationUseCase({policyRegistry,preflight:createPreflightValidator(),parse:parseStrictJson});
}
export function buildDemo({faction='bloomguard'}={}){return buildDemoUseCase({faction,evaluateSnapshot:createSnapshotEvaluator()});}
export { settleQualifiedActivities } from './domain/growth/settlement.mjs';
export { levelProgress, levelForXp, xpForLevel, appearanceForLevel } from './domain/growth/levels.mjs';
export { evaluateCharacter } from './domain/character/index.mjs';
export { renderCard } from './presentation/card.mjs';
export { managedContent, updateManagedReadme } from './presentation/readme.mjs';
export { createGithubClient,discoverRepositories,createGithubPublisher } from './infrastructure/github/index.mjs';
export { collectPublicSources } from './application/collect-public-sources.mjs';
