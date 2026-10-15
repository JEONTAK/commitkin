import { canvas, encodePng } from './pixel.mjs';
import { CLASS_NAMES, CLASS_FAMILY, CLASS_ROWS, TRAIT_NAMES, ACHIEVEMENT_NAMES } from '../domain/character/catalog.mjs';
import { levelProgress, appearanceForLevel } from '../domain/growth/levels.mjs';
import { selectAchievementBadges } from '../domain/character/achievements.mjs';

export const FACTION_NAMES = Object.freeze({ bloomguard: 'Bloomguard', ashbound: 'Ashbound' });
export function displayName(id) { return CLASS_NAMES[id] ?? FACTION_NAMES[id] ?? TRAIT_NAMES[id] ?? ACHIEVEMENT_NAMES[id] ?? String(id ?? '').split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' '); }

export function drawCharacter(surface, { classId, factionId, level, x = 36, y = 66, scale = 6 }) {
  if (!CLASS_NAMES[classId] || !FACTION_NAMES[factionId]) throw new TypeError('CHARACTER_RENDER_INVALID');
  const appearance = appearanceForLevel({ classId, level });
  const stage = appearance.stageIndex;
  const bloom = factionId === 'bloomguard';
  const dark = [12, 15, 23], skin = [232, 192, 149], body = bloom ? [45, 121, 87] : [123, 62, 66];
  const accent = bloom ? [137, 220, 144] : [245, 166, 90], metal = bloom ? [179, 205, 193] : [191, 168, 161];
  const p = (a,b,w,h,color) => surface.rect(x+a*scale,y+b*scale,w*scale,h*scale,color);
  p(4,34,24,2,dark);
  if (stage >= 8) { p(1,6,2,23,accent); p(29,6,2,23,accent); }
  if (stage >= 10) { for (const [a,b] of [[0,2],[30,1],[2,30],[29,32],[4,0]]) p(a,b,1,1,accent); }
  p(10,23,5,10,dark); p(17,23,5,10,dark); p(9,32,6,2,metal); p(17,32,6,2,metal);
  p(8,13,16,12,dark); p(9,14,14,10,body); p(7,15,3,8,body); p(23,15,3,8,body);
  p(11,3,10,11,dark); p(12,5,8,8,skin); p(12,4,8,3,body); p(13,8,2,2,dark); p(18,8,1,2,dark);
  p(13,13,6,2,accent); p(10,22,12,2,metal);
  if (classId === 'adventurer') { p(10,3,12,3,body); p(7,6,16,1,accent); p(24,17,2,14,[151,113,76]); return appearance; }
  const family = CLASS_FAMILY[classId];
  const index = CLASS_ROWS[family].indexOf(classId);
  // Six silhouettes plus four equipment marks, each with eleven additive growth stages.
  if (family === 'craft') { p(24,13,2,15,metal); p(21,11,8,5,dark); p(22,12,6,3,metal); p(12,16,8,6,[112,83,63]); }
  if (family === 'guard') { p(3,14,6,13,dark); p(4,15,4,10,metal); p(5,17,2,5,body); p(25,10,1,19,accent); }
  if (family === 'knowledge') { p(3,16,7,9,dark); p(4,17,5,7,[206,190,149]); p(6,17,1,7,body); p(25,10,2,19,[147,110,73]); }
  if (family === 'verification') { p(24,10,2,20,metal); p(23,8,4,3,accent); p(10,3,12,3,metal); p(11,6,10,2,body); }
  if (family === 'recovery') { p(24,14,2,12,dark); p(22,16,6,7,accent); p(24,15,2,3,metal); p(5,18,3,6,metal); }
  if (family === 'operations') { p(25,2,2,29,metal); p(27,3,4,8,body); p(28,4,2,1,accent); p(10,14,3,7,metal); }
  p(11+index*2,18,1,2,accent);
  if (stage >= 1) p(8,14,4,3,metal);
  if (stage >= 2) p(20,14,4,3,metal);
  if (stage >= 3) { p(12,3,8,2,metal); p(15,3,2,1,accent); }
  if (stage >= 4) p(11,24,3,7,body);
  if (stage >= 5) p(18,24,3,7,body);
  if (stage >= 6) { p(11,1,2,3,accent); p(19,1,2,3,accent); }
  if (stage >= 7) p(13,16,6,1,accent);
  if (stage >= 8) p(7,13,2,12,accent);
  if (stage >= 9) p(23,13,2,12,accent);
  if (stage >= 10) p(14,0,4,2,metal);
  return appearance;
}

