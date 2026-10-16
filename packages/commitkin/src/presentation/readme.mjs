import { CLASS_NAMES, TRAIT_NAMES, ACHIEVEMENT_NAMES, GRADES } from '../domain/character/catalog.mjs';
import { levelProgress, appearanceForLevel } from '../domain/growth/levels.mjs';
import { FACTION_NAMES, displayName } from './card.mjs';

export const START = '<!-- COMMITKIN:START -->';
export const END = '<!-- COMMITKIN:END -->';
export const SCOPE_COPY = 'Scope: Public activity from automatically discovered and added repositories. Other activity may be missing.';
const escape = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
function earnedCollection(achievements) {
  return achievements.map(item => {
    const grade = [...item.earned].sort((a,b)=>GRADES.indexOf(b.grade)-GRADES.indexOf(a.grade))[0]?.grade;
    return grade ? `${ACHIEVEMENT_NAMES[item.seriesId]} · ${displayName(grade)}` : null;
  }).filter(Boolean);
}
export function characterSummary(state) {
  const level = levelProgress(state.growth.totalXp);
  return `${FACTION_NAMES[state.faction.id]} · Lv.${level.level} ${CLASS_NAMES[state.class.id]}`;
}

export function managedContent({ state, status, username, classificationReason, preview = true }) {
  if (!CLASS_NAMES[state?.class?.id] || !FACTION_NAMES[state?.faction?.id] || state.growth.phase !== 'ready') throw new TypeError('README_STATE_INVALID');
  if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/.test(username)) throw new TypeError('README_USER_INVALID');
  if(!status||status.recordRevision!==state.recordRevision||status.lastSuccessfulRevision!==state.evaluation?.lastSuccessfulRevision)throw new TypeError('README_STATUS_INVALID');
  const level = levelProgress(state.growth.totalXp);
  const appearance = appearanceForLevel({ classId: state.class.id, level: level.level });
  const traits = [state.traits.habit.currentId,state.traits.activity.currentId].filter(Boolean).map(id=>TRAIT_NAMES[id]);
  const lines = [
    `<p><img src=".commitkin/card.png" alt="${escape(username+': '+characterSummary(state)+'. '+level.xpIntoLevel+' of '+level.xpForNextLevel+' XP toward next level. '+(traits.length ? traits.join(', ')+'. ' : '')+'Public activity only.')}" width="880" /></p>`,
    '',
    `Public activity only · Growth record starts ${state.growth.startDate} (UTC) · Scheduled daily`,
    '',
    '<details>', '<summary>Character details</summary>', '',
    SCOPE_COPY, '',
    `Character: ${escape(characterSummary(state))}.`,
    `XP toward next level: ${level.xpIntoLevel} / ${level.xpForNextLevel}.`,
    `Traits: ${traits.length ? traits.map(escape).join(' · ') : 'None yet'}.`,
    `Class: previous 90 completed UTC days. Traits: previous 30 completed UTC days.`,
    escape(classificationReason || 'Classification describes observed public contribution style, not skill or seniority.'),
  ];
  if (state.class.pending) lines.push(`Class candidate: ${CLASS_NAMES[state.class.pending.targetId]} · ${state.class.pending.count}/7 observations. Seven observations do not waive the 14-date change interval or candidate requirements.`);
  for (const kind of ['habit','activity']) if (state.traits[kind].pending) {
    const pending = state.traits[kind].pending;
    lines.push(`${displayName(kind)} trait ${pending.targetId ? 'candidate: '+TRAIT_NAMES[pending.targetId] : 'removal'} · ${pending.count}/3 observations.`);
  }
  lines.push(appearance.fixed ? 'Appearance: Adventurer stays fixed until a verified regular assignment.' : appearance.finalStage ? 'Appearance: final Lv.50 stage; numerical levels continue.' : `Next appearance: Lv.${appearance.nextAppearanceAt}.`);
  lines.push('', 'Earned achievements: '+(earnedCollection(state.achievements).map(escape).join(' · ') || 'None yet')+'.');
  const data=status.state==='ok'?'Up to date for tracked repositories':status.state==='partial'?'Partial data — last successful character retained.':status.state==='recovery_required'?'Recovery required':'Configuration requires attention; last successful character retained.';
  lines.push('', `Last successful update: ${state.evaluation.evaluatedAt}.`, 'Data: '+data);
  if(status.unobservedGaps.length)lines.push('Unobserved gap: older uncollected activity is not confirmed inactivity or guaranteed recoverable history.');
  if (preview) lines.push('', '**Synthetic development preview — not a live GitHub character or a verified public release.**');
  lines.push('', '[How it works](https://github.com/JEONTAK/commitkin#how-it-works) · [Recovery guide](https://github.com/JEONTAK/commitkin#recovery) · [Credits](https://github.com/JEONTAK/commitkin#credits)', '', '</details>');
  return lines.join('\n');
}

