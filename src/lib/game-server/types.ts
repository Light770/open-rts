// Game Server Types - Authoritative Server Architecture
// This file defines all types for the authoritative game server

// ====================
// Core Entity Types
// ====================

export type UnitType = 'worker' | 'soldier' | 'archer' | 'healer' | 'catapult'
export type BuildingType = 'base' | 'barracks' | 'farm' | 'tower' | 'blacksmith' | 'siegeWorkshop' | 'wall'
export type UpgradeType = 'attack' | 'defense' | 'range'
export type ResourceType = 'gold' | 'wood'
export type TileType = 'grass' | 'forest' | 'water' | 'mountain' | 'gold' | 'sand' | 'dirt'

export interface Position {
  x: number
  y: number
}

export interface Entity {
  id: string
  ownerId: string
  x: number
  y: number
  hp: number
  maxHp: number
  size: number
}

export interface Unit extends Entity {
  type: UnitType
  state: 'idle' | 'moving' | 'attacking' | 'gathering' | 'returning' | 'building' | 'healing' | 'patrol' | 'attackMove' | 'holdPosition'
  targetId: string | null
  targetPosition: Position | null
  waypoints: Position[]
  attackRange: number
  attackDamage: number
  attackCooldown: number
  attackCooldownRemaining: number
  moveSpeed: number
  armor: number
  gatherAmount: number
  gatherRate: number
  isUnderAttack: boolean
  lastAttackTime: number
}

export interface Building extends Entity {
  type: BuildingType
  progress: number // 0-100, construction progress
  productionQueue: ProductionQueueItem[]
  rallyPoint: Position | null
  isUnderAttack: boolean
  lastAttackTime: number
}

export interface ProductionQueueItem {
  id: string
  type: UnitType
  progress: number
  queuedAt: number
}

export interface Resource {
  id: string
  type: ResourceType
  x: number
  y: number
  amount: number
  maxAmount: number
}

export interface Projectile {
  id: string
  type: 'arrow' | 'heal' | 'boulder'
  x: number
  y: number
  targetId: string
  targetPosition: Position
  speed: number
  damage: number
  ownerId: string
  splashRadius: number
  createdAt: number
}

// ====================
// Player & Game State
// ====================

export interface PlayerResources {
  gold: number
  wood: number
  supply: number
  maxSupply: number
}

export interface PlayerUpgrades {
  attack: number // 0-3
  defense: number // 0-3
  range: number // 0-2
}

export interface Player {
  id: string
  name: string
  team: 'host' | 'guest'
  color: string
  resources: PlayerResources
  upgrades: PlayerUpgrades
  ready: boolean
}

export interface DiscoveredTile {
  x: number
  y: number
  discoveredAt: number
}

export interface GameMap {
  width: number
  height: number
  tileSize: number
  tiles: TileType[][]
  resources: Resource[]
}

export interface GameState {
  tick: number
  map: GameMap
  units: Map<string, Unit>
  buildings: Map<string, Building>
  projectiles: Projectile[]
  players: Map<string, Player>
  discoveredTiles: Map<string, DiscoveredTile[]> // playerId -> tiles
  gameOver: boolean
  winner: string | null
  winnerReason: string | null
}

// ====================
// Actions (Client -> Server)
// ====================

export type ActionType =
  | { type: 'move'; unitId: string; target: Position }
  | { type: 'attack'; unitId: string; targetId: string }
  | { type: 'stop'; unitId: string }
  | { type: 'holdPosition'; unitId: string }
  | { type: 'patrol'; unitId: string; target: Position }
  | { type: 'attackMove'; unitId: string; target: Position }
  | { type: 'attackGround'; unitId: string; target: Position }
  | { type: 'produce'; buildingId: string; unitType: UnitType }
  | { type: 'build'; buildingType: BuildingType; position: Position }
  | { type: 'cancelProduction'; buildingId: string; queueItemId: string }
  | { type: 'setRallyPoint'; buildingId: string; position: Position }
  | { type: 'upgrade'; buildingId: string; upgradeType: UpgradeType }
  | { type: 'gather'; unitId: string; resourceId: string }
  | { type: 'returnResources'; unitId: string }

export interface GameAction {
  id: string
  playerId: string
  actionNumber: number
  timestamp: number
  action: ActionType
}

export interface ActionResult {
  success: boolean
  error?: string
  actionId?: string
}

// ====================
// Validation
// ====================

export interface ValidationResult {
  valid: boolean
  reason?: string
  details?: any
}

// ====================
// Network Types
// ====================

