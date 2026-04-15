# V1 Scope Decisions (KEEP / LATER / DROP)

Data decyzji: 2026-04-15  
Tryb: Hunter-first, Keepa-first, self-healing-first

## Reguły decyzji

1. `KEEP` = wchodzi do v1 i musi mieć parity + testy.
2. `LATER` = po cutover v1, dopiero po analizie.
3. `DROP` = usuwamy z v1 i nie migrujemy teraz.

## KEEP (v1)

### Core trackings
- `A001-A010`
- `B001-B016`
- `C001-C012`
- `D001-D006`, `D009-D012`
- `E001-E012`
- `F001-F010`

### Hunter + Keepa + ops automation
- `H001-H012`
- `I001-I012`
- `M001-M010`
- `N001-N010` (w zakresie monitoringu potrzebnego do Hunter/Keepa)
- `O001-O010`
- `P001-P010`
- `Q001-Q010`
- `R001-R008`
- `S001-S010` (bez elementów forum i bez AI UI)

## LATER (po v1)

- `J001-J006` (web deals)
- `L001-L010` (rozszerzone ustawienia usera poza minimum tracking/hunter)
- `R009-R010` (profiling/governance rozszerzone)

## DROP (w v1)

### Forum
- `K001-K010`

### AI user-facing UI
- `D007` (AI signals w szczegółach)
- `D008` (Najlepszy moment zakupu AI card)
- `G001-G007` (chat i akcje AI dla usera)

## Dodatkowe decyzje architektoniczne

1. AI zostaje tylko na backendzie dla Huntera i mechanik wymagających AI.
2. Decyzja alertowa nie może zależeć wyłącznie od AI (fallback regułowy obowiązkowy).
3. Kanały alertów muszą mieć twardą separację i testy kontraktowe.
4. Zostajemy przy jednym projekcie (monorepo), bez splitu na dwa osobne repo.