export function renderCard({ state, username, classificationReason = '', preview = true }) {
  if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/.test(username) || !CLASS_NAMES[state?.class?.id] || !FACTION_NAMES[state?.faction?.id]) throw new TypeError('CARD_INPUT_INVALID');
  if (state.growth.phase !== 'ready' || !state.evaluation?.evaluatedAt) throw new TypeError('CARD_ANALYSIS_PENDING');
  if(typeof classificationReason!=='string'||classificationReason.length>240||/[\r\n\u0000]/.test(classificationReason))throw new TypeError('CARD_REASON_INVALID');
  const progress = levelProgress(state.growth.totalXp);
  const bloom = state.faction.id === 'bloomguard';
  const background = bloom ? [17, 30, 28] : [32, 23, 28];
  const accent = bloom ? [154, 221, 167] : [245, 166, 110];
  const text = [239, 239, 224], muted = [164, 176, 173];
  const out = canvas(880, 416, background);
  out.rect(0,0,880,5,accent); out.rect(22,48,222,272,bloom ? [25,48,41] : [55,35,39]);
  out.text('COMMITKIN',24,22,accent,2);
  if (preview) out.text('DEVELOPMENT PREVIEW',570,22,muted,1);
  drawCharacter(out, { classId: state.class.id, factionId: state.faction.id, level: progress.level, x: 38, y: 70, scale: 6 });
  out.text(username,270,55,text,3,580);
  out.text(FACTION_NAMES[state.faction.id],270,91,accent,2);
  out.text('LV.'+progress.level+' '+CLASS_NAMES[state.class.id],270,123,text,3,580);
  const ratio = Number(BigInt(progress.xpIntoLevel) * 520n / BigInt(progress.xpForNextLevel));
  out.rect(270,166,520,12,[61,67,65]); out.rect(270,166,ratio,12,accent);
  out.text(progress.xpIntoLevel+' / '+progress.xpForNextLevel+' XP TO NEXT LEVEL',270,189,muted,2,580);
  const traits = [state.traits.habit.currentId,state.traits.activity.currentId].filter(Boolean).map(displayName);
  out.text(traits.length ? traits.join(' / ') : 'NO TRAITS YET',270,224,text,2,580);
  const badges = selectAchievementBadges(state.achievements);
  out.text(badges.length ? badges.map(item=>displayName(item.seriesId)+' · '+displayName(item.grade)).join(' / ') : 'NO ACHIEVEMENTS YET',270,258,accent,1,580);
  out.text('PUBLIC ACTIVITY ONLY',24,341,accent,2);
  out.text('LAST SUCCESS '+state.evaluation.evaluatedAt.replace('T',' ').replace('Z',' UTC'),24,368,muted,1);
  const reason = classificationReason || (state.class.id === 'adventurer' ? 'Awaiting a clear regular-class activity pattern.' : CLASS_NAMES[state.class.id]+' reflects observed public contribution style.');
  const words=reason.split(/\s+/);let line='',row=0;
  for(const word of words){if((line+' '+word).length>92&&line){out.text(line,270,294+row*11,muted,1,580);row++;line=word;}else line+=(line?' ':'')+word;}
  out.text(line,270,294+row*11,muted,1,580);
  return encodePng(out);
}

/** A confirmed faction with unknown growth is not a zero-XP/level-one result. */
export function renderPendingCard({ state, username, preview = true }) {
  if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/.test(username) || !FACTION_NAMES[state?.faction?.id] || state.growth?.phase !== 'pending' || state.growth.totalXp !== null || state.class !== null || state.evaluation !== null) throw new TypeError('PENDING_CARD_INPUT_INVALID');
  const bloom = state.faction.id === 'bloomguard', accent = bloom ? [154,221,167] : [245,166,110];
  const out = canvas(880,416,bloom ? [17,30,28] : [32,23,28]);
  out.rect(0,0,880,5,accent); out.text('COMMITKIN',24,22,accent,2);
  if (preview) out.text('DEVELOPMENT PREVIEW',570,22,[164,176,173],1);
  drawCharacter(out,{classId:'adventurer',factionId:state.faction.id,level:'1',x:38,y:70,scale:6});
  out.text(username,270,55,[239,239,224],3,580);
  out.text(FACTION_NAMES[state.faction.id],270,105,accent,2);
  out.text('ANALYSIS PENDING',270,165,[239,239,224],3,580);
  out.text('FACTION CONFIRMED / PERMANENT',270,220,accent,2,580);
  out.text('XP AND CLASS ARE NOT FINALIZED',270,265,[164,176,173],2,580);
  out.text('PUBLIC ACTIVITY ONLY',24,341,accent,2);
  out.text('NO SUCCESSFUL ANALYSIS YET',24,368,[164,176,173],1);
  return encodePng(out);
}
