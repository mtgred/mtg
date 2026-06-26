-- Sample tournament results for the deck meta tracker (schema:
-- supabase/schemas/tournaments.sql). Committed reference data, loaded after
-- seed.sql so the `cards` table exists.
--
-- Rows use explicit ids so the card lists below can reference their deck. Card
-- entries are inserted by joining a (name, qty, board) VALUES list against
-- `cards`, so any card not present in the current dataset (e.g. when seeding
-- with generate_seed.py --limit) is simply skipped rather than failing the FK.
-- Sequences are bumped past the explicit ids at the end.

insert into tournaments (id, name, format, held_on, location, source_url, player_count) values
  (1, 'Regional Championship — Modern', 'modern',   '2026-05-17', 'Atlanta, GA', null, 312),
  (2, 'Pioneer Open',                   'pioneer',  '2026-04-26', 'Online',      null, 256),
  (3, 'Standard Challenge',             'standard', '2026-06-07', 'Online',      null, 64);

insert into tournament_decks (id, tournament_id, player, archetype, placement, wins, losses, draws) values
  ( 1, 1, 'Sofia Reyes',   'Boros Energy',         1, 13, 2, 0),
  ( 2, 1, 'Marcus Lee',    'Izzet Murktide',       2, 12, 3, 0),
  ( 3, 1, 'Priya Nair',    'Amulet Titan',         3, 12, 3, 0),
  ( 4, 1, 'Tomáš Novák',   'Living End',           4, 11, 4, 0),
  ( 5, 1, 'Yuki Tanaka',   'Domain Zoo',           5, 11, 4, 0),
  ( 6, 1, 'Greg Olsen',    'Mono-Green Tron',      6, 10, 5, 0),
  ( 7, 2, 'Elena Costa',   'Izzet Phoenix',        1,  9, 1, 0),
  ( 8, 2, 'David Kim',     'Rakdos Midrange',      2,  8, 2, 0),
  ( 9, 2, 'Aisha Mohammed','Mono-Green Devotion',  3,  8, 2, 0),
  (10, 2, 'Liam Walsh',    'Azorius Control',      4,  7, 3, 0),
  (11, 2, 'Nina Schmidt',  'Lotus Field Combo',    5,  7, 3, 0),
  (12, 3, 'Carlos Mendes', 'Esper Pixie',          1,  7, 0, 0),
  (13, 3, 'Hana Park',     'Domain Ramp',          2,  6, 1, 0),
  (14, 3, 'Owen Brooks',   'Mono-Red Aggro',       3,  6, 1, 0);

-- Deck 1 — Boros Energy (Sofia Reyes, 1st)
insert into tournament_deck_cards (tournament_deck_id, card_id, quantity, board)
select 1, c.id, v.qty, v.board from (values
  ('Ragavan, Nimble Pilferer', 4, 'main'),
  ('Ocelot Pride', 4, 'main'),
  ('Guide of Souls', 4, 'main'),
  ('Ajani, Nacatl Pariah // Ajani, Nacatl Avenger', 3, 'main'),
  ('Amped Raptor', 4, 'main'),
  ('Phlage, Titan of Fire''s Fury', 4, 'main'),
  ('Goblin Bombardment', 4, 'main'),
  ('Galvanic Discharge', 4, 'main'),
  ('Lightning Bolt', 4, 'main'),
  ('Static Prison', 3, 'main'),
  ('Touch the Spirit Realm', 2, 'main'),
  ('Arid Mesa', 4, 'main'),
  ('Inspiring Vantage', 4, 'main'),
  ('Sacred Foundry', 3, 'main'),
  ('Sunbaked Canyon', 2, 'main'),
  ('Plains', 4, 'main'),
  ('Mountain', 3, 'main'),
  ('Wear // Tear', 3, 'side'),
  ('Path to Exile', 2, 'side'),
  ('Kor Firewalker', 2, 'side'),
  ('Rest in Peace', 2, 'side'),
  ('Smash to Smithereens', 2, 'side'),
  ('Soul-Guide Lantern', 2, 'side'),
  ('Disenchant', 2, 'side')
) as v(name, qty, board) join cards c on c.name = v.name;

