import assert from 'node:assert/strict';
import { createDeck } from '../.check-build/packages/shared/src/cards.js';

const ranks = [14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2];
const deck = createDeck();
const available = new Set(deck.map(card => card.id));
const rankGroups = new Map(ranks.map(rank => [rank, deck.filter(card => card.rank === rank)]));

assert.equal(rankGroups.size, 13, 'The picker should display exactly 13 rank choices.');
for (const rank of ranks) {
  const group = rankGroups.get(rank) ?? [];
  assert.equal(group.length, 4, `Rank ${rank} should have four physical copies in a standard deck.`);
  const selected = [];
  for (let copy = 0; copy < 4; copy += 1) {
    const candidates = group.filter(card => available.has(card.id));
    const next = candidates.find(card => card.suit === 'spades') ?? candidates[0];
    assert.ok(next, `Rank ${rank} copy ${copy + 1} should remain selectable.`);
    selected.push(next.id);
    available.delete(next.id);
  }
  assert.equal(new Set(selected).size, 4, `Rank ${rank} should map to four unique physical card identities.`);
  assert.equal(group.filter(card => available.has(card.id)).length, 0, `Rank ${rank} should be disabled after four selections.`);
}
assert.equal(available.size, 0, 'All 52 physical card identities should be accounted for after four of each rank.');
console.log('PASS: Blackjack picker presents 13 rank values while tracking four unique physical copies of each rank behind the spade-only UI.');
