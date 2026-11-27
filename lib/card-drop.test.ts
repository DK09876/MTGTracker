import { describe, expect, it } from 'vitest';

import { cardInDrop, cardInUrl } from './card-drop';

const ID = '00b70f7a-8e77-4a99-8d13-7465a190630e';

describe('a card dragged in from another site', () => {
  it('reads Scryfall pictures and API links by id', () => {
    expect(cardInUrl(`https://cards.scryfall.io/normal/front/0/0/${ID}.jpg?1706240553`)).toEqual({ id: ID });
    expect(cardInUrl(`https://cards.scryfall.io/large/back/0/0/${ID}.jpg`)).toEqual({ id: ID });
    expect(cardInUrl(`https://c1.scryfall.com/file/scryfall-cards/normal/front/0/0/${ID}.jpg`)).toEqual({ id: ID });
    expect(cardInUrl(`https://api.scryfall.com/cards/${ID}`)).toEqual({ id: ID });
  });

  it('reads a Scryfall card page by set and collector number', () => {
    expect(cardInUrl('https://scryfall.com/card/mkm/198/etrata-deadly-fugitive')).toEqual({ set: 'mkm', number: '198' });
    expect(cardInUrl('https://scryfall.com/card/PLST/2XM-229/sol-ring')).toEqual({ set: 'plst', number: '2XM-229' });
    expect(cardInUrl('https://scryfall.com/card/sld/381%E2%98%85/x')).toEqual({ set: 'sld', number: '381★' });
  });

  it('ignores anything that is not a Scryfall card', () => {
    expect(cardInUrl('https://scryfall.com/search?q=sol')).toBeNull();
    expect(cardInUrl('https://edhrec.com/cards/sol-ring')).toBeNull();
    expect(cardInUrl('https://example.com/' + ID + '.jpg')).toBeNull();
    expect(cardInUrl('Sol Ring')).toBeNull();
  });

  it('finds the card in whatever form the browser hands over', () => {
    expect(cardInDrop({ uriList: `# a comment\nhttps://scryfall.com/card/mkm/198/etrata` })).toEqual({ set: 'mkm', number: '198' });
    // A picture dragged from EDHREC: the page link is EDHREC's, the picture Scryfall's.
    expect(cardInDrop({ uriList: 'https://edhrec.com/cards/etrata', html: `<a href="https://edhrec.com/cards/etrata"><img src="https://cards.scryfall.io/normal/front/0/0/${ID}.jpg?1"></a>` })).toEqual({ id: ID });
    expect(cardInDrop({ text: 'nothing here' })).toBeNull();
  });
});
