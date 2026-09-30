import {isSeq, parseDocument} from 'yaml';

/**
 * Official include patches use `name` as an assertion, not a replacement.
 * Disable the original row and insert our provider, retaining its config.
 * Called only with a stopped Host and a Shell-owned Profile.
 */
export function sharedAccountProfile(text, adapter) {
  const document = parseDocument(text);
  if (document.errors.length || !isSeq(document.contents)) throw new Error('Invalid official Profile patch');
  const patches = document.toJS();
  const originals = patches.map((row, index) => row.id === 'credentials' ? index : -1).filter(index => index >= 0);
  if (originals.length > 1) throw new Error('Multiple credential provider overrides are unsupported');
  const original = originals[0];
  if (original !== undefined) {
    if (patches[original].name && patches[original].name !== '@deepseek-ai/dsh-credentials-local') {
      throw new Error('A custom credential provider cannot be replaced by shared sign-in');
    }
    document.setIn([original, 'disabled'], true);
  } else document.add(document.createNode({id: 'credentials', disabled: true}));
  const inserted = [];
  patches.forEach((patch, index) => patch.insert?.forEach((row, rowIndex) => {
    if (row.id === 'shell-account-credentials') inserted.push([index, 'insert', rowIndex]);
  }));
  if (inserted.length > 1) throw new Error('Multiple Shell account providers are unsupported');
  if (inserted.length) document.setIn([...inserted[0], 'name'], adapter);
  else {
    document.add(document.createNode({insert: [{id: 'shell-account-credentials', name: adapter}]}));
    const config = original === undefined ? undefined : document.getIn([original, 'config'], true);
    if (config) document.setIn([document.contents.items.length - 1, 'insert', 0, 'config'], config.clone());
  }
  return document.toString();
}