export interface GameSnapshot {
  tick: number
  timestamp: number
  units: Unit[]
  buildings: Building[]
  projectiles: Projectile[]
  players: Record<string, {
    resources: PlayerResources
    upgrades: PlayerUpgrades
  }>
  gameOver: boolean
  winner: string | null
}

export interface ClientMessage {
  type: 'action' | 'join' | 'leave' | 'ready' | 'ping'
  playerId?: string
  roomId?: string
  action?: GameAction
  timestamp?: number
}

export interface ServerMessage {
  type: 'snapshot' | 'actionAccepted' | 'actionRejected' | 'gameStart' | 'gameOver' | 'error' | 'ping'
  snapshot?: GameSnapshot
  actionId?: string
  error?: string
  reason?: string
  winner?: string
  timestamp?: number
}

// ====================
// Room & Config Types
// ====================

export interface RoomConfig {
  roomId: string
  roomName: string
  mapSeed: number
  difficulty: 'easy' | 'normal' | 'hard'
  maxPlayers: number
}

export interface RoomState {
  config: RoomConfig
  players: Player[]
  gameState: GameState | null
  gameStarted: boolean
  createdAt: number
  hostId: string
}

// ====================
// Constants (duplicated from client for server-side reference)
// ====================

export const UNIT_STATS: Record<UnitType, {
  hp: number
  damage: number
  range: number
  speed: number
  armor: number
  cost: { gold: number; wood: number }
  supply: number
  buildTime: number
  gatherAmount?: number
  gatherRate?: number
  splashRadius?: number
}> = {
  worker: {
    hp: 50,
    damage: 3,
    range: 5,
    speed: 2,
    armor: 0,
    cost: { gold: 50, wood: 0 },
    supply: 1,
    buildTime: 480, // ticks (8 seconds at 60fps)
    gatherAmount: 8,
    gatherRate: 60
  },
  soldier: {
    hp: 80,
    damage: 10,
    range: 10,
    speed: 1.8,
    armor: 1,
    cost: { gold: 80, wood: 20 },
    supply: 1,
    buildTime: 720 // ticks (12 seconds)
  },
  archer: {
    hp: 60,
    damage: 8,
    range: 150,
    speed: 1.8,
    armor: 0,
    cost: { gold: 60, wood: 40 },
    supply: 1,
    buildTime: 600 // ticks (10 seconds)
  },
  healer: {
    hp: 60,
    damage: -8, // Negative = healing
    range: 100,
    speed: 1.8,
    armor: 0,
    cost: { gold: 80, wood: 30 },
    supply: 1,
    buildTime: 660 // ticks (11 seconds)
  },
  catapult: {
    hp: 120,
    damage: 40,
    range: 200,
    speed: 1.2,
    armor: 0,
    cost: { gold: 120, wood: 80 },
    supply: 3,
    buildTime: 900, // ticks (15 seconds)
    splashRadius: 50
  }
}

export const BUILDING_STATS: Record<BuildingType, {
  hp: number
  size: number
  cost: { gold: number; wood: number }
  supply?: number
  buildTime: number
  attackDamage?: number
  attackRange?: number
}> = {
  base: {
    hp: 800,
    size: 96,
    cost: { gold: 0, wood: 0 },
    supply: 10,
    buildTime: 0
  },
  barracks: {
    hp: 400,
    size: 80,
    cost: { gold: 120, wood: 60 },
    buildTime: 1800
  },
  farm: {
    hp: 200,
    size: 80,
    cost: { gold: 60, wood: 80 },
    supply: 8,
    buildTime: 1200
  },
  tower: {
    hp: 300,
    size: 48,
    cost: { gold: 100, wood: 50 },
    attackDamage: 20,
    attackRange: 150,
    buildTime: 1500
  },
  blacksmith: {
    hp: 350,
    size: 80,
    cost: { gold: 150, wood: 100 },
    buildTime: 2100
  },
  siegeWorkshop: {
    hp: 450,
    size: 80,
    cost: { gold: 180, wood: 120 },
    buildTime: 2400
  },
  wall: {
    hp: 500,
    size: 40,
    cost: { gold: 20, wood: 10 },
    buildTime: 600
  }
}

export const UPGRADE_COSTS: Record<UpgradeType, { gold: number; levels: number }> = {
  attack: { gold: 100, levels: 3 },
  defense: { gold: 100, levels: 3 },
  range: { gold: 100, levels: 2 }
}

export const VISION_RANGE = 200
export const MAP_TILES_X = 60
export const MAP_TILES_Y = 60
export const TILE_SIZE = 40
export const TICK_RATE = 60 // ticks per second