export function managedPendingContent({ state, status, username, preview = true }) {
  if (!FACTION_NAMES[state?.faction?.id] || state.growth?.phase !== 'pending' || state.growth.totalXp !== null || state.class !== null || state.evaluation !== null || status?.state !== 'analysis_pending' || status.recordRevision !== state.recordRevision || status.lastSuccessfulRevision !== null || !/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/.test(username)) throw new TypeError('PENDING_README_INPUT_INVALID');
  return [
    `<p><img src=".commitkin/card.png" alt="${escape(username)}: ${FACTION_NAMES[state.faction.id]}. Analysis pending. XP and class are not finalized. Public activity only." width="880" /></p>`, '',
    `Public activity only · Growth record starts ${state.growth.startDate} (UTC) · Scheduled daily`, '',
    '<details>', '<summary>Character details</summary>', '', SCOPE_COPY, '',
    `Faction: ${FACTION_NAMES[state.faction.id]} — confirmed permanently.`,
    'Analysis pending: required activity data is not complete. XP, level and class are not finalized.',
    'No successful analysis yet. Retry after the diagnostic cause is resolved; do not delete growth files or choose another faction.',
    ...(preview ? ['', '**Development preview — no completed growth analysis.**'] : []), '',
    '[How it works](https://github.com/JEONTAK/commitkin#how-it-works) · [Recovery guide](https://github.com/JEONTAK/commitkin#recovery) · [Credits](https://github.com/JEONTAK/commitkin#credits)', '', '</details>',
  ].join('\n');
}

function insideFence(text) {
  let fence = null;
  for (const line of text.split(/\r?\n/)) {
    const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (!match) continue;
    if (!fence) fence = match[1];
    else if (match[1][0] === fence[0] && match[1].length >= fence.length && match[2].trim() === '') fence = null;
  }
  return fence !== null;
}

/** Existing regions stay strict. Explicit first connection may append, never replace, a missing region. */
export function updateManagedReadme(original, content, { initializeIfMissing = false } = {}) {
  if (typeof initializeIfMissing !== 'boolean' || typeof original !== 'string' || typeof content !== 'string' || !original.isWellFormed() || !content.isWellFormed() || Buffer.byteLength(original) > 1048576 || content.includes(START) || content.includes(END)) throw new TypeError('README_INPUT_INVALID');
  const starts = [...original.matchAll(/<!-- COMMITKIN:START -->/g)];
  const ends = [...original.matchAll(/<!-- COMMITKIN:END -->/g)];
  const newline = original.includes('\r\n') ? '\r\n' : '\n';
  if (initializeIfMissing && starts.length === 0 && ends.length === 0 && !/COMMITKIN\s*:/i.test(original)) {
    if (insideFence(original)) throw new TypeError('README_CONNECTION_REQUIRED');
    const separator = original.length === 0 || original.endsWith(newline + newline) ? '' : original.endsWith(newline) ? newline : newline + newline;
    return original + separator + START + newline + content.replace(/\r?\n/g, newline) + newline + END + newline;
  }
  // Escaped, inline or code-fenced marker examples are not an installation target.
  if (initializeIfMissing) {
    const lines = original.replace(/^\ufeff/, '').split(/\r?\n/);
    if (!lines.includes(START) || !lines.includes(END) || insideFence(original.slice(0, starts[0]?.index ?? 0))) throw new TypeError('README_CONNECTION_REQUIRED');
  }
  if (starts.length !== 1 || ends.length !== 1 || starts[0].index >= ends[0].index || /<!--\s*COMMITKIN(?::|\s)/i.test(original.replace(START,'').replace(END,''))) throw new TypeError('README_CONNECTION_REQUIRED');
  const from = starts[0].index + START.length;
  const to = ends[0].index;
  return original.slice(0,from) + newline + content.replace(/\r?\n/g,newline) + newline + original.slice(to);
}
