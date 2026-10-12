# Layers / egg tracking — task plan

Approved answers:
- Egg mobiles: "Egg mobile 1"–"Egg mobile 3", manager can add/rename (like broiler pens).
- Laid is ALWAYS exactly saleable + broken (enforce laid == saleable + broken, 400 otherwise).
- Track birds per mobile too (arrivals/deaths/moves between mobiles? -> keep simple: bird events = arrival, death; plus adjust? Keep: arrival + death + move between mobiles like broilers? Minimal: arrival and death events per mobile, plus mobile move optional — decide: implement arrival + death + move (mobile->mobile), mirroring broiler pens since it was praised).
- One Weekly List apply deducts chicken kg AND egg counts (EGG030=30, EGG006=6; pack size parsed from description "N x").

Design decisions (mirror broilers patterns):
- Tables: eggMobiles (name, active), eggCollections (mobileId, date, laid, saleable, broken, employeeId, actor, note, void fields, createdAt; unique(mobileId,date) among non-voided? enforce via unique index on (mobileId, date) + void handling: since voided rows linger, unique index would block re-log after void -> use partial unique index WHERE voided_at IS NULL; drizzle sqlite supports .where on index? Simpler: check in transaction + unique partial index via raw SQL in push? Avoid raw: enforce uniqueness in code within transaction; acceptable given single-user farm scale. Keep a normal index only.)
- layerBirds per mobile: eggMobiles gains birdCount int default 0 + revision? Bird events table layerBirdEvents: id, mobileId, kind (arrival|death|move-out? keep arrival/death), count, eventDate, employeeId/actor, note, void fields. Manager can also set counts directly? Keep events + manager void; simpler and consistent with broilers ledger style.
  - Moves between mobiles: skip unless asked later? Birds per mobile "too" — arrival + death + void is enough; moves can be death+arrival but that's lossy. Implement move as paired event? Keep scope: arrival, death, and "move" with fromMobileId->toMobileId in one event row (toMobileId nullable col). OK.
- Egg stock: eggStockProducts table: productId (unique, EGG% catalog), enabled, eggsPerUnit (int, parsed from "N x" in description, editable), eggsOnHand (int), revision. Saleable collection adds eggsOnHand to a SINGLE "saleable eggs" pool? But stock is per product (EGG030 vs EGG006) while collection yields loose eggs. Problem: saleable eggs are loose; stock products are packs. Solution: track "looseEggsOnHand" singleton (egg_stock id 1, eggsOnHand, revision). Invoice deduction converts pack qty to loose eggs (qty * eggsPerUnit) and deducts from the loose pool. This matches reality: eggs are graded/packed at sale time. The manager sees loose egg stock; pack conversions per EGG product editable in setup. VOID/sale movements table eggStockMovements mirrors broilerStockMovements (kind: collection|sale|sale_reversal|adjustment, quantityEggs signed, referenceKey unique, referenceId, actor, note).
  - Broken eggs do NOT touch stock. Voiding a collection removes its saleable eggs from stock (blocked if insufficient — manager must adjust first, same as gas delivery void).
- Run stock: stockRequirementsForRun already aggregates CHICK kg; add eggRequirementsForRun aggregating EGG lines -> loose eggs required. applyRunStock deducts both in one transaction; shortage of either blocks with combined message. reverseRunStock restores both. removeRun already calls reverseRunStock -> covers eggs automatically. pack_runs.stockAppliedAt stays single flag.
- Surfaces:
  - Manager /layers page in app shell: stats (birds, today's eggs, saleable stock, broken), mobile cards w/ bird counts, daily collection register (per mobile, editable date), collection history w/ voids, egg stock card (loose eggs on hand + per-product pack sizes editable + manual adjustment w/ reason), setup (add/rename/deactivate mobiles), Weekly List note: egg deduction happens on broilers page apply? User said "extend existing apply" -> the broilers Weekly List card now shows egg requirements too. Rename section titles slightly? Keep on broilers page; requirements list gains egg lines. ALSO show on /layers a small card linking? Keep simple: apply stays in broilers page UI but response includes eggs. Hmm — but "Apply Weekly List sales" on a broilers page for eggs is odd UX. Better: move that card? User explicitly said extend existing apply on broilers page. Keep it there; also mirror the requirements preview on /layers? No — keep single source, mention in copy.
  - Employee log: extend /broilers/log with an "Eggs" action? User said "shared phone" previously; layers get own section on same log page: actions list gains "Egg collection" + "Layer birds"? Cleaner: separate /layers/log page mirroring broiler-log. Signed-out nav gains "Layers". Public page revokes manager token same way (reuse pattern).
    - Employee actions: "Log eggs" (pick mobile, date, laid/saleable/broken with auto-check) and "Layer birds" (arrival/death/move). Two actions.
- API namespace: new routes/layers.ts, namespace `layers`: logOptions (public), logCollection (public), voidCollection (manager), logBirdEvent (public), voidBirdEvent (manager), overview (manager), saveMobile (manager), saveEggProduct (manager), adjustStock (manager).
- lib/layers.ts: ensureLayerDefaults (mobiles 1-3, EGG products with eggsPerUnit parsed "N x", loose stock singleton), eggRequirementsForRun, reverse helpers integrated into reverseRunStock (edit broilers lib since it's shared — rename? keep file, add egg functions there or in layers lib and call from broilers route apply/reverse. Cleanest: layers lib exports eggRequirementsForRun + apply/reverse pieces; broilers.ts applyRunStock calls both.)
- Queries: web/queries/layers.ts.
- Tests: extend scripts/test-broilers.ts? It's already big; make scripts/test-layers.ts with same watermark pattern + extend UI script (new file test-layers-ui.py or extend broiler UI? separate test-layers-ui.py).
- Update apply/reverse/run-delete flows + existing broiler test expectations (applyRunStock response shape gains eggs; preview gains eggRequirements; keep old fields intact so old tests pass).
- design.md + task.md updates at end. Deliver on port 4200.

Steps:
1. schema.ts additions + db:push
2. lib/layers.ts (defaults, requirements, reverse) + wire into broilers.ts apply/reverse/preview
3. routes/layers.ts + index.ts router registration
4. queries/layers.ts
5. pages/layers.tsx (manager) + pages/layer-log.tsx (phone) + app.tsx routes + layout nav (authed "Layers", signed-out "Layers" log link)
6. Broilers page copy: Weekly List card mentions eggs; preview shows egg lines.
7. test-layers.ts + test-layers-ui.py; run all suites; build; docs; deliver.
