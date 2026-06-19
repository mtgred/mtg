-- Reference data for the formats table (supabase/schemas/formats.sql).
-- Committed (unlike the generated seed.sql) so the deck format list is stable
-- and always present. Codes match the keys in cards.legalities.
insert into formats (code, name, sort_order, description) values
  ('standard',        'Standard',          10, 'Standard is the flagship rotating Constructed format, built only from cards in roughly the most recent two to three years of Magic sets. As new sets release the oldest ones rotate out, keeping the card pool fresh and accessible.'),
  ('pioneer',         'Pioneer',           20, 'Pioneer is a non-rotating format spanning every Standard-legal expansion from Return to Ravnica (2012) onward, bridging the gap between the recency of Standard and the depth of Modern.'),
  ('modern',          'Modern',            30, 'Modern includes almost every expansion and core set from Eighth Edition (2003) forward — the year the modern card frame debuted. It is a high-powered, non-rotating format with a large, ever-growing card pool.'),
  ('legacy',          'Legacy',            40, 'Legacy is an eternal format that allows cards from every Magic set ever printed, reined in only by a banned list. The Reserved List keeps many of its staples rare and expensive.'),
  ('vintage',         'Vintage',           50, 'Vintage is the most powerful eternal format, permitting nearly every card ever printed. Rather than banning its most degenerate cards — like the Power Nine — it restricts them to a single copy per deck.'),
  ('pauper',          'Pauper',            60, 'Pauper is an eternal format in which every card must have been printed at common rarity. Its low buy-in belies a deep, competitive metagame.'),
  ('commander',       'Commander',         70, 'Commander (EDH) is the most popular casual format: a 100-card singleton deck led by a legendary creature whose color identity constrains the whole deck. It is usually played in multiplayer games starting at 40 life.'),
  ('brawl',           'Brawl',             80, 'Brawl is a singleton format that pairs Commander''s rules with a Standard-legal card pool, led by a legendary creature or planeswalker. It plays like a smaller, rotating Commander.'),
  ('standardbrawl',   'Standard Brawl',    90, 'Standard Brawl is the one-on-one, Standard-legal take on Brawl — singleton decks helmed by a legendary commander, drawn only from the current Standard sets.'),
  ('oathbreaker',     'Oathbreaker',      100, 'Oathbreaker is a community format in which a planeswalker "oathbreaker" and an associated "signature spell" lead a 60-card singleton deck built from Magic''s entire history.'),
  ('paupercommander', 'Pauper Commander', 110, 'Pauper Commander (PDH) is a 100-card singleton format where the commander must be an uncommon creature and the remaining 99 cards are built entirely from commons.'),
  ('duel',            'Duel Commander',   120, 'Duel Commander is a competitive one-on-one variant of Commander, played with a 100-card singleton deck, a 20-life starting total, and its own dedicated banned list.'),
  ('penny',           'Penny Dreadful',   130, 'Penny Dreadful is a rotating, budget eternal format in which every legal card costs about one cent online. The legal list is recalculated each season from current market prices.'),
  ('premodern',       'Premodern',        140, 'Premodern is a community-created Constructed format using the sets from Fourth Edition (1995) through Scourge (2003), evoking the era of Magic just before the modern card frame.'),
  ('oldschool',       'Old School',       150, 'Old School (93/94) recreates Magic''s earliest days, allowing only cards from the original sets printed in 1993 and 1994. Exact rules and banned lists vary by playgroup.'),
  ('historic',        'Historic',         160, 'Historic is a non-rotating format exclusive to MTG Arena, drawing on the full pool of cards available on the platform — including digital-only releases.'),
  ('alchemy',         'Alchemy',          170, 'Alchemy is a fast-rotating, Arena-only format that layers digitally rebalanced and digital-only cards on top of the Standard pool, with frequent balance updates.'),
  ('timeless',        'Timeless',         180, 'Timeless is MTG Arena''s highest-power, non-rotating format, allowing every card available on Arena with only a short banned list and a handful of restricted cards.'),
  ('gladiator',       'Gladiator',        190, 'Gladiator is a 100-card singleton format for MTG Arena played without a commander, using Arena''s card pool in one-on-one games.'),
  ('predh',           'PreDH',            200, 'PreDH is a Commander variant restricted to cards printed before the first Commander product in 2011, offering an old-school take on the singleton multiplayer format.'),
  ('future',          'Future Standard',  210, 'Future Standard is a forward-looking view of the Standard environment, showing which cards will remain legal after the next rotation rather than a currently played format.')
on conflict (code) do update
  set name = excluded.name, sort_order = excluded.sort_order, description = excluded.description;

-- Old School (93/94) is a community format whose banned/restricted lists are
-- maintained by Eternal Central, not Scryfall, so we curate them here verbatim
-- from https://www.eternalcentral.com/9394rules/ rather than reading legalities.
update formats set
  banned_cards = array[
    'Bronze Tablet',
    'Contract from Below',
    'Darkpact',
    'Demonic Attorney',
    'Jeweled Bird',
    'Rebirth',
    'Tempest Efreet'
  ],
  restricted_cards = array[
    'Ancestral Recall',
    'Balance',
    'Black Lotus',
    'Braingeyser',
    'Chaos Orb',
    'Channel',
    'Demonic Tutor',
    'Library of Alexandria',
    'Mana Drain',
    'Mind Twist',
    'Mox Emerald',
    'Mox Jet',
    'Mox Pearl',
    'Mox Ruby',
    'Mox Sapphire',
    'Recall',
    'Regrowth',
    'Sol Ring',
    'Time Vault',
    'Time Walk',
    'Timetwister',
    'Wheel of Fortune'
  ]
where code = 'oldschool';
