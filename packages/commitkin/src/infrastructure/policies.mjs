import { digest } from '../../../record-validator/src/domain/hash.js';

// Explicit development registry. Unknown paths and temporal claims fail closed.
// Fixture-* IDs are intentionally absent and cannot be enabled through the CLI.
const body={version:'1',exclusions:[
  {kind:'generated',patterns:['dist/**','build/**','coverage/**','vendor/**','node_modules/**','**/*.generated.*','**/*.min.js']},
  {kind:'lock',patterns:['**/package-lock.json','**/yarn.lock','**/pnpm-lock.yaml','**/Cargo.lock','**/Gemfile.lock','**/poetry.lock']},
  {kind:'card_update',patterns:['.commitkin/**']},
],categories:[
  {category:'deployment',patterns:['deploy/**','deployment/**','infra/**','terraform/**','**/Dockerfile','**/Dockerfile.*','**/docker-compose*.yml','.github/workflows/deploy*.yml','.github/workflows/deploy*.yaml']},
  {category:'test',patterns:['test/**','tests/**','**/__tests__/**','**/*.test.*','**/*.spec.*','**/test_*.py']},
  {category:'documentation',patterns:['docs/**','**/*.md','**/*.mdx','**/*.rst']},
  {category:'source',patterns:['**/*.js','**/*.mjs','**/*.cjs','**/*.jsx','**/*.ts','**/*.tsx','**/*.py','**/*.java','**/*.kt','**/*.go','**/*.rs','**/*.c','**/*.cpp','**/*.h','**/*.cs','**/*.rb','**/*.php','**/*.swift','**/*.vue','**/*.svelte']},
],precedence:['deployment','test','documentation','source']};
const bugs={version:'1',repositories:[]};
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
export const DEVELOPMENT_POLICY_REGISTRY=freeze({
  fileRules:[{id:'commitkin-files-v1',version:'1',body}],
  bugLabels:[{id:'commitkin-bug-labels-none-v1',version:'1',body:bugs}],
});
export function developmentPolicyDescriptors(){return Object.fromEntries(Object.entries(DEVELOPMENT_POLICY_REGISTRY).map(([name,entries])=>[name,{mode:'bundled',id:entries[0].id,version:entries[0].version,hash:digest(entries[0].body)}]));}