-- Deck 2 — Izzet Murktide (Marcus Lee, 2nd)
insert into tournament_deck_cards (tournament_deck_id, card_id, quantity, board)
select 2, c.id, v.qty, v.board from (values
  ('Murktide Regent', 4, 'main'),
  ('Dragon''s Rage Channeler', 4, 'main'),
  ('Phlage, Titan of Fire''s Fury', 2, 'main'),
  ('Subtlety', 2, 'main'),
  ('Lightning Bolt', 4, 'main'),
  ('Unholy Heat', 4, 'main'),
  ('Consider', 4, 'main'),
  ('Counterspell', 4, 'main'),
  ('Spell Pierce', 3, 'main'),
  ('Spell Snare', 2, 'main'),
  ('Expressive Iteration', 3, 'main'),
  ('Mishra''s Bauble', 4, 'main'),
  ('Brazen Borrower // Petty Theft', 1, 'main'),
  ('Scalding Tarn', 4, 'main'),
  ('Misty Rainforest', 3, 'main'),
  ('Spirebluff Canal', 4, 'main'),
  ('Steam Vents', 2, 'main'),
  ('Otawara, Soaring City', 2, 'main'),
  ('Island', 3, 'main'),
  ('Mountain', 1, 'main'),
  ('Mystical Dispute', 2, 'side'),
  ('Blood Moon', 2, 'side'),
  ('Engineered Explosives', 2, 'side'),
  ('Brotherhood''s End', 1, 'side'),
  ('Flusterstorm', 2, 'side'),
  ('Abrade', 2, 'side'),
  ('Unlicensed Hearse', 2, 'side'),
  ('Consign to Memory', 2, 'side')
) as v(name, qty, board) join cards c on c.name = v.name;

-- Deck 3 — Amulet Titan (Priya Nair, 3rd)
insert into tournament_deck_cards (tournament_deck_id, card_id, quantity, board)
select 3, c.id, v.qty, v.board from (values
  ('Primeval Titan', 4, 'main'),
  ('Amulet of Vigor', 4, 'main'),
  ('Arboreal Grazer', 4, 'main'),
  ('Azusa, Lost but Seeking', 3, 'main'),
  ('Dryad of the Ilysian Grove', 2, 'main'),
  ('Summoner''s Pact', 4, 'main'),
  ('Scapeshift', 2, 'main'),
  ('Cultivator Colossus', 1, 'main'),
  ('The One Ring', 2, 'main'),
  ('Simic Growth Chamber', 4, 'main'),
  ('Boros Garrison', 2, 'main'),
  ('Gruul Turf', 1, 'main'),
  ('Selesnya Sanctuary', 1, 'main'),
  ('Urza''s Saga', 4, 'main'),
  ('Tolaria West', 3, 'main'),
  ('Valakut, the Molten Pinnacle', 1, 'main'),
  ('Slayers'' Stronghold', 1, 'main'),
  ('Sunhome, Fortress of the Legion', 1, 'main'),
  ('Vesuva', 2, 'main'),
  ('Cavern of Souls', 1, 'main'),
  ('Radiant Fountain', 3, 'main'),
  ('Castle Garenbrig', 1, 'main'),
  ('Forest', 9, 'main'),
  ('Engineered Explosives', 2, 'side'),
  ('Pithing Needle', 2, 'side'),
  ('Boseiju, Who Endures', 2, 'side'),
  ('Dismember', 2, 'side'),
  ('Force of Vigor', 3, 'side'),
  ('Obstinate Baloth', 2, 'side'),
  ('The One Ring', 2, 'side')
) as v(name, qty, board) join cards c on c.name = v.name;

-- Deck 4 — Living End (Tomáš Novák, 4th)
insert into tournament_deck_cards (tournament_deck_id, card_id, quantity, board)
select 4, c.id, v.qty, v.board from (values
  ('Living End', 4, 'main'),
  ('Grief', 4, 'main'),
  ('Curator of Mysteries', 4, 'main'),
  ('Striped Riverwinder', 3, 'main'),
  ('Waker of Waves', 3, 'main'),
  ('Generous Ent', 3, 'main'),
  ('Architects of Will', 4, 'main'),
  ('Shardless Agent', 4, 'main'),
  ('Violent Outburst', 4, 'main'),
  ('Subtlety', 2, 'main'),
  ('Foundation Breaker', 2, 'main'),
  ('Force of Negation', 2, 'main'),
  ('Verdant Catacombs', 4, 'main'),
  ('Blood Crypt', 2, 'main'),
  ('Overgrown Tomb', 1, 'main'),
  ('Steam Vents', 1, 'main'),
  ('Stomping Ground', 1, 'main'),
  ('Tranquil Thicket', 2, 'main'),
  ('Lonely Sandbar', 2, 'main'),
  ('Ketria Triome', 1, 'main'),
  ('Savai Triome', 1, 'main'),
  ('Otawara, Soaring City', 1, 'main'),
  ('Forest', 2, 'main'),
  ('Swamp', 1, 'main'),
  ('Mountain', 1, 'main'),
  ('Island', 1, 'main'),
  ('Force of Negation', 2, 'side'),
  ('Brotherhood''s End', 2, 'side'),
  ('Leyline of the Void', 3, 'side'),
  ('Ingot Chewer', 2, 'side'),
  ('Endurance', 2, 'side'),
  ('Fury', 2, 'side'),
  ('Mystical Dispute', 2, 'side')
) as v(name, qty, board) join cards c on c.name = v.name;

