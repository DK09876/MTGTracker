/**
 * Tagging jobs wired to the database and the model: start one for a deck,
 * stop it, and read how it stands. Server only.
 */

import { taggingModel } from './ai';
import { deckTags, loadTagJob, saveTagJob, type List } from './db';
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

export function startJob(list: List, params: JobParams): TagJob {
  if (isActive(currentJob(list.id))) throw new StepError('A tagging job is already running on this deck - stop it first');
  const model = taggingModel();
  if (!model) throw new StepError('No GEMINI_API_KEY is set on the server, so the model is off');
  const at = { list, boards: params.boards };
  if (params.kind === 'tag' && !deckTags(list.id).tags.some((t) => t.status === 'accepted')) {
    throw new StepError('Keep or make some tags first');
  }
  const job = newJob(list.id, params);
  launch(job, {
    propose: (instructions, o) => proposeStep(model, at, instructions, o),
    assign: (keys, o) => assignStep(model, at, keys, o),
    audit: (ids, o) => auditStep(model, at, ids, o),
    plan: (scope) => {
      const tags = deckTags(list.id);
      return {
        cards: cardsToTag(taggingDeck(list, params.boards), tags.cardTags, scope),
        tags: tags.tags.filter((t) => t.status === 'accepted').map((t) => t.id),
      };
    },
    save: saveTagJob,
  });
  return job;
}

export const stopJob = stop;
