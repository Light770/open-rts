# Authoritative Server Architecture Plan

## Executive Summary

This document outlines a comprehensive plan to implement an **authoritative server** architecture for RTS Commander multiplayer. This will solve the current issues of state desynchronization, cheating, and invalid win conditions by making the server the single source of truth (SSOT) for all game state.

---

## Current Architecture Issues

### Problem: Peer-to-Peer Simulation
```
┌─────────────┐         ┌─────────────┐
│   Client A  │◄───────►│   Client B  │
│             │  Sync   │             │
│ - Runs game │         │ - Runs game │
│ - Simulates │         │ - Simulates │
│ - Sends pos │         │ - Sends pos │
└─────────────┘         └─────────────┘
        │                       │
        ▼                       ▼
   ┌─────────────────────────────────────┐
   │         Problems Occur:              │
   │ - Different simulation results       │
   │ - No server validation              │
   │ - Clients can cheat trivially       │
   │ - Conflicting win conditions         │
   └─────────────────────────────────────┘
```

### Why Current Approach Fails
1. **No authoritative state**: Both clients simulate independently
2. **Floating-point determinism**: Same code = different results across browsers/CPUs
3. **No server-side validation**: Client claims are trusted without verification
4. **Race conditions**: Network latency causes conflicting updates

---

## New Architecture: Authoritative Server

### Architecture Overview
```
┌─────────────┐         ┌─────────────────┐         ┌─────────────┐
│   Client A  │────────►│   Authoritative │◄────────│   Client B  │
│             │  Input  │     Server      │  Input  │             │
│ - No sim    │         │                 │         │ - No sim    │
│ - Render    │◄────────│ - All game sim  │────────►│ - Render    │
│ - Send cmds │   State │ - Validate all │   State │ - Send cmds │
└─────────────┘         └─────────────────┘         └─────────────┘
                               │
                               ▼
                        ┌─────────────┐
                        │  Database   │
                        │ (Redis/DB) │
                        │ - Game state│
                        │ - History   │
                        └─────────────┘
```

### Key Principles
1. **Server is SSOT**: All game logic runs on server
2. **Clients send inputs**: Not state, but commands (move, attack, build)
3. **Server broadcasts snapshots**: 10-20 times per second to all clients
4. **Clients are "thin"**: Only rendering and input capture

---

## Implementation Phases

### Phase 1: Infrastructure Setup (Week 1)

#### 1.1 Add Game Server Library
Create `src/lib/game-server/` module:
```
src/lib/game-server/
├── types.ts          # GameAction, GameSnapshot, PlayerState
├── engine.ts         # Core game simulation (moved from page.tsx)
├── validator.ts      # Action validation
├── tick-manager.ts   # Fixed timestep game loop
└── serializer.ts     # State serialization for network
```

#### 1.2 Move Game Logic to Server
Extract from [`src/app/page.tsx`](src/app/page.tsx:1) into server-side engine:
```typescript
// src/lib/game-server/engine.ts
export class GameEngine {
  private units: Map<string, Unit> = new Map()
  private buildings: Map<string, Building> = new Map()
  private resources: Map<string, Resource> = new Map()
  private tick: number = 0

  // All game logic moved here
  update() {
    this.updateUnits()
    this.updateCombat()
    this.updateProjectiles()
    this.updateEconomy()
    this.tick++
  }

  // Server-only: validate and apply action
  processAction(action: GameAction): ActionResult {
    // Validate action
    if (!this.validateAction(action)) {
      return { success: false, error: 'Invalid action' }
    }
    
    // Apply action
    switch (action.type) {
      case 'move':
        return this.handleMove(action)
      case 'attack':
        return this.handleAttack(action)
      case 'build':
        return this.handleBuild(action)
      case 'produce':
        return this.handleProduce(action)
    }
  }
}
```

#### 1.3 Add WebSocket Support
Current HTTP polling is insufficient for authoritative server. Add WebSocket:
```typescript
// src/app/api/socket/route.ts
import { WebSocketServer } from 'ws'

export function GET() {
  // Upgrade to WebSocket
  // Handle bidirectional game communication
}
```

### Phase 2: Action Validation (Week 2)

#### 2.1 Define Valid Actions
```typescript
// src/lib/game-server/types.ts
type ActionType = 
  | { type: 'move'; unitId: string; target: Position }
  | { type: 'attack'; unitId: string; targetId: string }
  | { type: 'produce'; buildingId: string; unitType: UnitType }
  | { type: 'build'; buildingType: BuildingType; position: Position }
  | { type: 'upgrade'; buildingId: string; upgradeType: UpgradeType }
  | { type: 'cancel'; targetId: string }

interface GameAction {
  playerId: string
  timestamp: number
  actionNumber: number  // For ordering
  action: ActionType
}
```

