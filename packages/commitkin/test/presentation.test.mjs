import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { canvas, encodePng } from '../src/presentation/pixel.mjs';
import { renderCard, drawCharacter } from '../src/presentation/card.mjs';
import { CLASS_NAMES } from '../src/domain/character/catalog.mjs';
import { managedContent, updateManagedReadme, START, END } from '../src/presentation/readme.mjs';
const state = JSON.parse(readFileSync(new URL('../../../test/fixtures/records/v1/valid/ready-40xp/state.json',import.meta.url)));
const status = JSON.parse(readFileSync(new URL('../../../test/fixtures/records/v1/valid/ready-40xp/status.json',import.meta.url)));
const hash = value => createHash('sha256').update(value).digest('hex');
test('static RGB PNG is bounded, deterministic and has exact dimensions', () => {
  const png = renderCard({ state, username:'DemoHero' });
  assert.deepEqual([...png.subarray(0,8)],[137,80,78,71,13,10,26,10]);
  assert.equal(png.readUInt32BE(16),880); assert.equal(png.readUInt32BE(20),416);
  assert.ok(png.length<50000); assert.equal(hash(png),hash(renderCard({state,username:'DemoHero'})));
  let position=8;const chunks=[];while(position<png.length){const size=png.readUInt32BE(position);if(png.toString('ascii',position+4,position+8)==='IDAT')chunks.push(png.subarray(position+8,position+8+size));position+=size+12;}
  assert.equal(inflateSync(Buffer.concat(chunks)).length,416*(880*3+1));
});
test('all530 original procedural appearances exist and differ; Adventurer remains fixed', () => {
  const seen = new Set();
  for (const classId of Object.keys(CLASS_NAMES)) for (const factionId of ['bloomguard','ashbound']) {
    for (const level of classId==='adventurer'?[1]:[1,5,10,15,20,25,30,35,40,45,50]) {
      const sprite = canvas(192,240);drawCharacter(sprite,{classId,factionId,level,x:0,y:0,scale:6});seen.add(hash(sprite.pixels));
    }
    if(classId==='adventurer'){const first=canvas(192,240),last=canvas(192,240);drawCharacter(first,{classId,factionId,level:1,x:0,y:0});drawCharacter(last,{classId,factionId,level:999,x:0,y:0});assert.equal(hash(first.pixels),hash(last.pixels));}
  }
  assert.equal(seen.size,530);
});
test('readme replacement preserves surrounding bytes and is replay-idempotent', () => {
  const old = '# My Profile\r\n🧑\r\n'+START+'\r\nold\r\n'+END+'\r\nUnrelated **content**\r\n';
  const body=managedContent({state,status,username:'DemoHero'});
  const result=updateManagedReadme(old,body);
  assert.ok(result.startsWith('# My Profile\r\n🧑\r\n'+START));assert.ok(result.endsWith(END+'\r\nUnrelated **content**\r\n'));
  assert.equal(updateManagedReadme(result,body),result);assert.match(result,/Synthetic development preview/);assert.match(result,/alt=/);assert.doesNotMatch(result,/repositoryId|accountId|sourceId/);
});
for(const old of ['# no markers',END+START,START+END+START,START+'<!-- COMMITKIN:BAD -->'+END]) test('missing/invalid managed region holds '+old,()=>assert.throws(()=>updateManagedReadme(old,'x'),/CONNECTION/));
test('rendering rejects malicious handles, pending analysis and unsafe dimensions',()=>{
  assert.throws(()=>renderCard({state,username:'<script>'}));
  assert.throws(()=>renderCard({state:{...state,growth:{...state.growth,phase:'pending'}},username:'DemoHero'}));
  assert.throws(()=>canvas(20000,20000));
  assert.ok(encodePng(canvas(1,1)).length>40);
});
test('readme reports partial/gaps without advancing successful freshness and requiresstatuspair',()=>{
  const partial={...status,state:'partial',reasonCode:'SOURCE_TIMEOUT',unobservedGaps:[{startDate:'2026-01-01',endDateExclusive:'2026-02-01',scopeId:null}]};
  const body=managedContent({state,status:partial,username:'DemoHero'});
  assert.match(body,/Partial data — last successful character retained/);assert.match(body,/Unobserved gap/);assert.match(body,/2026-10-15T01:00:00Z/);assert.doesNotMatch(body,/Data: Up to date/);
  assert.throws(()=>managedContent({state,username:'DemoHero'}),/STATUS/);assert.throws(()=>renderCard({state,username:'DemoHero',classificationReason:'x'.repeat(241)}),/REASON/);
});
