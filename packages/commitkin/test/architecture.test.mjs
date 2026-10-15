import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
const source=new URL('../src/',import.meta.url);
function files(directory){return readdirSync(directory,{withFileTypes:true}).flatMap(item=>item.isDirectory()?files(new URL(item.name+'/',directory)):[new URL(item.name,directory)]);}
test('domain/application contain no filesystem/network/process or infrastructure dependencies',()=>{
  for(const layer of['domain/','application/'])for(const file of files(new URL(layer,source))){const text=readFileSync(file,'utf8');assert.doesNotMatch(text,/from\s+['"](?:node:)?(?:fs|https?|net|child_process|process)(?:\/[^'"]*)?['"]/,file.href);assert.doesNotMatch(text,/from\s+['"][^'"]*(?:\/infrastructure\/|\/src\/index\.js)/,file.href);assert.doesNotMatch(text,/\b(?:fetch|eval)\s*\(|\bprocess\./,file.href);}
});
test('development policy body is fixed/deeply frozen and contains no syntheticfixture IDs',async()=>{const {DEVELOPMENT_POLICY_REGISTRY,developmentPolicyDescriptors}=await import('../src/infrastructure/policies.mjs');const descriptors=developmentPolicyDescriptors();assert.equal(descriptors.fileRules.id,'commitkin-files-v1');assert.doesNotMatch(JSON.stringify(descriptors),/fixture-/);assert.throws(()=>DEVELOPMENT_POLICY_REGISTRY.fileRules[0].body.categories[0].patterns.push('**'));});