#### 2.2 Implement Validator
```typescript
// src/lib/game-server/validator.ts
export class ActionValidator {
  validate(action: GameAction, state: GameState): ValidationResult {
    // Check 1: Player owns the unit/building
    if (!this.playerOwnsTarget(action)) {
      return { valid: false, reason: 'Not owner' }
    }

    // Check 2: Enough resources
    if (!this.hasResources(action)) {
      return { valid: false, reason: 'Insufficient resources' }
    }

    // Check 3: Valid position (not out of bounds, not collision)
    if (!this.validPosition(action)) {
      return { valid: false, reason: 'Invalid position' }
    }

    // Check 4: Production queue not full (if producing)
    if (!this.productionAvailable(action)) {
      return { valid: false, reason: 'Production not available' }
    }

    // Check 5: Rate limiting (prevent action spam)
    if (!this.rateLimited(action)) {
      return { valid: false, reason: 'Rate limited' }
    }

    return { valid: true }
  }

  private playerOwnsTarget(action: GameAction): boolean {
    const playerId = action.playerId
    switch (action.action.type) {
      case 'move':
      case 'attack':
        return state.getUnit(action.action.unitId)?.ownerId === playerId
      case 'produce':
        return state.getBuilding(action.action.buildingId)?.ownerId === playerId
      case 'build':
      case 'upgrade':
      case 'cancel':
        return true // These actions create new entities
    }
  }

  private hasResources(action: GameAction): boolean {
    const player = action.playerId
    const resources = state.players.get(player)?.resources
    
    switch (action.action.type) {
      case 'produce':
        return resources.gold >= UNIT_COSTS[action.action.unitType].gold &&
               resources.wood >= UNIT_COSTS[action.action.unitType].wood
      case 'build':
        return resources.gold >= BUILDING_COSTS[action.action.buildingType].gold &&
               resources.wood >= BUILDING_COSTS[action.action.buildingType].wood
      case 'upgrade':
        return resources.gold >= UPGRADE_COSTS[action.action.upgradeType]
    }
    return true
  }
}
```

### Phase 3: Game State Management (Week 2-3)

#### 3.1 Persistent Room State
```typescript
// src/lib/game-server/room-manager.ts
import Redis from 'ioredis'

export class RoomManager {
  private redis: Redis
  private activeRooms: Map<string, GameEngine> = new Map()

  async createRoom(roomId: string, config: RoomConfig): Promise<GameEngine> {
    const engine = new GameEngine(config)
    
    // Initialize map (WFC on server)
    const map = generateWFCMap(config.mapSeed)
    engine.initializeMap(map)
    
    // Store in Redis for persistence
    await this.redis.set(`room:${roomId}`, JSON.stringify(engine.serialize()))
    
    this.activeRooms.set(roomId, engine)
    return engine
  }

  async saveRoom(roomId: string): Promise<void> {
    const engine = this.activeRooms.get(roomId)
    if (engine) {
      await this.redis.set(`room:${roomId}`, JSON.stringify(engine.serialize()))
    }
  }

  async loadRoom(roomId: string): Promise<GameEngine | null> {
    const cached = this.activeRooms.get(roomId)
    if (cached) return cached

    const data = await this.redis.get(`room:${roomId}`)
    if (!data) return null

    const engine = GameEngine.deserialize(JSON.parse(data))
    this.activeRooms.set(roomId, engine)
    return engine
  }
}
```

#### 3.2 Tick Loop
```typescript
// src/lib/game-server/tick-manager.ts
export class TickManager {
  private readonly TICK_RATE = 60  // 60 ticks per second
  private readonly SNAPSHOT_RATE = 10  // 10 snapshots per second
  
  private interval: NodeJS.Timeout | null = null

  start(roomId: string, broadcast: (snapshot: GameSnapshot) => void) {
    let accumulator = 0
    const TICK_DURATION = 1000 / this.TICK_RATE
    const SNAPSHOT_INTERVAL = 1000 / this.SNAPSHOT_RATE
    
    let lastSnapshot = Date.now()

    this.interval = setInterval(() => {
      const now = Date.now()
      const delta = now - lastSnapshot
      lastSnapshot = now

      // Process pending actions from queue
      this.processActionQueue(roomId)

      // Run game tick
      const engine = this.rooms.get(roomId)
      engine.update(delta)

      // Broadcast snapshots at configured rate
      if (now - lastSnapshot >= SNAPSHOT_INTERVAL) {
        const snapshot = engine.createSnapshot()
        broadcast(snapshot)
      }
    }, TICK_DURATION)
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
  }
}
```

