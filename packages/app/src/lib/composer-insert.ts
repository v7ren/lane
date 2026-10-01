/** Lets other panels put text into a pane composer (for example a picked slash command). */
export const INSERT_COMPOSER_TEXT_EVENT = 'loomria:insert-composer-text';

export type InsertComposerTextDetail = { paneId: string; text: string };

export function insertComposerText(detail: InsertComposerTextDetail): void {
  window.dispatchEvent(new CustomEvent<InsertComposerTextDetail>(INSERT_COMPOSER_TEXT_EVENT, { detail }));
}
