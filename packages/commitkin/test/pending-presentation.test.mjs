import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderPendingCard } from '../src/presentation/card.mjs';
import { managedPendingContent } from '../src/presentation/readme.mjs';
const directory = new URL('../../../test/fixtures/records/v1/valid/first-analysis-pending/', import.meta.url);
const fixture = () => Object.fromEntries(['state','status'].map(role => [role, JSON.parse(readFileSync(new URL(role+'.json',directory)))]));
test('pending card shows a confirmed faction without inventing zero XP, a numerical level or finalized class', () => {
  const {state,status} = fixture(), png = renderPendingCard({state,username:'HeroA'}), content = managedPendingContent({state,status,username:'HeroA'});
  assert.equal(png.readUInt32BE(16),880); assert.equal(png.readUInt32BE(20),416);
  assert.match(content,/Analysis pending/); assert.match(content,/XP, level and class are not finalized/); assert.match(content,/confirmed permanently/);
  assert.doesNotMatch(content,/Lv\.1|0 XP|Last successful update:|Up to date/);
  assert.equal(state.growth.totalXp,null); assert.equal(state.class,null);
});
test('pending presentation rejects successful or contradictory snapshots and unsafe handles', () => {
  const {state,status}=fixture();
  for(const changed of [{...state,growth:{...state.growth,totalXp:'0'}},{...state,class:{id:'adventurer'}},{...state,evaluation:{}}, {...state,faction:{id:'unknown'}}]){
    assert.throws(()=>renderPendingCard({state:changed,username:'HeroA'}));
    assert.throws(()=>managedPendingContent({state:changed,status,username:'HeroA'}));
  }
  assert.throws(()=>renderPendingCard({state,username:'<img>'}));
  assert.throws(()=>managedPendingContent({state,status:{...status,lastSuccessfulRevision:1},username:'HeroA'}));
});
