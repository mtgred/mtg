-- Archetype classifier definitions (schema: supabase/schemas/archetypes.sql).
-- Committed reference data, loaded after formats.sql (the only dependency).
-- signature_cards use exact cards.name; a card absent from the current dataset
-- simply never matches. min_signatures null => require every signature card.
--
-- Pioneer/Standard coverage tracks the sample decks in
-- supabase/seeds/tournaments.sql so the classifier visibly reproduces their
-- labels; a few extra real archetypes are included to exercise the rules table.

-- Modern. Archetype names and sort order follow the mtgdecks.net metagame page
-- (https://mtgdecks.net/Modern, July 2026); signature cards were picked from
-- each archetype's mtgdecks "average deck" play rates, preferring cards unique
-- to the archetype. Overlapping shells (Energy, Blink, Reanimator, Eldrazi,
-- cascade) disambiguate by matched count: the specific variant lists the shared
-- core plus its own cards with a higher min, so it out-matches the generic one
-- (matched DESC in tournament_deck_archetypes). Izzet Murktide and Mono-Green
-- Tron sit at the end for older tournaments.sql sample decks.
insert into archetypes (format, name, sort_order, signature_cards, min_signatures) values
  ('modern', 'Boros Energy',              10, array['Guide of Souls', 'Ocelot Pride', 'Ajani, Nacatl Pariah // Ajani, Nacatl Avenger', 'Galvanic Discharge'], 3),
  ('modern', 'Izzet Metalcraft',          20, array['Mox Opal', 'Kappa Cannoneer', 'Emry, Lurker of the Loch', 'Pinnacle Emissary'], 2),
  ('modern', 'Izzet Prowess',             30, array['Monastery Swiftspear', 'Lava Dart', 'Expressive Iteration', 'Dragon''s Rage Channeler', 'Mutagenic Growth'], 3),
  ('modern', 'Esper Reanimator',          40, array['Goryo''s Vengeance', 'Atraxa, Grand Unifier', 'Griselbrand', 'Faithful Mending', 'Ephemerate', 'Solitude'], 3),
  ('modern', 'Eldrazi Tron',              50, array['Urza''s Tower', 'Urza''s Mine', 'Urza''s Power Plant', 'Eldrazi Temple', 'Thought-Knot Seer', 'Karn, the Great Creator'], 5),
  ('modern', 'Eldrazi Bloodchief Combo',  60, array['Basking Broodscale', 'Blade of the Bloodchief', 'Glaring Fleshraker', 'Ancient Stirrings'], 2),
  ('modern', 'Grixis Reanimator',         70, array['Persist', 'Archon of Cruelty', 'Faithless Looting', 'Psychic Frog', 'Emperor of Bones'], 3),
  ('modern', 'Living End',                80, array['Living End', 'Shardless Agent', 'Curator of Mysteries'], 1),
  ('modern', 'Boros Wildfire',            90, array['Cleansing Wildfire', 'Price of Freedom', 'Demolition Field'], 2),
  ('modern', 'Ruby Storm',               100, array['Ral, Monsoon Mage // Ral, Leyline Prodigy', 'Pyretic Ritual', 'Desperate Ritual', 'Ruby Medallion'], 2),
  ('modern', 'Eldrazi Ramp',             110, array['Sowing Mycospawn', 'Kozilek''s Command', 'Emrakul, the Promised End', 'Utopia Sprawl', 'Talisman of Impulse'], 3),
  ('modern', 'Domain Aggro',             120, array['Scion of Draco', 'Territorial Kavu', 'Leyline of the Guildpact', 'Tribal Flames'], 2),
  ('modern', 'Esper Blink',              130, array['Solitude', 'Ephemerate', 'Phelia, Exuberant Shepherd', 'Overlord of the Balemurk', 'Watery Grave', 'Godless Shrine'], 4),
  ('modern', 'Azorius Blink',            140, array['Solitude', 'Ephemerate', 'Quantum Riddler', 'Hallowed Fountain', 'Phelia, Exuberant Shepherd'], 4),
  ('modern', 'Azorius Control',          150, array['Supreme Verdict', 'Teferi, Time Raveler', 'Counterspell', 'Prismatic Ending', 'Hall of Storm Giants'], 3),
  ('modern', 'Dimir Frog',               160, array['Psychic Frog', 'Counterspell', 'Spell Snare', 'Fatal Push'], 3),
  ('modern', 'Amulet Titan',             170, array['Primeval Titan', 'Amulet of Vigor'], 2),
  ('modern', 'Tameshi Belcher',          180, array['Tameshi, Reality Architect', 'Goblin Charbelcher', 'Lotus Bloom'], 2),
  ('modern', 'Golgari Yawgmoth',         190, array['Yawgmoth, Thran Physician', 'Young Wolf', 'Chord of Calling'], 2),
  ('modern', 'Burn',                     200, array['Lava Spike', 'Boros Charm', 'Goblin Guide', 'Rift Bolt', 'Searing Blaze'], 3),
  ('modern', 'Jeskai Blink',             210, array['Solitude', 'Ephemerate', 'Quantum Riddler', 'Phlage, Titan of Fire''s Fury', 'Steam Vents', 'Arena of Glory', 'Consign to Memory'], 5),
  ('modern', 'Simic Ritual',             220, array['Birthing Ritual', 'Ice-Fang Coatl', 'Coiling Oracle'], 2),
  ('modern', 'Jeskai Control',           230, array['Phlage, Titan of Fire''s Fury', 'Wrath of the Skies', 'Teferi, Time Raveler', 'Counterspell', 'Galvanic Discharge', 'Steam Vents'], 4),
  ('modern', 'Samwise Combo',            240, array['Samwise Gamgee', 'Cauldron Familiar', 'Viscera Seer', 'Gilded Goose'], 2),
  ('modern', 'Mono Black Necrodominance', 250, array['Necrodominance', 'Soul Spike', 'Sheoldred, the Apocalypse'], 2),
  ('modern', 'Neoform',                  260, array['Allosaurus Rider', 'Neoform', 'Eldritch Evolution', 'Summoner''s Pact'], 2),
  ('modern', 'Hollow One',               270, array['Hollow One', 'Burning Inquiry', 'Goblin Lore'], 2),
  ('modern', 'Mardu Energy',             280, array['Guide of Souls', 'Ocelot Pride', 'Ajani, Nacatl Pariah // Ajani, Nacatl Avenger', 'Orcish Bowmasters', 'Godless Shrine', 'Blood Crypt'], 5),
  ('modern', 'Temur Cascade',            290, array['Crashing Footfalls', 'Violent Outburst', 'Shardless Agent', 'Fire // Ice'], 2),
  ('modern', 'Izzet Murktide',           300, array['Murktide Regent', 'Dragon''s Rage Channeler'], 2),
  ('modern', 'Mono-Green Tron',          310, array['Urza''s Tower', 'Urza''s Mine', 'Urza''s Power Plant'], 2);

insert into archetypes (format, name, sort_order, signature_cards, min_signatures) values
  -- Pioneer
  ('pioneer',  'Izzet Phoenix',      10, array['Arclight Phoenix'],                                            1),
  ('pioneer',  'Rakdos Midrange',    20, array['Bloodtithe Harvester', 'Fable of the Mirror-Breaker // Reflection of Kiki-Jiki'], 1),
  ('pioneer',  'Mono-Green Devotion',30, array['Old-Growth Troll', 'Cavalier of Thorns', 'Karn, the Great Creator'], 2),
  ('pioneer',  'Lotus Field Combo',  40, array['Lotus Field', 'Thespian''s Stage'],                            2),
  -- Standard
  ('standard', 'Esper Pixie',        10, array['Fear of Isolation', 'Stormchaser''s Talent', 'This Town Ain''t Big Enough'], 2),
  ('standard', 'Mono-Red Aggro',     20, array['Heartfire Hero', 'Monstrous Rage', 'Screaming Nemesis'],       2),
  ('standard', 'Domain Ramp',        30, array['Zur, Eternal Schemer', 'Leyline Binding', 'Overlord of the Hauntwoods'], 2);

-- Premodern. Archetype names follow the tcdecks.net Premodern archetype list
-- (https://www.tcdecks.net/format.php?format=Premodern). Combo decks named
-- after their engine come first (a single decisive card => min 1); Survival
-- variants share the base card and are split by their second engine piece —
-- the generic 'Survival - Other' catches the rest because specific variants
-- out-match it (matched DESC in tournament_deck_archetypes).
insert into archetypes (format, name, sort_order, signature_cards, min_signatures) values
  ('premodern', 'Stiflenought',            30, array['Phyrexian Dreadnought', 'Stifle', 'Vision Charm', 'Foil', 'Impulse', 'Flash of Insight'],  4),
  ('premodern', 'Parallax Replenish',      10, array['Replenish', 'Opalescence', 'Parallax Wave', 'Attunement'],         null),
  ('premodern', 'Enchantress',            340, array['Argothian Enchantress', 'Enchantress''s Presence', 'Wild Growth', 'Elephant Grass', 'Solitary Confinement', 'Sterling Grove'], 3),
  ('premodern', 'Landstill',              610, array['Counterspell', 'Standstill', 'Wrath of God', 'Faerie Conclave', 'Decree of Justice', 'Dust Bowl', 'Mishra''s Factory'],   6),
  ('premodern', 'RG Sligh',               390, array['Grim Lavamancer', 'Mogg Fanatic', 'Lightning Bolt', 'Sylvan Library', 'Treetop Village', 'Call of the Herd', 'Karplusan Forest'], 5),
  ('premodern', 'Sligh',                  400, array['Cursed Scroll', 'Jackal Pup', 'Mogg Fanatic', 'Fireblast', 'Grim Lavamancer', 'Ball Lightning', 'Seal of Fire', 'Barbarian Ring'], 5),
  ('premodern', 'Burn',                   405, array['Lightning Bolt', 'Incinerate', 'Fireblast', 'Sulfuric Vortex', 'Flame Rift', 'Black Vise', 'Pyrostatic Pillar'], 5),
  ('premodern', '5C Oath Ponza',          295, array['Oath of Druids', 'Sphere of Resistance', 'Thermokarst', 'Winter''s Grasp', 'Terravore', 'City of Brass', 'Gemstone Mine'],   5),
  ('premodern', 'GW Oath Ponza',          295, array['Oath of Druids', 'Sphere of Resistance', 'Thermokarst', 'Winter''s Grasp', 'Terravore', 'Brushland'],   4),
  ('premodern', 'GR Oath Ponza',          296, array['Oath of Druids', 'Sphere of Resistance', 'Thermokarst', 'Winter''s Grasp', 'Terravore', 'Karplusan Forest'],   4),
  ('premodern', 'Terrageddon',            310, array['Terravore', 'Armageddon', 'Cataclysm'],                            2),
  ('premodern', 'Stasis',                 120, array['Stasis'],                                                          1),
  ('premodern', 'The Rock',               650, array['Pernicious Deed', 'Wall of Blossoms', 'Wall of Roots', 'Ravenous Rats', 'Krosan Tusker', 'Yavimaya Elder', 'Duress', 'Cabal Therapy'], 5),
  ('premodern', 'Full English Breakfast', 210, array['Survival of the Fittest', 'Volrath''s Shapeshifter', 'Phyrexian Devourer', 'Hermit Druid', 'Unearth', 'Psychatog', 'Palinchron'], 5),
  ('premodern', 'Devourer Combo',         200, array['Phyrexian Devourer', 'Tinker', 'Fling', 'Altar of Dementia'], 3),
  ('premodern', 'Pit Rack',               640, array['Ravenous Rats', 'The Rack', 'Bottomless Pit'], 3),
  ('premodern', 'Aluren',                  50, array['Aluren', 'Cavern Harpy', 'Raven Familiar', 'Soul Warden'], 3),
  ('premodern', 'Deadguy Ale',            540, array['Gerrard''s Verdict', 'Vindicate', 'Dark Ritual', 'Hypnotic Specter', 'Caves of Koilos', 'Tainted Field', 'Swords to Plowshares'], 5),
  ('premodern', 'Pandeburst',              20, array['Saproling Burst', 'Pandemonium'],                                  null),
  ('premodern', 'Trix',                    40, array['Illusions of Grandeur', 'Donate'],                                 null),
  ('premodern', 'Doomsday',                60, array['Doomsday'],                                                        1),
  ('premodern', 'Fluctuator',              70, array['Fluctuator'],                                                      1),
  ('premodern', 'Battle of Wits',          80, array['Battle of Wits', 'Survival of the Fittest', 'Academy Rector', 'Natural Order', 'Cunning Wish', 'Intuition', 'Wordly Tutor'], 5),
  ('premodern', 'Dragonstorm',             90, array['Dragonstorm'],                                                     1),
  ('premodern', 'Dream Halls',            100, array['Dream Halls'],                                                     1),
  ('premodern', 'Sneak Attack',           110, array['Sneak Attack'],                                                    1),
  ('premodern', 'Iggy Pop',               130, array['Ill-Gotten Gains', 'Lion''s Eye Diamond', 'Cabal Ritual'],          null),
  ('premodern', 'Storm',                  140, array['Helm of Awakening', 'Lotus Petal', 'Lion''s Eye Diamond', 'Frantic Search', 'Cunning Wish', 'Cloud of Faeries', 'Sapphire Medallion', 'Brain Freeze'],  5),
  ('premodern', 'Cephalid Breakfast',     150, array['Cephalid Illusionist', 'Nomads en-Kor'],                           null),
  ('premodern', 'Life',                   160, array['Daru Spiritualist', 'Task Force', 'Worthy Cause', 'Starlit Sanctum'], 2),
  ('premodern', 'Pebbles',                170, array['Enduring Renewal', 'Goblin Bombardment'],                          null),
  ('premodern', 'Pattern Rector',         180, array['Pattern of Rebirth', 'Academy Rector'],                            null),
  ('premodern', 'Survival Infestation',   220, array['Survival of the Fittest', 'Zombie Infestation'],                   null),
  ('premodern', 'Survival Recurring',     230, array['Survival of the Fittest', 'Recurring Nightmare'],                  null),
  ('premodern', 'Survival Opposition',    240, array['Survival of the Fittest', 'Opposition'],                           null),
  ('premodern', 'Survival Welder',        250, array['Survival of the Fittest', 'Goblin Welder'],                        null),
  ('premodern', 'Reanimator',             270, array['Exhume', 'Animate Dead', 'Reanimate'],                             2),
  ('premodern', 'Frenetic Encounter',     280, array['Frenetic Efreet', 'Chance Encounter'],                             null),
  ('premodern', 'Pyrostatic Oath',        290, array['Oath of Druids', 'Pyrostatic Pillar'],                             null),
  ('premodern', 'Balancing Tings',        320, array['Balancing Act'],                                                   1),
  ('premodern', 'Turbo Lands',            330, array['Horn of Greed', 'Exploration', 'Time Warp'],                       2),
  ('premodern', 'Gamekeeper',             350, array['Gamekeeper'],                                                      1),
  ('premodern', 'Trinity',                360, array['Rofellos, Llanowar Emissary', 'Plow Under'],                       2),
  ('premodern', 'Angry Ghoul',            380, array['Hermit Druid', 'Sutured Ghoul', 'Shallow Grave', 'Dragon Breath', 'Reanimate', 'Worldly Tutor', 'Phyrexian Dreadnought', 'Lotus Petal', 'Vision Charm', 'Stifle'], 7),
  ('premodern', 'Goblins',                410, array['Goblin Lackey', 'Goblin Matron', 'Goblin Ringleader', 'Goblin Piledriver', 'Goblin Sharpshooter'], 2),
  ('premodern', 'White Weenie',           420, array['Savannah Lions', 'Mother of Runes', 'Soltari Priest', 'Soltari Monk', 'Empyrial Armor'], 2),
  ('premodern', 'Rebels',                 430, array['Ramosian Sergeant', 'Lin Sivvi, Defiant Hero'],                    1),
  ('premodern', 'Elves',                  440, array['Priest of Titania', 'Quirion Ranger', 'Wirewood Symbiote', 'Llanowar Elves'], 2),
  ('premodern', 'UG Madness',             450, array['Wild Mongrel', 'Arrogant Wurm', 'Basking Rootwalla', 'Yavimaya Coast'], null),
  ('premodern', 'RG Survival Madness',    450, array['Wild Mongrel', 'Arrogant Wurm', 'Basking Rootwalla', 'Survival of the Fittest', 'Squee, Goblin Nabob', 'Karplusan Forest'], null),
  ('premodern', 'Gro-A-Tog',              470, array['Psychatog', 'Quirion Dryad', 'Gush'],                              null),
  ('premodern', 'Mono Green',             485, array['Rogue Elephant', 'Skyshroud Elite', 'River Boa', 'Rancor', 'Pouncing Jaguar', 'Wild Dogs', 'Ravenous Baloth', 'Krosan Tusker', 'Living Wish'], 3),
  ('premodern', 'Clerics',                488, array['Rotlung Reanimator', 'Dark Supplicant', 'Scion of Darkness', 'Cabal Archon', 'Priest of Gix'], 4),
  ('premodern', 'Zombies',                490, array['Rotlung Reanimator', 'Lord of the Undead', 'Carnophage'], 2),
  ('premodern', 'Mono Black Aggro',       495, array['Dauthi Slayer', 'Dauthi Horror', 'Skittering Skirge', 'Carnophage', 'Sarcomancy', 'Bad Moon'], 3),
  ('premodern', 'Mono Black Discard',     495, array['The Rack', 'Funeral Charm', 'Chain of Smog'], 3),
  ('premodern', 'Suicide Black',          495, array['Hatred', 'Carnophage', 'Sarcomancy', 'Dark Ritual', 'Phyrexian Negator', 'Karvek''s Spite'], 4),
  ('premodern', 'Contamination',          500, array['Contamination', 'Nether Spirit', 'Zombie Infestation'],            2),
  ('premodern', 'Zombie Infestation',     500, array['Zombie Infestation', 'Squee, Goblin Nabob', 'Krovikan Horror', 'Gush', 'Intuition'], 4),
  ('premodern', 'Merfolks',               510, array['Lord of Atlantis'],                                                1),
  ('premodern', 'Slivers',                520, array['Muscle Sliver', 'Crystalline Sliver', 'Winged Sliver'],            2),
  ('premodern', 'Tireless Tribe',         530, array['Tireless Tribe', 'Patrol Hound', 'Glory', 'Wild Mongrel', 'Mother of Runes'],         3),
  ('premodern', 'BW Control',             545, array['Vindicate', 'Gerrard''s Verdict', 'Swords to Plowshares', 'Caves of Koilos', 'Eternal Dragon'], null),
  ('premodern', 'Psychatog',              600, array['Psychatog'],                                                       1),
  ('premodern', 'Mono Black Ponza',       620, array['Icequake', 'Rain of Tears', 'Braids, Cabal Minion', 'Rancid Earth', 'Rishadan Port'], 4),
  ('premodern', 'Moneyball Black',        625, array['Hypnotic Specter', 'Duress', 'Cabal Therapy', 'Dark Ritual', 'Withered Wretch', 'Nantuko Shade', 'Graveborn Muse', 'Cursed Scroll'], 6),
  ('premodern', 'Pox',                    630, array['Pox'],                                                             1),
  ('premodern', 'Nic Fit',                660, array['Veteran Explorer', 'Cabal Therapy'],                               null),
  ('premodern', 'Parfait',                670, array['Tithe', 'Scroll Rack', 'Abeyance', 'Intuition', 'Gaea''s Blessing'], 3),
  ('premodern', 'RW Rifter',              680, array['Lightning Rift', 'Astral Slide', 'Decree of Justice', 'Eternal Dragon', 'Renewed Faith', 'Secluded Steppe', 'Forgotten Cave'], 4),
  ('premodern', 'Mono Red Ponza',         690, array['Stone Rain', 'Pillage', 'Avalanche Riders'],                       null),
  ('premodern', 'Mono Green Ponza',       690, array['Thermokarst', 'Winter''s Grasp', 'Creeping Mold', 'Llanowar Elves'], 3),
  ('premodern', 'Tron',                   700, array['Urza''s Tower', 'Urza''s Mine', 'Urza''s Power Plant'],            2),
  ('premodern', 'MUD',                    710, array['Winter Orb', 'Tangle Wire', 'Thran Dynamo', 'Tinker', 'Goblin Welder'], 4),
  ('premodern', 'Wake Control',           720, array['Mirari''s Wake'],                                                  1),
  ('premodern', 'Draco Blast',            730, array['Draco', 'Erratic Explosion'],                                      null),
  ('premodern', 'Domain',                 740, array['Collective Restraint', 'Allied Strategies'],                       1),
  ('premodern', 'Fires',                  750, array['Fires of Yavimaya'],                                               1),
  ('premodern', '5C Negator',             750, array['Phyrexian Negator', 'Thornscape Apprentice', 'Lightning Bolt', 'Mother of Runes', 'City of Brass', 'Gemstone Mine', 'Reflecting Pool'], 5),
  ('premodern', 'The Solution',           750, array['Lightning Angel', 'Swords to Plowshares', 'Meddling Mage', 'Birds of Paradise', 'Lightning Bolt', 'Fire // Ice', 'Mother of Runes', 'Shivan Reef'], 5),
  ('premodern', 'Wurm Rack',              750, array['Ravenous Rats', 'Tempting Wurm', 'Cabal Therapy', 'Duress', 'Call of the Herd', 'The Rack', 'Llanowar Wastes'], 5),
  ('premodern', 'Machine Head',           750, array['Hypnotic Specter', 'Dark Ritual', 'Blazing Specter', 'Terminate', 'Lavaborn Muse', 'The Rack', 'Lightning Bolt', 'Sulfurous Springs'], 5),
  ('premodern', 'Jund',                   750, array['Ravenous Rats', 'Tempting Wurm', 'Cabal Therapy', 'Call of the Herd', 'Lightning Bolt', 'Terminate', 'Sulfurous Springs'], 5),
  ('premodern', 'Minotaur',               750, array['Digeridoo', 'Minotaur Illusionist', 'Tahngarth, Talruum Hero', 'Prophetic Bolt', 'Counterspell', 'Lightning Bolt'], 3),
  ('premodern', 'Mono Black Control',     755, array['Corrupt', 'Drain Life', 'Nightmare', 'Skeletal Scrying', 'Nevinyrral''s Disk'], 3),
  ('premodern', 'Mono Red Control',       760, array['Shard Phoenix', 'Hammer of Bogardan', 'Pillage', 'Lightning Bolt', 'Powder Keg', 'Nevinyrral''s Disk'], 3),
  ('premodern', 'Mono White Control',     770, array['Wrath of God', 'Exalted Angel', 'Eternal Dragon', 'Decree of Justice', 'Marble Diamond'], 3),
  ('premodern', 'Mono Blue Control',      770, array['Rainbow Efreet', 'Counterspell'], null),
  ('premodern', 'UW Control',             780, array['Counterspell', 'Wrath of God', 'Exalted Angel', 'Accumulated Knowledge', 'Adarkar Wastes'], 4),
  ('premodern', 'UR Control',             790, array['Prophetic Bolt', 'Lightning Bolt', 'Counterspell', 'Standstill', 'Nevinyrral''s Disk', 'Shivan Reef'], 4),
  ('premodern', 'UBW Control',            800, array['Meddling Mage', 'Shadowmage Infiltrator', 'Vindicate', 'Counterspell', 'Duress'], 4);