-- Deck 7 — Izzet Phoenix (Elena Costa, 1st)
insert into tournament_deck_cards (tournament_deck_id, card_id, quantity, board)
select 7, c.id, v.qty, v.board from (values
  ('Arclight Phoenix', 4, 'main'),
  ('Ledger Shredder', 4, 'main'),
  ('Sprite Dragon', 2, 'main'),
  ('Crackling Drake', 2, 'main'),
  ('Picklock Prankster // Free the Fae', 4, 'main'),
  ('Consider', 4, 'main'),
  ('Opt', 4, 'main'),
  ('Treasure Cruise', 4, 'main'),
  ('Pieces of the Puzzle', 3, 'main'),
  ('Lightning Axe', 4, 'main'),
  ('Fiery Impulse', 3, 'main'),
  ('Spell Pierce', 2, 'main'),
  ('Galvanic Iteration', 1, 'main'),
  ('Steam Vents', 4, 'main'),
  ('Spirebluff Canal', 4, 'main'),
  ('Riverglide Pathway // Lavaglide Pathway', 2, 'main'),
  ('Stormcarved Coast', 1, 'main'),
  ('Otawara, Soaring City', 1, 'main'),
  ('Island', 4, 'main'),
  ('Mountain', 3, 'main'),
  ('Abrade', 3, 'side'),
  ('Mystical Dispute', 2, 'side'),
  ('Disdainful Stroke', 2, 'side'),
  ('Brotherhood''s End', 2, 'side'),
  ('Narset, Parter of Veils', 2, 'side'),
  ('Anger of the Gods', 2, 'side'),
  ('Aether Gust', 2, 'side')
) as v(name, qty, board) join cards c on c.name = v.name;

-- Deck 8 — Rakdos Midrange (David Kim, 2nd)
insert into tournament_deck_cards (tournament_deck_id, card_id, quantity, board)
select 8, c.id, v.qty, v.board from (values
  ('Bloodtithe Harvester', 4, 'main'),
  ('Fable of the Mirror-Breaker // Reflection of Kiki-Jiki', 4, 'main'),
  ('Sheoldred, the Apocalypse', 3, 'main'),
  ('Graveyard Trespasser // Graveyard Glutton', 2, 'main'),
  ('Liliana of the Veil', 2, 'main'),
  ('Thoughtseize', 4, 'main'),
  ('Duress', 2, 'main'),
  ('Fatal Push', 3, 'main'),
  ('Cut Down', 4, 'main'),
  ('Go for the Throat', 2, 'main'),
  ('Bloodchief''s Thirst', 3, 'main'),
  ('Soul Shatter', 2, 'main'),
  ('Blackcleave Cliffs', 4, 'main'),
  ('Haunted Ridge', 4, 'main'),
  ('Blood Crypt', 2, 'main'),
  ('Sulfurous Springs', 2, 'main'),
  ('Den of the Bugbear', 2, 'main'),
  ('Takenuma, Abandoned Mire', 1, 'main'),
  ('Mutavault', 1, 'main'),
  ('Swamp', 5, 'main'),
  ('Mountain', 4, 'main'),
  ('Duress', 2, 'side'),
  ('Go for the Throat', 2, 'side'),
  ('Abrade', 3, 'side'),
  ('Kolaghan''s Command', 2, 'side'),
  ('Unlicensed Hearse', 2, 'side'),
  ('Disfigure', 2, 'side'),
  ('Brotherhood''s End', 2, 'side')
) as v(name, qty, board) join cards c on c.name = v.name;

-- Deck 12 — Esper Pixie (Carlos Mendes, 1st)
insert into tournament_deck_cards (tournament_deck_id, card_id, quantity, board)
select 12, c.id, v.qty, v.board from (values
  ('Fear of Isolation', 4, 'main'),
  ('Nowhere to Run', 4, 'main'),
  ('Stormchaser''s Talent', 4, 'main'),
  ('Enduring Curiosity', 4, 'main'),
  ('This Town Ain''t Big Enough', 4, 'main'),
  ('Floodpits Drowner', 4, 'main'),
  ('Faerie Mastermind', 2, 'main'),
  ('Kaito, Bane of Nightmares', 2, 'main'),
  ('Get Out', 4, 'main'),
  ('Cut Down', 3, 'main'),
  ('Gloomlake Verge', 4, 'main'),
  ('Watery Grave', 4, 'main'),
  ('Godless Shrine', 2, 'main'),
  ('Drowned Catacomb', 2, 'main'),
  ('Island', 7, 'main'),
  ('Swamp', 3, 'main'),
  ('Plains', 3, 'main'),
  ('Duress', 3, 'side'),
  ('Negate', 2, 'side'),
  ('Kutzil''s Flanker', 2, 'side'),
  ('Tishana''s Tidebinder', 2, 'side'),
  ('Sheoldred, the Apocalypse', 2, 'side'),
  ('Temporary Lockdown', 2, 'side'),
  ('Anoint with Affliction', 2, 'side')
) as v(name, qty, board) join cards c on c.name = v.name;

-- Bump sequences past the explicit ids inserted above.
select setval('tournaments_id_seq', (select max(id) from tournaments));
select setval('tournament_decks_id_seq', (select max(id) from tournament_decks));
select setval('tournament_deck_cards_id_seq', coalesce((select max(id) from tournament_deck_cards), 1));