### Phase 4: Client Integration (Week 3)

#### 4.1 Update Client to Send Actions
Replace state sync with action sending:
```typescript
// src/app/page.tsx - Client side
const sendAction = async (action: ActionType) => {
  await websocket.send(JSON.stringify({
    type: 'action',
    playerId: myPlayerId,
    action: action,
    timestamp: Date.now()
  }))
}

// Instead of moving unit, send move action
const handleUnitClick = (unit: Unit) => {
  if (selectedUnit && unit.type === 'soldier') {
    sendAction({
      type: 'move',
      unitId: selectedUnit.id,
      target: { x: unit.x, y: unit.y }
    })
  }
}
```

#### 4.2 Client Rendering Only
Client receives snapshots and renders:
```typescript
// src/app/page.tsx - Client side
useEffect(() => {
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    
    if (msg.type === 'snapshot') {
      // Update local state from server snapshot
      setGameState(msg.snapshot)
      // Interpolate positions for smooth rendering
      interpolatePositions(msg.snapshot)
    }
    
    if (msg.type === 'actionRejected') {
      // Show error to player
      showToast(`Action failed: ${msg.reason}`)
    }
  }
}, [])

// Render is now purely visual
const render = () => {
  // Draw from local state (interpolated)
  gameState.units.forEach(unit => drawUnit(unit))
  gameState.buildings.forEach(b => drawBuilding(b))
}
```

#### 4.3 Add Interpolation
Smooth out network jitter:
```typescript
// src/lib/client/interpolation.ts
export class Interpolator {
  private snapshots: GameSnapshot[] = []
  private readonly BUFFER_SIZE = 3

  addSnapshot(snapshot: GameSnapshot) {
    this.snapshots.push(snapshot)
    if (this.snapshots.length > this.BUFFER_SIZE) {
      this.snapshots.shift()
    }
  }

  // Interpolate between snapshots for smooth rendering
  getInterpolatedState(): GameState {
    if (this.snapshots.length < 2) {
      return this.snapshots[0] || emptyState
    }

    const [prev, next] = this.snapshots.slice(-2)
    const alpha = (now - prev.timestamp) / (next.timestamp - prev.timestamp)

    return {
      units: prev.units.map(u => ({
        ...u,
        x: lerp(u.x, next.getUnit(u.id)?.x ?? u.x, alpha),
        y: lerp(u.y, next.getUnit(u.id)?.y ?? u.y, alpha)
      })),
      // ... other entities
    }
  }
}
```

### Phase 5: Win Condition & Anti-Cheat (Week 4)

#### 5.1 Server-Side Win Detection
```typescript
// src/lib/game-server/win-condition.ts
export class WinConditionChecker {
  check(engine: GameEngine): { winner: string | null, reason: string } | null {
    const players = engine.getPlayers()
    
    for (const player of players) {
      const playerBases = engine.getBuildings(player.id).filter(b => b.type === 'base')
      const enemyBases = engine.getBuildings()
        .filter(b => b.type === 'base' && b.ownerId !== player.id)
      
      if (playerBases.length === 0) {
        // Player has no base, they lose
        return { 
          winner: enemyBases[0]?.ownerId || null,
          reason: `${player.name} eliminated`
        }
      }
    }

    return null // No winner yet
  }
}
```

