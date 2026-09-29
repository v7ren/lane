/** Contract for Phase 3 composer: listen for `loomria:add-to-composer` on `window`. */
export const ADD_TO_COMPOSER_EVENT = 'loomria:add-to-composer';

export type AddToComposerDetail = {
  path: string;
  selection?: string;
};

export function dispatchAddToComposer(detail: AddToComposerDetail): void {
  window.dispatchEvent(new CustomEvent<AddToComposerDetail>(ADD_TO_COMPOSER_EVENT, { detail }));
}
