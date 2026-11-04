/**
 * Tagging jobs wired to the database and the model: start one for a deck,
 * stop it, and read how it stands. Server only.
 */

import { appModel } from './ai';
import { deckTags, loadTagJob, saveTagJob, type List } from './db';
import { recordError } from './errors';
import { taggingDeck } from './tag-deck';
import { isActive, isRunningHere, launch, newJob, stop, type JobParams, type TagJob } from './tag-jobs';
import { assignStep, auditStep, cardsToTag, proposeStep, StepError } from './tag-steps';

/** The deck's latest job; one this process lost track of is marked interrupted. */
export function currentJob(listId: string): TagJob | null {
  const job = loadTagJob(listId);
  if (job && isActive(job) && !isRunningHere(listId)) {
    job.status = 'interrupted';
    job.finishedAt = new Date().toISOString();
    job.events.push({ at: job.finishedAt, level: 'error', text: 'The server restarted while this was running - start it again' });
    saveTagJob(job);
  }
  return job;
}

/** Start a job on a deck, its model requests charged to the profile that owns it. */
export function startJob(list: List, params: JobParams, profile: string): TagJob {
  if (isActive(currentJob(list.id))) throw new StepError('A tagging job is already running on this deck - stop it first');
  const model = appModel(profile, 'tagging', list.name);
  // Putting tags on cards is many small guided calls: its own, cheaper model.
  const cardModel = appModel(profile, 'tagcards', list.name) ?? model;
  if (!model || !cardModel) throw new StepError('No model API key is set on the server, so the model is off');
  const at = { list, boards: params.boards };
  if (params.kind === 'tag' && !deckTags(list.id).tags.some((t) => t.status === 'accepted')) {
    throw new StepError('Keep or make some tags first');
  }
  const job = newJob(list.id, params);
  launch(job, {
    propose: (instructions, o) => proposeStep(model, at, instructions, o),
    assign: (keys, o) => assignStep(cardModel, at, keys, o, { tagIds: params.tagIds, instructions: params.instructions }),
    audit: (ids, o) => auditStep(cardModel, at, ids, o),
    plan: (p) => {
      const tags = deckTags(list.id);
      const accepted = tags.tags.filter((t) => t.status === 'accepted').map((t) => t.id);
      return {
        cards: cardsToTag(taggingDeck(list, p.boards), tags.cardTags, p.scope ?? 'all', { missingTag: p.missingTag, picked: p.picked }),
        tags: p.tagIds?.length ? accepted.filter((id) => p.tagIds!.includes(id)) : accepted,
      };
    },
    save: (j) => {
      // A failed run goes in the error log; a busy or refusing model is a warning, not a banner.
      if (j.status === 'failed' && loadTagJob(j.listId)?.status === 'running') {
        recordError({ source: `${j.params.kind === 'propose' ? 'Suggesting tags' : 'Tagging cards'} · ${list.name}`, message: j.error ?? 'The job failed', level: 'warn', profileId: profile, listId: list.id });
      }
      saveTagJob(j);
    },
  });
  return job;
}

export const stopJob = stop;