#### 5.2 Comprehensive Anti-Cheat
```typescript
// src/lib/game-server/anticheat.ts
export class AntiCheat {
  private actionHistory: Map<string, GameAction[]> = new Map()
  private readonly HISTORY_SIZE = 100

  validateAction(action: GameAction, engine: GameEngine): ValidationResult {
    // 1. Resource validation
    if (!this.validateResources(action, engine)) {
      return { valid: false, reason: 'Resource violation' }
    }

    // 2. Speed hack detection
    if (!this.validateSpeed(action)) {
      return { valid: false, reason: 'Speed violation' }
    }

    // 3. Teleport detection
    if (!this.validatePosition(action, engine)) {
      return { valid: false, reason: 'Position violation' }
    }

    // 4. Action spam detection
    if (!this.validateSpam(action)) {
      return { valid: false, reason: 'Spam detected' }
    }

    return { valid: true }
  }

  private validateResources(action: GameAction, engine: GameEngine): boolean {
    const player = engine.getPlayer(action.playerId)
    const costs = getActionCosts(action.action)
    
    // Can't have gained more resources than possible between actions
    const timeDelta = action.timestamp - (this.getLastAction(action.playerId)?.timestamp || 0)
    const maxPossibleGain = timeDelta * MAX_GATHER_RATE
    
    return player.resources.gold - costs.gold >= 0 &&
           player.resources.wood - costs.wood >= 0
  }

  private validatePosition(action: GameAction, engine: GameEngine): boolean {
    if (action.action.type !== 'move') return true
    
    const unit = engine.getUnit(action.action.unitId)
    const lastKnown = this.getLastKnownPosition(action.playerId, unit.id)
    
    if (!lastKnown) return true
    
    const maxSpeed = UNIT_STATS[unit.type].speed
    const timeDelta = action.timestamp - lastKnown.timestamp
    const maxDistance = maxSpeed * timeDelta
    
    const actualDistance = distance(lastKnown, action.action.target)
    
    return actualDistance <= maxDistance * 1.2 // 20% tolerance for interpolation
  }
}
```

---

## Code Changes Required

### New Files
| File | Purpose |
|------|---------|
| `src/lib/game-server/types.ts` | Action, snapshot, state types |
| `src/lib/game-server/engine.ts` | Core game simulation |
| `src/lib/game-server/validator.ts` | Action validation |
| `src/lib/game-server/tick-manager.ts` | Server tick loop |
| `src/lib/game-server/room-manager.ts` | Room lifecycle |
| `src/lib/game-server/win-condition.ts` | Win detection |
| `src/lib/game-server/anticheat.ts` | Cheat detection |
| `src/lib/game-server/serializer.ts` | State serialization |
| `src/lib/client/interpolation.ts` | Client-side interpolation |
| `src/app/api/socket/route.ts` | WebSocket endpoint |

### Modified Files
| File | Changes |
|------|---------|
| `src/app/page.tsx` | Remove game logic, add action sending |
| `src/app/api/multiplayer/route.ts` | Remove state sync, add action routing |
| `src/lib/multiplayer.ts` | Simplify to lobby management only |
| `package.json` | Add `ws` and `ioredis` dependencies |

### Dependencies to Add
```json
{
  "dependencies": {
    "ws": "^8.14.0",
    "ioredis": "^5.3.0"
  }
}
```

---

## Migration Strategy

### Phase A: Dual Mode
Maintain both old and new systems during migration:
```typescript
// Feature flag for gradual rollout
const USE_AUTHORITATIVE = process.env.AUTHORITATIVE_SERVER === 'true'

if (USE_AUTHORITATIVE) {
  // New WebSocket path
  connectWebSocket()
} else {
  // Legacy HTTP polling
  startLegacySync()
}
```

### Phase B: Gradual Client Migration
1. Deploy server first (accepts both action and state)
2. Migrate 10% of clients to action-based
3. Monitor for issues
4. Increase to 50%, then 100%

### Phase C: Legacy Sunset
1. Remove HTTP state sync after all clients migrated
2. Keep lobby system for room management
3. Remove old code paths

---

## Estimated Timeline

| Phase | Duration | Deliverable |
|-------|----------|-------------|
| Phase 1: Infrastructure | 1 week | Game server library, WebSocket setup |
| Phase 2: Validation | 1 week | Action validation, rate limiting |
| Phase 3: State Management | 2 weeks | Persistent rooms, tick loop |
| Phase 4: Client Integration | 1 week | Client sends actions, interpolation |
| Phase 5: Win/Anti-Cheat | 1 week | Server-side win detection, anti-cheat |
| **Total** | **6 weeks** | Complete authoritative server |

---

## Testing Plan

### Unit Tests
- Game engine logic (combat, movement, economy)
- Action validation
- Win condition detection
- Anti-cheat thresholds

### Integration Tests
- Client-server communication
- Room lifecycle
- Disconnect/reconnect

### Load Testing
- 100+ concurrent games
- Latency under various network conditions
- Memory usage over time

---

## Conclusion

This authoritative server architecture will provide:

1. **Single Source of Truth**: Server controls all game state
2. **Cheat Prevention**: Server validates all actions
3. **No Desync**: Everyone sees same server state
4. **Valid Win Conditions**: Server declares winner
5. **Reconnection Support**: Persistent state survives disconnects
6. **Better Multiplayer**: Can expand to 4+ players easily

The implementation is substantial (6 weeks) but provides a solid foundation for competitive multiplayer RTS gameplay.
