'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { generateMapWFC, Tile, TILE_PROPERTIES, TerrainType, findPassableArea } from './wfc-generator'

// ==================== TYPES ====================
interface Entity {
  id: number
  x: number
  y: number
  width: number
  height: number
  hp: number
  maxHp: number
  team: 'player' | 'enemy'
}

type UnitType = 'worker' | 'soldier' | 'archer' | 'healer' | 'catapult'
type BuildingType = 'base' | 'barracks' | 'farm' | 'tower' | 'blacksmith' | 'siegeWorkshop' | 'wall'
type CommandType = 'move' | 'attackMove' | 'patrol' | 'attack' | 'gather' | 'hold' | 'repair' | 'attackGround'

interface Waypoint {
  x: number
  y: number
  command: CommandType
  target?: Entity | Resource
}

interface Unit extends Entity {
  type: UnitType
  targetX: number | null
  targetY: number | null
  selected: boolean
  speed: number
  attackDamage: number
  attackRange: number
  attackCooldown: number
  currentCooldown: number
  carryingResource: 'gold' | 'wood' | null
  carryingAmount: number
  gatheringTarget: Resource | null
  returningToBase: boolean
  command: CommandType | null
  patrolPoints: { x: number; y: number }[]
  patrolIndex: number
  attackTarget: Entity | null
  isRanged: boolean
  projectileSpeed: number
  healAmount: number
  healRange: number
  healCooldown: number
  currentHealCooldown: number
  repairTarget: Building | null
  waypoints: Waypoint[]
  splashRadius: number
  attackGroundX: number | null
  attackGroundY: number | null
  ownerId: string
}

interface Projectile {
  id: number
  x: number
  y: number
  targetX: number
  targetY: number
  damage: number
  team: 'player' | 'enemy'
  speed: number
  targetId: number
  type: 'arrow' | 'heal' | 'boulder'
  splashRadius: number
}

interface Building extends Entity {
  type: BuildingType
  constructionProgress: number
  isComplete: boolean
  rallyPoint: { x: number; y: number } | null
  productionQueue: Array<{ type: UnitType; progress: number; totalTime: number }>
  selected: boolean
  attackCooldown: number
  currentCooldown: number
  attackDamage: number
  attackRange: number
  isUnderAttack: boolean
  underAttackTimer: number
  ownerId: string
}

interface Wall extends Entity {
  type: 'wall'
  ownerId: string
}

interface Resource {
  id: number
  x: number
  y: number
  type: 'gold' | 'tree'
  amount: number
  width: number
  height: number
}

interface ControlGroup { unitIds: number[]; buildingIds: number[] }

interface MinimapPing {
  id: number
  x: number
  y: number
  timestamp: number
  team: 'player' | 'enemy'
}

interface PlayerInfo {
  id: string
  name: string
  team: 'player' | 'enemy'
  color: string
}

interface ChatMessage {
  id: number
  playerId: string
  playerName: string
  message: string
  timestamp: number
}

interface GameState {
  units: Unit[]
  buildings: Building[]
  resources: Resource[]
  projectiles: Projectile[]
  playerResources: { gold: number; wood: number; supply: number; maxSupply: number }
  enemyResources: { gold: number; wood: number; supply: number; maxSupply: number }
  camera: { x: number; y: number }
  mapSize: { width: number; height: number }
  selectionBox: { startX: number; startY: number; endX: number; endY: number } | null
  placingBuilding: BuildingType | null
  gameOver: boolean
  winner: 'player' | 'enemy' | null
  attackMoveMode: boolean
  patrolMode: boolean
  attackGroundMode: boolean
  notifications: Notification[]
  controlGroups: { [key: number]: ControlGroup }
  fogOfWar: boolean
  discoveredTiles: boolean[][] // Track discovered terrain for fog of war
  gameSpeed: number
  upgrades: { player: { attack: number; defense: number; range: number }; enemy: { attack: number; defense: number; range: number } }
  minimapPings: MinimapPing[]
  difficulty: 'easy' | 'normal' | 'hard'
  gameStarted: boolean
  tileMap: Tile[][]
  mapSeed: number
  isMultiplayer: boolean
  playerId: string
  playerName: string
  roomId: string | null
  players: PlayerInfo[]
  tick: number
  chatMessages: ChatMessage[]
  syncPending: boolean
}

interface Notification { id: number; message: string; type: 'info' | 'warning' | 'success' | 'danger'; timestamp: number }
interface MousePos { x: number; y: number }

// ==================== CONSTANTS ====================
const TILE_SIZE = 40
const MAP_TILES_X = 60
const MAP_TILES_Y = 60
const MAP_WIDTH = MAP_TILES_X * TILE_SIZE
const MAP_HEIGHT = MAP_TILES_Y * TILE_SIZE
const CANVAS_WIDTH = 850
const CANVAS_HEIGHT = 520
const MINIMAP_SIZE = 150
const VISION_RANGE = 200
const SYNC_INTERVAL = 100 // ms between state syncs

// Unit stats
const UNIT_STATS: Record<UnitType, { 
  hp: number; speed: number; damage: number; range: number; cooldown: number
  cost: { gold: number; wood: number }; supply: number; isRanged: boolean
  healAmount?: number; healRange?: number; healCooldown?: number; splashRadius?: number
}> = {
  worker: { hp: 40, speed: 2, damage: 3, range: 25, cooldown: 60, cost: { gold: 50, wood: 0 }, supply: 1, isRanged: false },
  soldier: { hp: 80, speed: 2.2, damage: 12, range: 35, cooldown: 40, cost: { gold: 80, wood: 20 }, supply: 2, isRanged: false },
  archer: { hp: 50, speed: 2, damage: 15, range: 120, cooldown: 50, cost: { gold: 60, wood: 40 }, supply: 2, isRanged: true },
  healer: { hp: 35, speed: 1.8, damage: 0, range: 0, cooldown: 0, cost: { gold: 80, wood: 30 }, supply: 2, isRanged: false, healAmount: 8, healRange: 80, healCooldown: 40 },
  catapult: { hp: 60, speed: 1.2, damage: 40, range: 180, cooldown: 90, cost: { gold: 120, wood: 80 }, supply: 3, isRanged: true, splashRadius: 50 }
}

// Building stats
const BUILDING_STATS: Record<BuildingType, { 
  hp: number; cost: { gold: number; wood: number }; supply: number
  buildTime: number; canAttack: boolean; damage: number; range: number
}> = {
  base: { hp: 800, cost: { gold: 0, wood: 0 }, supply: 10, buildTime: 0, canAttack: false, damage: 0, range: 0 },
  barracks: { hp: 400, cost: { gold: 120, wood: 60 }, supply: 0, buildTime: 30, canAttack: false, damage: 0, range: 0 },
  farm: { hp: 200, cost: { gold: 60, wood: 80 }, supply: 8, buildTime: 20, canAttack: false, damage: 0, range: 0 },
  tower: { hp: 300, cost: { gold: 100, wood: 50 }, supply: 0, buildTime: 25, canAttack: true, damage: 20, range: 150 },
  blacksmith: { hp: 350, cost: { gold: 150, wood: 100 }, supply: 0, buildTime: 35, canAttack: false, damage: 0, range: 0 },
  siegeWorkshop: { hp: 450, cost: { gold: 180, wood: 120 }, supply: 0, buildTime: 40, canAttack: false, damage: 0, range: 0 },
  wall: { hp: 500, cost: { gold: 20, wood: 10 }, supply: 0, buildTime: 10, canAttack: false, damage: 0, range: 0 }
}

// ==================== UTILITY FUNCTIONS ====================
const getDistance = (x1: number, y1: number, x2: number, y2: number) => Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const createId = () => Date.now() + Math.random()

// Darken a hex color by a factor (0-1)
const darkenColor = (hexColor: string, factor: number): string => {
  const hex = hexColor.replace('#', '')
  const r = Math.floor(parseInt(hex.substring(0, 2), 16) * factor)
  const g = Math.floor(parseInt(hex.substring(2, 4), 16) * factor)
  const b = Math.floor(parseInt(hex.substring(4, 6), 16) * factor)
  return `rgb(${r}, ${g}, ${b})`
}

// ==================== SPATIAL GRID FOR COLLISION OPTIMIZATION ====================
class SpatialGrid {
  private gridSize: number
  private grid: Map<string, Entity[]>
  
  constructor(gridSize: number = 100) {
    this.gridSize = gridSize
    this.grid = new Map()
  }
  
  clear() {
    this.grid.clear()
  }
  
  private getKey(x: number, y: number): string {
    return `${Math.floor(x / this.gridSize)},${Math.floor(y / this.gridSize)}`
  }
  
  insert(entity: Entity) {
    const key = this.getKey(entity.x, entity.y)
    if (!this.grid.has(key)) {
      this.grid.set(key, [])
    }
    this.grid.get(key)!.push(entity)
  }
  
  getNearby(x: number, y: number, radius: number): Entity[] {
    const results: Entity[] = []
    const minGridX = Math.floor((x - radius) / this.gridSize)
    const maxGridX = Math.floor((x + radius) / this.gridSize)
    const minGridY = Math.floor((y - radius) / this.gridSize)
    const maxGridY = Math.floor((y + radius) / this.gridSize)
    
    for (let gx = minGridX; gx <= maxGridX; gx++) {
      for (let gy = minGridY; gy <= maxGridY; gy++) {
        const key = `${gx},${gy}`
        const entities = this.grid.get(key)
        if (entities) {
          results.push(...entities)
        }
      }
    }
    return results
  }
}

// ==================== UNIT/BUILDING CREATORS ====================
function createUnit(type: UnitType, x: number, y: number, team: 'player' | 'enemy', ownerId: string): Unit {
  const stats = UNIT_STATS[type]
  return {
    id: createId(), x, y, width: 32, height: 32,
    hp: stats.hp, maxHp: stats.hp, team, type,
    targetX: null, targetY: null, selected: false,
    speed: stats.speed, attackDamage: stats.damage, attackRange: stats.range,
    attackCooldown: stats.cooldown, currentCooldown: 0,
    carryingResource: null, carryingAmount: 0, gatheringTarget: null, returningToBase: false,
    command: null, patrolPoints: [], patrolIndex: 0, attackTarget: null,
    isRanged: stats.isRanged, projectileSpeed: type === 'catapult' ? 5 : 8,
    healAmount: stats.healAmount || 0, healRange: stats.healRange || 0,
    healCooldown: stats.healCooldown || 0, currentHealCooldown: 0, repairTarget: null,
    waypoints: [], splashRadius: stats.splashRadius || 0, attackGroundX: null, attackGroundY: null,
    ownerId
  }
}

function createBuilding(type: BuildingType, x: number, y: number, team: 'player' | 'enemy', ownerId: string, complete: boolean = false): Building {
  const stats = BUILDING_STATS[type]
  const size = type === 'base' ? 96 : type === 'tower' ? 48 : type === 'wall' ? 40 : 80
  return {
    id: createId(), x, y, width: size, height: size,
    hp: complete ? stats.hp : Math.floor(stats.hp * 0.1), maxHp: stats.hp, team, type,
    constructionProgress: complete ? 100 : 0, isComplete: complete,
    rallyPoint: type !== 'wall' ? { x: x + size + 30, y: y + size / 2 } : null,
    productionQueue: [], selected: false,
    attackCooldown: 60, currentCooldown: 0,
    attackDamage: stats.damage, attackRange: stats.range,
    isUnderAttack: false, underAttackTimer: 0,
    ownerId
  }
}

// ==================== INITIAL STATE ====================
function generateGameFromMap(tileMap: Tile[][], seed: number, playerId: string, playerName: string): GameState {
  const resources: Resource[] = []
  let resourceId = 1000
  
  for (let y = 0; y < tileMap.length; y++) {
    for (let x = 0; x < tileMap[y].length; x++) {
      const tile = tileMap[y][x]
      if (tile.type === 'gold' && tile.resourceAmount) {
        resources.push({
          id: resourceId++,
          x: x * TILE_SIZE,
          y: y * TILE_SIZE,
          type: 'gold',
          amount: tile.resourceAmount,
          width: TILE_SIZE,
          height: TILE_SIZE
        })
      } else if (tile.type === 'forest' && tile.resourceAmount) {
        resources.push({
          id: resourceId++,
          x: x * TILE_SIZE,
          y: y * TILE_SIZE,
          type: 'tree',
          amount: tile.resourceAmount,
          width: TILE_SIZE,
          height: TILE_SIZE
        })
      }
    }
  }
  
  const playerTileX = Math.floor(MAP_TILES_X * 0.12)
  const playerTileY = Math.floor(MAP_TILES_Y * 0.12)
  const playerPos = findPassableArea(tileMap, playerTileX, playerTileY, 5)
  
  const playerStartX = playerPos ? playerPos.x * TILE_SIZE : 150
  const playerStartY = playerPos ? playerPos.y * TILE_SIZE : 200
  
  // Initialize discovered tiles array
  const discoveredTiles: boolean[][] = []
  for (let y = 0; y < tileMap.length; y++) {
    discoveredTiles[y] = []
    for (let x = 0; x < tileMap[y].length; x++) {
      discoveredTiles[y][x] = false
    }
  }
  
  return {
    units: [
      createUnit('worker', playerStartX + 50, playerStartY + 100, 'player', playerId),
      createUnit('worker', playerStartX + 100, playerStartY + 100, 'player', playerId),
      createUnit('worker', playerStartX + 50, playerStartY + 150, 'player', playerId),
      createUnit('soldier', playerStartX + 130, playerStartY + 120, 'player', playerId),
    ],
    buildings: [createBuilding('base', playerStartX, playerStartY, 'player', playerId, true)],
    resources,
    projectiles: [],
    playerResources: { gold: 200, wood: 100, supply: 5, maxSupply: 10 },
    enemyResources: { gold: 300, wood: 150, supply: 4, maxSupply: 10 },
    camera: { x: Math.max(0, playerStartX - 100), y: Math.max(0, playerStartY - 100) },
    mapSize: { width: MAP_WIDTH, height: MAP_HEIGHT },
    selectionBox: null, placingBuilding: null,
    gameOver: false, winner: null,
    attackMoveMode: false, patrolMode: false, attackGroundMode: false,
    notifications: [], controlGroups: {},
    fogOfWar: false, discoveredTiles,
    gameSpeed: 1,
    upgrades: { player: { attack: 0, defense: 0, range: 0 }, enemy: { attack: 0, defense: 0, range: 0 } },
    minimapPings: [], difficulty: 'normal', gameStarted: false,
    tileMap, mapSeed: seed,
    isMultiplayer: false,
    playerId,
    playerName,
    roomId: null,
    players: [{ id: playerId, name: playerName, team: 'player', color: '#4169E1' }],
    tick: 0,
    chatMessages: [],
    syncPending: false
  }
}

const createInitialState = (playerId: string, playerName: string): GameState => {
  const seed = Math.floor(Math.random() * 1000000)
  const tileMap = generateMapWFC(MAP_TILES_X, MAP_TILES_Y, seed)
  return generateGameFromMap(tileMap, seed, playerId, playerName)
}

const addEnemyEntities = (state: GameState, difficulty: 'easy' | 'normal' | 'hard', enemyId: string = 'ai'): GameState => {
  const enemyTileX = Math.floor(MAP_TILES_X * 0.88)
  const enemyTileY = Math.floor(MAP_TILES_Y * 0.88)
  const enemyPos = findPassableArea(state.tileMap, enemyTileX, enemyTileY, 5)
  
  const enemyStartX = enemyPos ? enemyPos.x * TILE_SIZE : MAP_WIDTH - 350
  const enemyStartY = enemyPos ? enemyPos.y * TILE_SIZE : MAP_HEIGHT - 350
  
  const enemyBase = createBuilding('base', enemyStartX, enemyStartY, 'enemy', enemyId, true)
  const enemyBarracks = createBuilding('barracks', enemyStartX - 100, enemyStartY + 50, 'enemy', enemyId, true)
  
  const enemyUnits: Unit[] = []
  if (difficulty === 'easy') {
    enemyUnits.push(createUnit('soldier', enemyStartX + 50, enemyStartY - 50, 'enemy', enemyId))
  } else if (difficulty === 'normal') {
    enemyUnits.push(createUnit('soldier', enemyStartX + 50, enemyStartY - 50, 'enemy', enemyId))
    enemyUnits.push(createUnit('soldier', enemyStartX + 100, enemyStartY - 30, 'enemy', enemyId))
    enemyUnits.push(createUnit('archer', enemyStartX + 80, enemyStartY + 80, 'enemy', enemyId))
  } else {
    enemyUnits.push(createUnit('soldier', enemyStartX + 50, enemyStartY - 50, 'enemy', enemyId))
    enemyUnits.push(createUnit('soldier', enemyStartX + 100, enemyStartY - 30, 'enemy', enemyId))
    enemyUnits.push(createUnit('archer', enemyStartX + 80, enemyStartY + 80, 'enemy', enemyId))
    enemyUnits.push(createUnit('archer', enemyStartX + 120, enemyStartY + 60, 'enemy', enemyId))
    enemyUnits.push(createUnit('catapult', enemyStartX - 50, enemyStartY + 100, 'enemy', enemyId))
  }
  
  return { ...state, buildings: [...state.buildings, enemyBase, enemyBarracks], units: [...state.units, ...enemyUnits] }
}

// ==================== MAIN COMPONENT ====================
export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const minimapRef = useRef<HTMLCanvasElement>(null)
  const [gameState, setGameState] = useState<GameState | null>(null)
  const [mousePos, setMousePos] = useState<MousePos>({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [ctrlPressed, setCtrlPressed] = useState(false)
  const [shiftPressed, setShiftPressed] = useState(false)
  const gameLoopRef = useRef<number | undefined>(undefined)
  const lastTimeRef = useRef<number>(0)
  const lastSyncRef = useRef<number>(0)
  const imagesRef = useRef<{ [key: string]: HTMLImageElement }>({})
  const notificationIdRef = useRef(0)
  const spatialGridRef = useRef<SpatialGrid>(new SpatialGrid(100))
  
  // Lobby state
  const [screen, setScreen] = useState<'menu' | 'lobby' | 'game'>('menu')
  const [playerName, setPlayerName] = useState(`Player_${Math.floor(Math.random() * 10000)}`)
  const [rooms, setRooms] = useState<any[]>([])
  const [currentRoom, setCurrentRoom] = useState<any>(null)
  const [chatInput, setChatInput] = useState('')
  const [roomName, setRoomName] = useState('My Game Room')
  const [selectedDifficulty, setSelectedDifficulty] = useState<'easy' | 'normal' | 'hard'>('normal')
  const [multiplayerMode, setMultiplayerMode] = useState<'host' | 'join' | null>(null)
  
  const playerIdRef = useRef<string>(Math.random().toString(36).substring(2, 15))
  const playerId = playerIdRef.current

  // Load images
  useEffect(() => {
    const images = ['worker', 'soldier', 'base', 'barracks', 'farm', 'tree', 'enemy']
    images.forEach(name => {
      const img = new Image()
      img.src = `/assets/${name}.png`
      imagesRef.current[name] = img
    })
    imagesRef.current['archer'] = imagesRef.current['soldier']
    imagesRef.current['healer'] = imagesRef.current['worker']
    imagesRef.current['catapult'] = imagesRef.current['soldier']
    imagesRef.current['tower'] = imagesRef.current['barracks']
    imagesRef.current['blacksmith'] = imagesRef.current['barracks']
    imagesRef.current['siegeWorkshop'] = imagesRef.current['barracks']
    imagesRef.current['wall'] = imagesRef.current['barracks']
  }, [])

  const addNotification = useCallback((message: string, type: 'info' | 'warning' | 'success' | 'danger' = 'info') => {
    setGameState(prev => {
      if (!prev) return prev
      return {
        ...prev,
        notifications: [...prev.notifications.slice(-4), { id: ++notificationIdRef.current, message, type, timestamp: Date.now() }]
      }
    })
  }, [])

  // Fetch rooms
  const fetchRooms = useCallback(async () => {
    try {
      const res = await fetch('/api/multiplayer?action=list')
      const data = await res.json()
      setRooms(data.rooms || [])
    } catch (e) {
      console.error('Failed to fetch rooms:', e)
    }
  }, [])

  // Create room
  const handleCreateRoom = useCallback(async () => {
    try {
      const res = await fetch('/api/multiplayer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          playerId,
          playerName,
          roomName,
          difficulty: selectedDifficulty
        })
      })
      const data = await res.json()
      if (data.room) {
        setCurrentRoom(data.room)
        setMultiplayerMode('host')
        setScreen('lobby')
      }
    } catch (e) {
      console.error('Failed to create room:', e)
    }
  }, [playerId, playerName, roomName, selectedDifficulty])

  // Join room
  const handleJoinRoom = useCallback(async (roomId: string) => {
    try {
      const res = await fetch('/api/multiplayer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'join',
          playerId,
          playerName,
          roomId
        })
      })
      const data = await res.json()
      if (data.room) {
        setCurrentRoom(data.room)
        setMultiplayerMode('join')
        setScreen('lobby')
      }
    } catch (e) {
      console.error('Failed to join room:', e)
    }
  }, [playerId, playerName])

  // Toggle ready
  const handleToggleReady = useCallback(async () => {
    if (!currentRoom) return
    try {
      const res = await fetch('/api/multiplayer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'ready',
          playerId,
          roomId: currentRoom.id
        })
      })
      const data = await res.json()
      if (data.room) {
        setCurrentRoom(data.room)
      }
    } catch (e) {
      console.error('Failed to toggle ready:', e)
    }
  }, [currentRoom, playerId])

  // Start game (host only)
  const handleStartGame = useCallback(async () => {
    if (!currentRoom || currentRoom.host !== playerId) return
    try {
      const res = await fetch('/api/multiplayer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'start',
          playerId,
          roomId: currentRoom.id
        })
      })
      const data = await res.json()
      if (data.room) {
        setCurrentRoom(data.room)
      }
    } catch (e) {
      console.error('Failed to start game:', e)
    }
  }, [currentRoom, playerId])

  // Leave room
  const handleLeaveRoom = useCallback(async () => {
    try {
      await fetch(`/api/multiplayer?action=leave&playerId=${playerId}`)
      setCurrentRoom(null)
      setMultiplayerMode(null)
      setScreen('menu')
    } catch (e) {
      console.error('Failed to leave room:', e)
    }
  }, [playerId])

  // Poll room state
  useEffect(() => {
    if (screen !== 'lobby' || !currentRoom) return
    
    const pollInterval = setInterval(async () => {
      try {
        const res = await fetch(`/api/multiplayer?action=get&roomId=${currentRoom.id}`)
        const data = await res.json()
        if (data.room) {
          setCurrentRoom(data.room)
          if (data.room.gameStarted) {
            // Initialize game for multiplayer
            const tileMap = generateMapWFC(MAP_TILES_X, MAP_TILES_Y, data.room.mapSeed)
            
            // Determine if this player is host or guest
            const isHost = data.room.host === playerId
            const myTeam = isHost ? 'host' : 'guest'
            
            // Host spawns at 12% (top-left), Guest spawns at 88% (bottom-right)
            const myTileX = isHost ? Math.floor(MAP_TILES_X * 0.12) : Math.floor(MAP_TILES_X * 0.88)
            const myTileY = isHost ? Math.floor(MAP_TILES_Y * 0.12) : Math.floor(MAP_TILES_Y * 0.88)
            const myPos = findPassableArea(tileMap, myTileX, myTileY, 5)
            const myStartX = myPos ? myPos.x * TILE_SIZE : (isHost ? 150 : MAP_WIDTH - 350)
            const myStartY = myPos ? myPos.y * TILE_SIZE : (isHost ? 200 : MAP_HEIGHT - 350)
            
            // Initialize discovered tiles array
            const discoveredTiles: boolean[][] = []
            for (let y = 0; y < tileMap.length; y++) {
              discoveredTiles[y] = []
              for (let x = 0; x < tileMap[y].length; x++) {
                discoveredTiles[y][x] = false
              }
            }
            
            // Extract resources from tile map
            const resources: Resource[] = []
            let resourceId = 1000
            for (let y = 0; y < tileMap.length; y++) {
              for (let x = 0; x < tileMap[y].length; x++) {
                const tile = tileMap[y][x]
                if (tile.type === 'gold' && tile.resourceAmount) {
                  resources.push({
                    id: resourceId++,
                    x: x * TILE_SIZE,
                    y: y * TILE_SIZE,
                    type: 'gold',
                    amount: tile.resourceAmount,
                    width: TILE_SIZE,
                    height: TILE_SIZE
                  })
                } else if (tile.type === 'forest' && tile.resourceAmount) {
                  resources.push({
                    id: resourceId++,
                    x: x * TILE_SIZE,
                    y: y * TILE_SIZE,
                    type: 'tree',
                    amount: tile.resourceAmount,
                    width: TILE_SIZE,
                    height: TILE_SIZE
                  })
                }
              }
            }
            
            // Create player's own units and buildings at their spawn position
            const myUnits: Unit[] = [
              createUnit('worker', myStartX + 50, myStartY + 100, 'player', playerId),
              createUnit('worker', myStartX + 100, myStartY + 100, 'player', playerId),
              createUnit('worker', myStartX + 50, myStartY + 150, 'player', playerId),
              createUnit('soldier', myStartX + 130, myStartY + 120, 'player', playerId),
            ]
            const myBuildings: Building[] = [
              createBuilding('base', myStartX, myStartY, 'player', playerId, true)
            ]
            
            // Add enemy player entities at opposite position
            const enemyPlayer = data.room.players.find((p: any) => p.id !== playerId)
            if (enemyPlayer) {
              // Enemy spawns at opposite corner
              const enemyTileX = isHost ? Math.floor(MAP_TILES_X * 0.88) : Math.floor(MAP_TILES_X * 0.12)
              const enemyTileY = isHost ? Math.floor(MAP_TILES_Y * 0.88) : Math.floor(MAP_TILES_Y * 0.12)
              const enemyPos = findPassableArea(tileMap, enemyTileX, enemyTileY, 5)
              const enemyStartX = enemyPos ? enemyPos.x * TILE_SIZE : (isHost ? MAP_WIDTH - 350 : 150)
              const enemyStartY = enemyPos ? enemyPos.y * TILE_SIZE : (isHost ? MAP_HEIGHT - 350 : 200)
              
              myBuildings.push(createBuilding('base', enemyStartX, enemyStartY, 'enemy', enemyPlayer.id, true))
              myBuildings.push(createBuilding('barracks', enemyStartX - 100, enemyStartY + 50, 'enemy', enemyPlayer.id, true))
              myUnits.push(createUnit('worker', enemyStartX + 50, enemyStartY + 100, 'enemy', enemyPlayer.id))
              myUnits.push(createUnit('worker', enemyStartX + 100, enemyStartY + 100, 'enemy', enemyPlayer.id))
              myUnits.push(createUnit('soldier', enemyStartX + 130, enemyStartY + 120, 'enemy', enemyPlayer.id))
            }
            
            const newState: GameState = {
              units: myUnits,
              buildings: myBuildings,
              resources,
              projectiles: [],
              playerResources: { gold: 200, wood: 100, supply: 5, maxSupply: 10 },
              enemyResources: { gold: 200, wood: 100, supply: 5, maxSupply: 10 },
              camera: { x: Math.max(0, myStartX - 100), y: Math.max(0, myStartY - 100) },
              mapSize: { width: MAP_WIDTH, height: MAP_HEIGHT },
              selectionBox: null,
              placingBuilding: null,
              gameOver: false,
              winner: null,
              attackMoveMode: false,
              patrolMode: false,
              attackGroundMode: false,
              notifications: [],
              controlGroups: {},
              fogOfWar: true, // Force fog of war in multiplayer
              discoveredTiles,
              gameSpeed: 1,
              upgrades: { player: { attack: 0, defense: 0, range: 0 }, enemy: { attack: 0, defense: 0, range: 0 } },
              minimapPings: [],
              difficulty: data.room.difficulty,
              gameStarted: false,
              tileMap,
              mapSeed: data.room.mapSeed,
              isMultiplayer: true,
              playerId,
              playerName,
              roomId: data.room.id,
              players: data.room.players.map((p: any) => ({
                id: p.id,
                name: p.name,
                team: p.team,
                color: p.color
              })),
              tick: 0,
              chatMessages: [],
              syncPending: false
            }
            
            newState.gameStarted = true
            setGameState(newState)
            setScreen('game')
          }
        } else {
          // Room no longer exists
          handleLeaveRoom()
        }
      } catch (e) {
        console.error('Failed to poll room:', e)
      }
    }, 500)
    
    return () => clearInterval(pollInterval)
  }, [screen, currentRoom, playerId, playerName, handleLeaveRoom])

  // Sync game state for multiplayer - only sync OWN units/buildings
  const syncPlayerState = useCallback(async (state: GameState) => {
    if (!state.isMultiplayer || !state.roomId || !state.playerId) {
      return
    }
    
    // Only sync this player's units and buildings
    const myUnits = state.units.filter(u => u.ownerId === state.playerId)
    const myBuildings = state.buildings.filter(b => b.ownerId === state.playerId)
    
    const payload = {
      action: 'syncPlayer',
      roomId: state.roomId,
      playerId: state.playerId,
      playerState: {
        units: myUnits,
        buildings: myBuildings,
        resources: state.playerResources,
        upgrades: state.upgrades.player,
        lastUpdate: Date.now()
      }
    }
    
    try {
      const res = await fetch('/api/multiplayer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        console.warn('Sync warning:', res.status, errorData.error || 'Unknown error')
      }
    } catch (e) {
      console.warn('Sync error:', e)
    }
  }, [])

  // Receive game state for multiplayer - merge opponent's units/buildings
  const receiveGameState = useCallback(async (currentRoomId: string, currentPlayerId: string) => {
    if (!currentRoomId || !currentPlayerId) return
    
    try {
      const res = await fetch(`/api/multiplayer?action=state&roomId=${currentRoomId}&playerId=${currentPlayerId}`)
      const data = await res.json()
      if (data.opponentState) {
        // Merge opponent's units and buildings into local state
        setGameState(prev => {
          if (!prev) return prev
          
          // Keep only our own units/buildings, add opponent's from sync
          const myUnits = prev.units.filter(u => u.ownerId === prev.playerId)
          const myBuildings = prev.buildings.filter(b => b.ownerId === prev.playerId)
          
          // Opponent's entities come with their ownerId
          const opponentUnits = data.opponentState.units || []
          const opponentBuildings = data.opponentState.buildings || []
          
          return {
            ...prev,
            units: [...myUnits, ...opponentUnits],
            buildings: [...myBuildings, ...opponentBuildings],
            enemyResources: data.opponentState.resources || prev.enemyResources,
            upgrades: {
              ...prev.upgrades,
              enemy: data.opponentState.upgrades || prev.upgrades.enemy
            }
          }
        })
      }
    } catch (e) {
      console.error('Failed to receive state:', e)
    }
  }, [])

  // Difficulty settings
  const getDifficultyMultiplier = (difficulty: 'easy' | 'normal' | 'hard') => {
    switch (difficulty) {
      case 'easy': return { enemyProductionSpeed: 0.6, enemyDamage: 0.7, enemyIncome: 0.5 }
      case 'normal': return { enemyProductionSpeed: 1, enemyDamage: 1, enemyIncome: 1 }
      case 'hard': return { enemyProductionSpeed: 1.5, enemyDamage: 1.3, enemyIncome: 1.5 }
    }
  }

  // Single player start
  const startSinglePlayer = (difficulty: 'easy' | 'normal' | 'hard') => {
    const newState = createInitialState(playerId, playerName)
    const stateWithEnemy = addEnemyEntities(newState, difficulty, 'ai')
    stateWithEnemy.gameStarted = true
    stateWithEnemy.difficulty = difficulty
    setGameState(stateWithEnemy)
    setScreen('game')
  }

  // Game loop
  useEffect(() => {
    if (screen !== 'game' || !gameState?.gameStarted) return
    
    const gameLoop = (timestamp: number) => {
      const deltaTime = timestamp - lastTimeRef.current
      
      // Target 60 FPS with max 20ms per tick
      if (deltaTime < 16 / gameState.gameSpeed) {
        gameLoopRef.current = requestAnimationFrame(gameLoop)
        return
      }
      lastTimeRef.current = timestamp
      
      // Measure actual tick time for performance
      const tickStart = performance.now()
      
      setGameState(prevState => {
        if (!prevState || prevState.gameOver) return prevState

        const difficultyMult = getDifficultyMultiplier(prevState.difficulty)
        let newState = { ...prevState }
        let updatedUnits = [...newState.units]
        let updatedBuildings = [...newState.buildings]
        const updatedResources = [...newState.resources]
        let updatedProjectiles = [...newState.projectiles]
        const playerResources = { ...newState.playerResources }
        let enemyResources = { ...newState.enemyResources }
        let gameOver = false
        let winner: 'player' | 'enemy' | null = null
        const upgrades = { ...newState.upgrades }
        let updatedPings = newState.minimapPings.filter(p => Date.now() - p.timestamp < 3000)
        let newTick = newState.tick + 1
        
        // Rebuild spatial grid
        spatialGridRef.current.clear()
        updatedUnits.forEach(u => spatialGridRef.current.insert(u))
        updatedBuildings.forEach(b => spatialGridRef.current.insert(b))

        // ===== UPDATE PROJECTILES =====
        updatedProjectiles = updatedProjectiles.map(proj => {
          const angle = Math.atan2(proj.targetY - proj.y, proj.targetX - proj.x)
          return { ...proj, x: proj.x + Math.cos(angle) * proj.speed, y: proj.y + Math.sin(angle) * proj.speed }
        }).filter(proj => {
          const dist = getDistance(proj.x, proj.y, proj.targetX, proj.targetY)
          if (dist < 10) {
            if (proj.splashRadius > 0) {
              updatedUnits.forEach(u => {
                const splashDist = getDistance(proj.targetX, proj.targetY, u.x, u.y)
                if (splashDist < proj.splashRadius && u.team !== proj.team) {
                  u.hp -= proj.damage * (1 - splashDist / proj.splashRadius / 2)
                }
              })
              updatedBuildings.forEach(b => {
                const splashDist = getDistance(proj.targetX, proj.targetY, b.x + b.width/2, b.y + b.height/2)
                if (splashDist < proj.splashRadius && b.team !== proj.team) {
                  b.hp -= proj.damage * (1 - splashDist / proj.splashRadius / 2)
                  b.isUnderAttack = true
                  b.underAttackTimer = 120
                }
              })
            } else if (proj.type === 'heal') {
              const targetUnit = updatedUnits.find(u => u.id === proj.targetId)
              if (targetUnit && targetUnit.hp < targetUnit.maxHp) {
                targetUnit.hp = Math.min(targetUnit.maxHp, targetUnit.hp + 8)
              }
            } else {
              const targetUnit = updatedUnits.find(u => u.id === proj.targetId)
              const targetBuilding = updatedBuildings.find(b => b.id === proj.targetId)
              const defenseBonus = targetUnit ? upgrades[targetUnit.team === 'player' ? 'player' : 'enemy'].defense : 0
              const damageMult = proj.team === 'enemy' && !prevState.isMultiplayer ? difficultyMult.enemyDamage : 1
              const damage = Math.max(1, (proj.damage - defenseBonus * 2) * damageMult)
              if (targetUnit) {
                targetUnit.hp -= damage
              } else if (targetBuilding) {
                targetBuilding.hp -= damage
                targetBuilding.isUnderAttack = true
                targetBuilding.underAttackTimer = 120
              }
            }
            return false
          }
          return true
        })

        // ===== UPDATE BUILDINGS =====
        updatedBuildings = updatedBuildings.map(building => {
          const b = { ...building }
          
          if (b.underAttackTimer > 0) {
            b.underAttackTimer--
            if (b.underAttackTimer <= 0) b.isUnderAttack = false
          }
          
          if (!b.isComplete) {
            b.constructionProgress += 100 / (BUILDING_STATS[b.type].buildTime * 60)
            if (b.constructionProgress >= 100) {
              b.isComplete = true
              b.constructionProgress = 100
              b.hp = b.maxHp
            }
          }
          
          if (b.productionQueue.length > 0 && b.isComplete) {
            const production = b.productionQueue[0]
            const speedMult = b.team === 'enemy' && !prevState.isMultiplayer ? difficultyMult.enemyProductionSpeed : 1
            production.progress += 1/60 * newState.gameSpeed * speedMult
            
            if (production.progress >= production.totalTime) {
              const spawnX = b.rallyPoint?.x || b.x + b.width + 20
              const spawnY = b.rallyPoint?.y || b.y + b.height / 2
              const newUnit = createUnit(production.type, spawnX, spawnY, b.team, b.ownerId)
              updatedUnits.push(newUnit)
              b.productionQueue.shift()
            }
          }
          
          if (b.type === 'tower' && b.isComplete && b.currentCooldown > 0) b.currentCooldown--
          
          if (b.type === 'tower' && b.isComplete && b.currentCooldown === 0) {
            const enemies = updatedUnits.filter(u => u.team !== b.team)
            const inRange = enemies.find(e => getDistance(b.x + b.width/2, b.y + b.height/2, e.x, e.y) < b.attackRange + upgrades[b.team].range * 10)
            
            if (inRange) {
              const attackBonus = upgrades[b.team].attack
              updatedProjectiles.push({
                id: createId(), x: b.x + b.width/2, y: b.y + b.height/2,
                targetX: inRange.x + inRange.width/2, targetY: inRange.y + inRange.height/2,
                damage: b.attackDamage + attackBonus * 3, team: b.team, speed: 10, targetId: inRange.id, type: 'arrow', splashRadius: 0
              })
              b.currentCooldown = b.attackCooldown
            }
          }
          
          return b
        })

        // ===== UPDATE UNITS =====
        updatedUnits = updatedUnits.map(unit => {
          const u = { ...unit }
          const teamUpgrades = upgrades[u.team === 'player' ? 'player' : 'enemy']
          
          if (u.currentCooldown > 0) u.currentCooldown--
          if (u.currentHealCooldown > 0) u.currentHealCooldown--
          
          // Healer auto-heal
          if (u.type === 'healer' && u.currentHealCooldown === 0) {
            const injuredAllies = updatedUnits.filter(ally => 
              ally.team === u.team && ally.hp < ally.maxHp && ally.id !== u.id &&
              getDistance(u.x, u.y, ally.x, ally.y) < u.healRange
            )
            if (injuredAllies.length > 0) {
              const target = injuredAllies[0]
              updatedProjectiles.push({
                id: createId(), x: u.x + u.width/2, y: u.y + u.height/2,
                targetX: target.x + target.width/2, targetY: target.y + target.height/2,
                damage: 0, team: u.team, speed: 6, targetId: target.id, type: 'heal', splashRadius: 0
              })
              u.currentHealCooldown = u.healCooldown
            }
          }
          
          // Worker repair
          if (u.type === 'worker' && u.repairTarget) {
            const target = updatedBuildings.find(b => b.id === u.repairTarget!.id)
            if (target && target.hp < target.maxHp) {
              const dist = getDistance(u.x, u.y, target.x + target.width/2, target.y + target.height/2)
              if (dist > 50 && !u.targetX) {
                u.targetX = target.x + target.width/2
                u.targetY = target.y + target.height/2
              } else if (dist <= 50) {
                target.hp = Math.min(target.maxHp, target.hp + 2)
                u.currentCooldown = u.attackCooldown
              }
            } else {
              u.repairTarget = null
            }
          }
          
          // Attack ground for catapults
          if (u.attackGroundX !== null && u.attackGroundY !== null && u.currentCooldown === 0) {
            const dist = getDistance(u.x, u.y, u.attackGroundX, u.attackGroundY)
            if (dist <= u.attackRange) {
              updatedProjectiles.push({
                id: createId(), x: u.x + u.width/2, y: u.y + u.height/2,
                targetX: u.attackGroundX, targetY: u.attackGroundY,
                damage: u.attackDamage, team: u.team, speed: u.projectileSpeed,
                targetId: 0, type: 'boulder', splashRadius: u.splashRadius
              })
              u.currentCooldown = u.attackCooldown
              u.attackGroundX = null
              u.attackGroundY = null
            } else if (!u.targetX) {
              u.targetX = u.attackGroundX
              u.targetY = u.attackGroundY
            }
          }
          
          // Auto-attack for combat units
          if (!u.targetX && !u.gatheringTarget && !u.repairTarget && u.type !== 'worker' && u.type !== 'healer' && u.currentCooldown === 0 && u.attackGroundX === null) {
            const enemies = updatedUnits.filter(other => other.team !== u.team)
            const nearbyEnemy = enemies.find(e => getDistance(u.x, u.y, e.x, e.y) < u.attackRange * 1.5 + teamUpgrades.range * 10)
            if (nearbyEnemy) u.attackTarget = nearbyEnemy
          }
          
          // Attack target handling
          if (u.attackTarget) {
            const target = updatedUnits.find(e => e.id === u.attackTarget!.id) || 
                          updatedBuildings.find(b => b.id === u.attackTarget!.id)
            
            if (!target || target.hp <= 0) {
              u.attackTarget = null
              if (u.waypoints.length > 0) {
                const wp = u.waypoints.shift()!
                u.targetX = wp.x
                u.targetY = wp.y
                u.command = wp.command
                if (wp.target) u.attackTarget = wp.target as Entity
              }
            } else {
              const effectiveRange = u.attackRange + teamUpgrades.range * 10
              const dist = getDistance(u.x, u.y, target.x, target.y)
              
              if (dist <= effectiveRange) {
                if (u.currentCooldown === 0) {
                  const attackBonus = teamUpgrades.attack
                  if (u.isRanged) {
                    updatedProjectiles.push({
                      id: createId(), x: u.x + u.width/2, y: u.y + u.height/2,
                      targetX: target.x + target.width/2, targetY: target.y + target.height/2,
                      damage: u.attackDamage + attackBonus * 2, team: u.team, speed: u.projectileSpeed,
                      targetId: target.id, type: u.type === 'catapult' ? 'boulder' : 'arrow', splashRadius: u.splashRadius
                    })
                  } else {
                    const defenseBonus = upgrades[target.team === 'player' ? 'player' : 'enemy'].defense
                    target.hp -= Math.max(1, u.attackDamage + attackBonus * 2 - defenseBonus * 2)
                  }
                  u.currentCooldown = u.attackCooldown
                }
              } else {
                const angle = Math.atan2(target.y - u.y, target.x - u.x)
                u.x += Math.cos(angle) * u.speed
                u.y += Math.sin(angle) * u.speed
              }
            }
          }
          
          // Movement with collision avoidance using spatial grid
          if (u.targetX !== null && u.targetY !== null && !u.attackTarget) {
            const dist = getDistance(u.x, u.y, u.targetX, u.targetY)
            
            if (dist > 5) {
              const angle = Math.atan2(u.targetY - u.y, u.targetX - u.x)
              let avoidX = 0, avoidY = 0
              
              // Use spatial grid for efficient collision check
              const nearby = spatialGridRef.current.getNearby(u.x, u.y, 50)
              nearby.forEach(other => {
                if ((other as Entity).id !== u.id) {
                  const d = getDistance(u.x, u.y, (other as Entity).x, (other as Entity).y)
                  if (d < 40 && d > 0) {
                    avoidX += (u.x - (other as Entity).x) / d * 0.5
                    avoidY += (u.y - (other as Entity).y) / d * 0.5
                  }
                }
              })
              
              // Check building collisions
              updatedBuildings.forEach(b => {
                if (!b.isComplete || b.type === 'wall') {
                  const closestX = clamp(u.x, b.x, b.x + b.width)
                  const closestY = clamp(u.y, b.y, b.y + b.height)
                  const d = getDistance(u.x, u.y, closestX, closestY)
                  if (d < 30 && d > 0) {
                    avoidX += (u.x - closestX) / d * 1.5
                    avoidY += (u.y - closestY) / d * 1.5
                  }
                }
              })
              
              const newX = u.x + Math.cos(angle) * u.speed + avoidX
              const newY = u.y + Math.sin(angle) * u.speed + avoidY
              
              // Check if new position is passable
              const tileX = Math.floor((newX + u.width/2) / TILE_SIZE)
              const tileY = Math.floor((newY + u.height/2) / TILE_SIZE)
              const targetTile = newState.tileMap[tileY]?.[tileX]
              
              // Check building collision at new position
              const buildingCollision = updatedBuildings.some(b => 
                !b.isComplete && 
                newX < b.x + b.width && newX + u.width > b.x &&
                newY < b.y + b.height && newY + u.height > b.y
              )
              
              if (targetTile && targetTile.passable && !buildingCollision) {
                u.x = clamp(newX, 0, newState.mapSize.width - u.width)
                u.y = clamp(newY, 0, newState.mapSize.height - u.height)
              } else {
                // Try alternate paths
                const leftAngle = angle - Math.PI / 4
                const rightAngle = angle + Math.PI / 4
                
                for (const tryAngle of [leftAngle, rightAngle, angle - Math.PI/2, angle + Math.PI/2]) {
                  const tryX = u.x + Math.cos(tryAngle) * u.speed
                  const tryY = u.y + Math.sin(tryAngle) * u.speed
                  const tryTileX = Math.floor((tryX + u.width/2) / TILE_SIZE)
                  const tryTileY = Math.floor((tryY + u.height/2) / TILE_SIZE)
                  const tryTile = newState.tileMap[tryTileY]?.[tryTileX]
                  
                  const tryBuildingCollision = updatedBuildings.some(b => 
                    !b.isComplete && 
                    tryX < b.x + b.width && tryX + u.width > b.x &&
                    tryY < b.y + b.height && tryY + u.height > b.y
                  )
                  
                  if (tryTile && tryTile.passable && !tryBuildingCollision) {
                    u.x = clamp(tryX, 0, newState.mapSize.width - u.width)
                    u.y = clamp(tryY, 0, newState.mapSize.height - u.height)
                    break
                  }
                }
              }
            } else {
              if (u.command === 'attackMove') {
                const enemies = updatedUnits.filter(other => other.team !== u.team)
                const nearbyEnemy = enemies.find(e => getDistance(u.x, u.y, e.x, e.y) < u.attackRange * 2)
                if (nearbyEnemy) u.attackTarget = nearbyEnemy
                else if (u.waypoints.length > 0) {
                  const wp = u.waypoints.shift()!
                  u.targetX = wp.x
                  u.targetY = wp.y
                  u.command = wp.command
                } else {
                  u.targetX = null
                  u.targetY = null
                  u.command = null
                }
              } else if (u.command === 'patrol' && u.patrolPoints.length >= 2) {
                u.patrolIndex = (u.patrolIndex + 1) % u.patrolPoints.length
                u.targetX = u.patrolPoints[u.patrolIndex].x
                u.targetY = u.patrolPoints[u.patrolIndex].y
              } else {
                if (u.waypoints.length > 0) {
                  const wp = u.waypoints.shift()!
                  u.targetX = wp.x
                  u.targetY = wp.y
                  u.command = wp.command
                  if (wp.target) {
                    u.attackTarget = wp.target as Entity
                    u.gatheringTarget = wp.target as Resource
                  }
                } else {
                  u.targetX = null
                  u.targetY = null
                  u.command = null
                }
              }
            }
          }
          
          // Worker gathering
          if (u.type === 'worker' && u.ownerId === prevState.playerId && !u.repairTarget) {
            if (u.returningToBase && u.carryingAmount > 0) {
              const base = updatedBuildings.find(b => b.ownerId === u.ownerId && (b.type === 'base' || b.type === 'farm'))
              if (base) {
                const distToBase = getDistance(u.x, u.y, base.x + base.width / 2, base.y + base.height / 2)
                if (distToBase < 60) {
                  if (u.carryingResource === 'gold') {
                    if (u.ownerId === prevState.playerId) playerResources.gold += u.carryingAmount
                    else enemyResources.gold += u.carryingAmount
                  }
                  else if (u.carryingResource === 'wood') {
                    if (u.ownerId === prevState.playerId) playerResources.wood += u.carryingAmount
                    else enemyResources.wood += u.carryingAmount
                  }
                  u.carryingResource = null
                  u.carryingAmount = 0
                  u.returningToBase = false
                  
                  if (u.waypoints.length > 0) {
                    const wp = u.waypoints.shift()!
                    u.targetX = wp.x
                    u.targetY = wp.y
                    if (wp.target) u.gatheringTarget = wp.target as Resource
                  } else if (u.gatheringTarget && u.gatheringTarget.amount > 0) {
                    u.targetX = u.gatheringTarget.x + u.gatheringTarget.width / 2
                    u.targetY = u.gatheringTarget.y + u.gatheringTarget.height / 2
                  } else {
                    u.gatheringTarget = null
                  }
                } else if (!u.targetX) {
                  u.targetX = base.x + base.width / 2
                  u.targetY = base.y + base.height / 2
                }
              }
            } else if (u.gatheringTarget && !u.returningToBase) {
              const resource = updatedResources.find(r => r.id === u.gatheringTarget!.id)
              if (resource && resource.amount > 0) {
                const distToResource = getDistance(u.x, u.y, resource.x + resource.width / 2, resource.y + resource.height / 2)
                if (distToResource < 50) {
                  const gatherAmount = Math.min(8, resource.amount)
                  resource.amount -= gatherAmount
                  u.carryingAmount = gatherAmount
                  u.carryingResource = resource.type === 'gold' ? 'gold' : 'wood'
                  u.returningToBase = true
                }
              } else {
                u.gatheringTarget = null
              }
            }
          }
          
          return u
        })

        // Remove dead units
        updatedUnits = updatedUnits.filter(u => u.hp > 0)
        
        // Remove destroyed buildings
        updatedBuildings = updatedBuildings.filter(b => {
          if (b.hp <= 0) {
            if (b.ownerId === prevState.playerId) {
              playerResources.maxSupply -= BUILDING_STATS[b.type].supply
              addNotification(`${b.type} destroyed!`, 'danger')
            }
            return false
          }
          return true
        })
        
        // Remove depleted resources
        const filteredResources = updatedResources.filter(r => r.amount > 0)

        // ===== ENEMY AI (only for single player) =====
        if (!prevState.isMultiplayer) {
          const enemyUnits = updatedUnits.filter(u => u.team === 'enemy')
          const playerUnits = updatedUnits.filter(u => u.team === 'player')
          const playerBuildings = updatedBuildings.filter(b => b.team === 'player')
          const enemyBuildings = updatedBuildings.filter(b => b.team === 'enemy')
          const enemyBase = enemyBuildings.find(b => b.type === 'base')
          const enemyBarracks = enemyBuildings.find(b => b.type === 'barracks')
          const enemySiegeWorkshop = enemyBuildings.find(b => b.type === 'siegeWorkshop')
          const enemyBlacksmith = enemyBuildings.find(b => b.type === 'blacksmith')
          
          enemyResources.gold += 0.5 * difficultyMult.enemyIncome
          
          if (enemyBarracks && enemyBarracks.isComplete && enemyBarracks.productionQueue.length < 3) {
            if (enemyResources.gold >= 80 && enemyResources.supply + 2 <= enemyResources.maxSupply) {
              const rand = Math.random()
              const unitType: UnitType = rand > 0.6 ? 'soldier' : rand > 0.3 ? 'archer' : 'healer'
              const cost = UNIT_STATS[unitType].cost
              if (enemyResources.gold >= cost.gold && enemyResources.wood >= cost.wood) {
                enemyResources.gold -= cost.gold
                enemyResources.wood -= cost.wood
                enemyResources.supply += UNIT_STATS[unitType].supply
                enemyBarracks.productionQueue.push({ type: unitType, progress: 0, totalTime: 10 })
              }
            }
          }
          
          if (enemySiegeWorkshop && enemySiegeWorkshop.isComplete && enemySiegeWorkshop.productionQueue.length === 0) {
            if (enemyResources.gold >= 120 && enemyResources.wood >= 80 && enemyResources.supply + 3 <= enemyResources.maxSupply) {
              enemyResources.gold -= 120
              enemyResources.wood -= 80
              enemyResources.supply += 3
              enemySiegeWorkshop.productionQueue.push({ type: 'catapult', progress: 0, totalTime: 15 })
            }
          }
          
          if (enemyBase && enemyBase.isComplete && enemyBase.productionQueue.length === 0 && 
              enemyResources.gold >= 50 && enemyResources.supply + 1 <= enemyResources.maxSupply) {
            enemyResources.gold -= 50
            enemyResources.supply += 1
            enemyBase.productionQueue.push({ type: 'worker', progress: 0, totalTime: 8 })
          }
          
          if (enemyBlacksmith && enemyBlacksmith.isComplete && enemyResources.gold >= 100) {
            const upgradeType = Math.floor(Math.random() * 3)
            if (upgradeType === 0 && upgrades.enemy.attack < 3) {
              upgrades.enemy = { ...upgrades.enemy, attack: upgrades.enemy.attack + 1 }
              enemyResources.gold -= 100
            } else if (upgradeType === 1 && upgrades.enemy.defense < 3) {
              upgrades.enemy = { ...upgrades.enemy, defense: upgrades.enemy.defense + 1 }
              enemyResources.gold -= 100
            } else if (upgradeType === 2 && upgrades.enemy.range < 2) {
              upgrades.enemy = { ...upgrades.enemy, range: upgrades.enemy.range + 1 }
              enemyResources.gold -= 100
            }
          }
          
          enemyUnits.forEach(enemyUnit => {
            const idx = updatedUnits.findIndex(u => u.id === enemyUnit.id)
            if (idx === -1) return
            if (enemyUnit.attackTarget) return
            
            let nearestPlayer: Unit | null = null
            let minDist = Infinity
            playerUnits.forEach(p => {
              const d = getDistance(enemyUnit.x, enemyUnit.y, p.x, p.y)
              if (d < minDist) { minDist = d; nearestPlayer = p }
            })
            
            let nearestBuilding: Building | null = null
            let minBuildingDist = Infinity
            playerBuildings.forEach(b => {
              const d = getDistance(enemyUnit.x, enemyUnit.y, b.x + b.width/2, b.y + b.height/2)
              if (d < minBuildingDist) { minBuildingDist = d; nearestBuilding = b }
            })
            
            if (enemyUnit.type === 'catapult' && nearestBuilding) {
              updatedUnits[idx] = { ...updatedUnits[idx], attackGroundX: nearestBuilding.x + nearestBuilding.width/2, attackGroundY: nearestBuilding.y + nearestBuilding.height/2 }
            } else if (nearestPlayer && minDist < 400) {
              updatedUnits[idx] = { ...updatedUnits[idx], attackTarget: nearestPlayer }
            } else if (nearestBuilding) {
              const distToBuilding = getDistance(enemyUnit.x, enemyUnit.y, nearestBuilding.x + nearestBuilding.width/2, nearestBuilding.y + nearestBuilding.height/2)
              if (distToBuilding < enemyUnit.attackRange + 30) {
                updatedUnits[idx] = { ...updatedUnits[idx], attackTarget: nearestBuilding }
              } else {
                updatedUnits[idx] = { ...updatedUnits[idx], targetX: nearestBuilding.x + nearestBuilding.width/2, targetY: nearestBuilding.y + nearestBuilding.height/2 }
              }
            }
          })
        }

        // ===== WIN/LOSE CONDITIONS =====
        const playerBaseExists = updatedBuildings.some(b => b.ownerId === prevState.playerId && b.type === 'base')
        const enemyBaseExists = updatedBuildings.some(b => b.ownerId !== prevState.playerId && b.type === 'base')
        
        if (!playerBaseExists) { gameOver = true; winner = 'enemy' }
        else if (!enemyBaseExists) { gameOver = true; winner = 'player' }

        // Check tick time for performance monitoring
        const tickTime = performance.now() - tickStart
        if (tickTime > 15) {
          console.warn(`Tick took ${tickTime.toFixed(2)}ms`)
        }

        return {
          ...newState, units: updatedUnits, buildings: updatedBuildings,
          resources: filteredResources, projectiles: updatedProjectiles,
          playerResources, enemyResources, gameOver, winner, upgrades, minimapPings: updatedPings,
          tick: newTick
        }
      })

      // Sync state for multiplayer
      if (timestamp - lastSyncRef.current > SYNC_INTERVAL && gameState?.isMultiplayer) {
        lastSyncRef.current = timestamp
        setGameState(prev => {
          if (prev && prev.roomId && prev.playerId) {
            syncPlayerState(prev)
            receiveGameState(prev.roomId, prev.playerId)
          }
          return prev
        })
      }

      gameLoopRef.current = requestAnimationFrame(gameLoop)
    }

    gameLoopRef.current = requestAnimationFrame(gameLoop)
    return () => { if (gameLoopRef.current) cancelAnimationFrame(gameLoopRef.current) }
  }, [screen, gameState?.gameStarted, gameState?.gameSpeed, gameState?.difficulty, addNotification, syncPlayerState, receiveGameState, gameState?.isMultiplayer, gameState?.roomId, gameState?.playerId])

  // ===== RENDER =====
  useEffect(() => {
    if (!gameState) return
    
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    const minimap = minimapRef.current
    const minimapCtx = minimap?.getContext('2d')
    
    if (!canvas || !ctx || !minimap || !minimapCtx) return

    ctx.fillStyle = '#1a1a1a'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    // Draw terrain
    const startTileX = Math.floor(gameState.camera.x / TILE_SIZE)
    const startTileY = Math.floor(gameState.camera.y / TILE_SIZE)
    const endTileX = Math.min(MAP_TILES_X, startTileX + Math.ceil(canvas.width / TILE_SIZE) + 2)
    const endTileY = Math.min(MAP_TILES_Y, startTileY + Math.ceil(canvas.height / TILE_SIZE) + 2)
    
    for (let ty = Math.max(0, startTileY); ty < endTileY; ty++) {
      for (let tx = Math.max(0, startTileX); tx < endTileX; tx++) {
        const tile = gameState.tileMap[ty]?.[tx]
        if (tile) {
          const screenX = tx * TILE_SIZE - gameState.camera.x
          const screenY = ty * TILE_SIZE - gameState.camera.y
          
          const centerX = tx * TILE_SIZE + TILE_SIZE / 2
          const centerY = ty * TILE_SIZE + TILE_SIZE / 2
          const isVisible = gameState.units.some(u => u.ownerId === gameState.playerId && getDistance(u.x, u.y, centerX, centerY) < VISION_RANGE) ||
                 gameState.buildings.some(b => b.ownerId === gameState.playerId && getDistance(b.x + b.width/2, b.y + b.height/2, centerX, centerY) < VISION_RANGE)
          
          if (gameState.fogOfWar) {
            // Update discovered tiles
            if (isVisible && gameState.discoveredTiles) {
              gameState.discoveredTiles[ty][tx] = true
            }
            
            // If not visible and not discovered, skip
            if (!isVisible && !gameState.discoveredTiles?.[ty]?.[tx]) {
              continue
            }
          }
          
          const props = TILE_PROPERTIES[tile.type]
          
          // If discovered but not currently visible, render darker
          if (gameState.fogOfWar && !isVisible && gameState.discoveredTiles?.[ty]?.[tx]) {
            ctx.fillStyle = darkenColor(props.color, 0.4)
          } else {
            ctx.fillStyle = props.color
          }
          ctx.fillRect(screenX, screenY, TILE_SIZE, TILE_SIZE)
          
          if (tile.type === 'water') {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.1)'
            ctx.fillRect(screenX + 5, screenY + 10, TILE_SIZE - 10, 3)
          } else if (tile.type === 'mountain') {
            ctx.fillStyle = gameState.fogOfWar && !isVisible ? '#555' : '#888'
            ctx.beginPath()
            ctx.moveTo(screenX + TILE_SIZE/2, screenY + 5)
            ctx.lineTo(screenX + 8, screenY + TILE_SIZE - 5)
            ctx.lineTo(screenX + TILE_SIZE - 8, screenY + TILE_SIZE - 5)
            ctx.closePath()
            ctx.fill()
          }
        }
      }
    }

    const isVisible = (x: number, y: number): boolean => {
      if (!gameState.fogOfWar) return true
      return gameState.units.some(u => u.ownerId === gameState.playerId && getDistance(u.x, u.y, x, y) < VISION_RANGE) ||
             gameState.buildings.some(b => b.ownerId === gameState.playerId && getDistance(b.x, b.y, x, y) < VISION_RANGE)
    }

    // Draw resources
    gameState.resources.forEach(resource => {
      if (!isVisible(resource.x, resource.y)) return
      const screenX = resource.x - gameState.camera.x
      const screenY = resource.y - gameState.camera.y
      
      if (resource.type === 'gold') {
        ctx.fillStyle = '#FFD700'
        ctx.fillRect(screenX, screenY, resource.width, resource.height)
        ctx.fillStyle = '#FFA500'
        ctx.fillRect(screenX + 5, screenY + 5, resource.width - 10, resource.height - 10)
        ctx.fillStyle = '#fff'
        ctx.font = 'bold 10px Arial'
        ctx.textAlign = 'center'
        ctx.fillText(`${Math.floor(resource.amount)}`, screenX + resource.width / 2, screenY + resource.height / 2 + 4)
      } else {
        const treeImg = imagesRef.current['tree']
        if (treeImg && treeImg.complete) ctx.drawImage(treeImg, screenX - 10, screenY - 10, resource.width + 20, resource.height + 20)
        else {
          ctx.fillStyle = '#228B22'
          ctx.beginPath()
          ctx.arc(screenX + resource.width / 2, screenY + resource.height / 2, resource.width / 2, 0, Math.PI * 2)
          ctx.fill()
        }
      }
    })

    // Draw buildings
    gameState.buildings.forEach(building => {
      if (!isVisible(building.x, building.y) && building.ownerId !== gameState.playerId) return
      const screenX = building.x - gameState.camera.x
      const screenY = building.y - gameState.camera.y
      
      // Draw wall differently
      if (building.type === 'wall') {
        ctx.fillStyle = '#666'
        ctx.fillRect(screenX, screenY, building.width, building.height)
        ctx.strokeStyle = '#444'
        ctx.lineWidth = 2
        ctx.strokeRect(screenX, screenY, building.width, building.height)
      } else {
        const img = imagesRef.current[building.type] || imagesRef.current['base']
        if (img && img.complete) ctx.drawImage(img, screenX, screenY, building.width, building.height)
        else {
          ctx.fillStyle = building.team === 'player' ? '#4169E1' : '#8B0000'
          ctx.fillRect(screenX, screenY, building.width, building.height)
        }
      }
      
      if (building.isUnderAttack && building.ownerId === gameState.playerId) {
        ctx.strokeStyle = '#ff0000'
        ctx.lineWidth = 3
        ctx.strokeRect(screenX - 3, screenY - 3, building.width + 6, building.height + 6)
      }
      
      if (!building.isComplete && building.type !== 'wall') {
        ctx.fillStyle = 'rgba(0,0,0,0.5)'
        ctx.fillRect(screenX, screenY, building.width * (1 - building.constructionProgress / 100), building.height)
        ctx.fillStyle = '#fff'
        ctx.font = '12px Arial'
        ctx.textAlign = 'center'
        ctx.fillText(`${Math.floor(building.constructionProgress)}%`, screenX + building.width/2, screenY + building.height/2)
      }
      
      const healthPercent = building.hp / building.maxHp
      ctx.fillStyle = '#333'
      ctx.fillRect(screenX, screenY - 12, building.width, 8)
      ctx.fillStyle = healthPercent > 0.6 ? '#0f0' : healthPercent > 0.3 ? '#ff0' : '#f00'
      ctx.fillRect(screenX + 1, screenY - 11, (building.width - 2) * healthPercent, 6)
      
      if (building.selected) {
        ctx.strokeStyle = '#00ff00'
        ctx.lineWidth = 2
        ctx.strokeRect(screenX - 2, screenY - 2, building.width + 4, building.height + 4)
      }
      
      ctx.fillStyle = building.ownerId === gameState.playerId ? '#00ff00' : '#ff0000'
      ctx.beginPath()
      ctx.arc(screenX + 10, screenY + 10, 5, 0, Math.PI * 2)
      ctx.fill()
      
      if (building.rallyPoint && building.productionQueue.length > 0) {
        const rallyScreenX = building.rallyPoint.x - gameState.camera.x
        const rallyScreenY = building.rallyPoint.y - gameState.camera.y
        ctx.strokeStyle = '#fff'
        ctx.lineWidth = 1
        ctx.setLineDash([3, 3])
        ctx.beginPath()
        ctx.moveTo(screenX + building.width/2, screenY + building.height)
        ctx.lineTo(rallyScreenX, rallyScreenY)
        ctx.stroke()
        ctx.setLineDash([])
      }
    })

    // Draw projectiles
    gameState.projectiles.forEach(proj => {
      const screenX = proj.x - gameState.camera.x
      const screenY = proj.y - gameState.camera.y
      if (proj.type === 'heal') {
        ctx.fillStyle = '#00ff00'
        ctx.beginPath()
        ctx.arc(screenX, screenY, 5, 0, Math.PI * 2)
        ctx.fill()
      } else if (proj.type === 'boulder') {
        ctx.fillStyle = '#8B4513'
        ctx.beginPath()
        ctx.arc(screenX, screenY, 8, 0, Math.PI * 2)
        ctx.fill()
      } else {
        ctx.fillStyle = proj.team === 'player' ? '#00ffff' : '#ff6600'
        ctx.beginPath()
        ctx.arc(screenX, screenY, 4, 0, Math.PI * 2)
        ctx.fill()
      }
    })

    // Draw units
    gameState.units.forEach(unit => {
      if (!isVisible(unit.x, unit.y) && unit.ownerId !== gameState.playerId) return
      const screenX = unit.x - gameState.camera.x
      const screenY = unit.y - gameState.camera.y
      
      let imgName = unit.ownerId !== gameState.playerId ? 'enemy' : unit.type
      const img = imagesRef.current[imgName]
      
      if (img && img.complete) ctx.drawImage(img, screenX, screenY, unit.width, unit.height)
      else {
        ctx.fillStyle = unit.ownerId === gameState.playerId ? '#4169E1' : '#DC143C'
        ctx.fillRect(screenX, screenY, unit.width, unit.height)
      }
      
      if (unit.type === 'archer') {
        ctx.fillStyle = '#00ffff'
        ctx.beginPath()
        ctx.moveTo(screenX + unit.width/2, screenY)
        ctx.lineTo(screenX + unit.width/2 - 5, screenY - 8)
        ctx.lineTo(screenX + unit.width/2 + 5, screenY - 8)
        ctx.closePath()
        ctx.fill()
      } else if (unit.type === 'healer') {
        ctx.fillStyle = '#00ff00'
        ctx.font = '12px Arial'
        ctx.fillText('+', screenX + unit.width/2 - 4, screenY - 2)
      } else if (unit.type === 'catapult') {
        ctx.fillStyle = '#8B4513'
        ctx.fillRect(screenX + 2, screenY + 2, unit.width - 4, unit.height - 4)
      }
      
      if (unit.selected) {
        ctx.strokeStyle = '#00ff00'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(screenX + unit.width / 2, screenY + unit.height / 2, unit.width / 2 + 6, 0, Math.PI * 2)
        ctx.stroke()
      }
      
      const healthPercent = unit.hp / unit.maxHp
      ctx.fillStyle = '#333'
      ctx.fillRect(screenX, screenY - 8, unit.width, 5)
      ctx.fillStyle = healthPercent > 0.6 ? '#0f0' : healthPercent > 0.3 ? '#ff0' : '#f00'
      ctx.fillRect(screenX + 1, screenY - 7, (unit.width - 2) * healthPercent, 3)
      
      if (unit.carryingAmount > 0) {
        ctx.fillStyle = unit.carryingResource === 'gold' ? '#FFD700' : '#8B4513'
        ctx.beginPath()
        ctx.arc(screenX + unit.width / 2, screenY - 14, 5, 0, Math.PI * 2)
        ctx.fill()
      }
    })

    // Selection box
    if (gameState.selectionBox) {
      ctx.strokeStyle = '#00ff00'
      ctx.lineWidth = 1
      ctx.setLineDash([5, 5])
      ctx.fillStyle = 'rgba(0, 255, 0, 0.1)'
      const x = Math.min(gameState.selectionBox.startX, gameState.selectionBox.endX)
      const y = Math.min(gameState.selectionBox.startY, gameState.selectionBox.endY)
      const w = Math.abs(gameState.selectionBox.endX - gameState.selectionBox.startX)
      const h = Math.abs(gameState.selectionBox.endY - gameState.selectionBox.startY)
      ctx.fillRect(x, y, w, h)
      ctx.strokeRect(x, y, w, h)
      ctx.setLineDash([])
    }

    // Building placement preview
    if (gameState.placingBuilding) {
      const size = gameState.placingBuilding === 'base' ? 96 : gameState.placingBuilding === 'tower' ? 48 : gameState.placingBuilding === 'wall' ? 40 : 80
      
      const worldX = mousePos.x + gameState.camera.x
      const worldY = mousePos.y + gameState.camera.y
      const startTileX = Math.floor((worldX - size/2) / TILE_SIZE)
      const startTileY = Math.floor((worldY - size/2) / TILE_SIZE)
      const endTileX = Math.ceil((worldX + size/2) / TILE_SIZE)
      const endTileY = Math.ceil((worldY + size/2) / TILE_SIZE)
      
      let canPlace = true
      for (let ty = startTileY; ty < endTileY && canPlace; ty++) {
        for (let tx = startTileX; tx < endTileX && canPlace; tx++) {
          const tile = gameState.tileMap[ty]?.[tx]
          if (!tile || !tile.passable) canPlace = false
        }
      }
      
      // Check building collision
      const wouldCollide = gameState.buildings.some(b =>
        worldX - size/2 < b.x + b.width &&
        worldX + size/2 > b.x &&
        worldY - size/2 < b.y + b.height &&
        worldY + size/2 > b.y
      )
      if (wouldCollide) canPlace = false
      
      ctx.fillStyle = canPlace ? 'rgba(0, 255, 0, 0.3)' : 'rgba(255, 0, 0, 0.3)'
      ctx.fillRect(mousePos.x - size/2, mousePos.y - size/2, size, size)
      ctx.strokeStyle = canPlace ? '#00ff00' : '#ff0000'
      ctx.lineWidth = 2
      ctx.strokeRect(mousePos.x - size/2, mousePos.y - size/2, size, size)
    }

    // ===== MINIMAP =====
    const minimapScale = MINIMAP_SIZE / MAP_WIDTH
    minimapCtx.fillStyle = '#1a1a1a'
    minimapCtx.fillRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE)
    
    const minimapTileSize = Math.max(1, Math.floor(TILE_SIZE * minimapScale))
    for (let ty = 0; ty < MAP_TILES_Y; ty += 2) {
      for (let tx = 0; tx < MAP_TILES_X; tx += 2) {
        const tile = gameState.tileMap[ty]?.[tx]
        if (tile) {
          minimapCtx.fillStyle = TILE_PROPERTIES[tile.type].color
          minimapCtx.fillRect(tx * TILE_SIZE * minimapScale, ty * TILE_SIZE * minimapScale, minimapTileSize * 2, minimapTileSize * 2)
        }
      }
    }
    
    minimapCtx.strokeStyle = '#fff'
    minimapCtx.lineWidth = 1
    minimapCtx.strokeRect(
      gameState.camera.x * minimapScale,
      gameState.camera.y * minimapScale,
      canvas.width * minimapScale,
      canvas.height * minimapScale
    )
    
    // Only show opponent entities on minimap if visible (fog of war)
    gameState.buildings.forEach(b => {
      // Always show own buildings, only show opponent buildings if visible
      if (b.ownerId !== gameState.playerId && !isVisible(b.x, b.y)) return
      minimapCtx.fillStyle = b.ownerId === gameState.playerId ? '#00f' : '#f00'
      minimapCtx.fillRect(b.x * minimapScale - 3, b.y * minimapScale - 3, 6, 6)
    })
    
    gameState.units.forEach(u => {
      // Always show own units, only show opponent units if visible
      if (u.ownerId !== gameState.playerId && !isVisible(u.x, u.y)) return
      minimapCtx.fillStyle = u.ownerId === gameState.playerId ? '#0f0' : '#f00'
      minimapCtx.fillRect(u.x * minimapScale - 1, u.y * minimapScale - 1, 3, 3)
    })

  }, [gameState, mousePos])

  // ===== INPUT HANDLERS =====
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!gameState) return
    const canvas = canvasRef.current
    if (!canvas) return
    
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const worldX = x + gameState.camera.x
    const worldY = y + gameState.camera.y
    
    if (e.button === 0) {
      if (gameState.placingBuilding) {
        const stats = BUILDING_STATS[gameState.placingBuilding]
        const size = gameState.placingBuilding === 'base' ? 96 : gameState.placingBuilding === 'tower' ? 48 : gameState.placingBuilding === 'wall' ? 40 : 80
        
        const startTileX = Math.floor((worldX - size/2) / TILE_SIZE)
        const startTileY = Math.floor((worldY - size/2) / TILE_SIZE)
        const endTileX = Math.ceil((worldX + size/2) / TILE_SIZE)
        const endTileY = Math.ceil((worldY + size/2) / TILE_SIZE)
        
        let canPlace = true
        for (let ty = startTileY; ty < endTileY && canPlace; ty++) {
          for (let tx = startTileX; tx < endTileX && canPlace; tx++) {
            const tile = gameState.tileMap[ty]?.[tx]
            if (!tile || !tile.passable) canPlace = false
          }
        }
        
        const wouldCollide = gameState.buildings.some(b =>
          worldX - size/2 < b.x + b.width &&
          worldX + size/2 > b.x &&
          worldY - size/2 < b.y + b.height &&
          worldY + size/2 > b.y
        )
        if (wouldCollide) canPlace = false
        
        if (canPlace && gameState.playerResources.gold >= stats.cost.gold && gameState.playerResources.wood >= stats.cost.wood) {
          const newBuilding = createBuilding(gameState.placingBuilding, worldX - size/2, worldY - size/2, 'player', gameState.playerId)
          
          setGameState(prev => {
            if (!prev) return prev
            return {
              ...prev,
              buildings: [...prev.buildings, newBuilding],
              playerResources: { ...prev.playerResources, gold: prev.playerResources.gold - stats.cost.gold, wood: prev.playerResources.wood - stats.cost.wood, maxSupply: prev.playerResources.maxSupply + stats.supply },
              placingBuilding: null
            }
          })
          addNotification(`Building ${gameState.placingBuilding}`, 'success')
        } else if (!canPlace) {
          addNotification('Cannot build here!', 'danger')
        }
      } else if (gameState.attackMoveMode) {
        setGameState(prev => {
          if (!prev) return prev
          return {
            ...prev, attackMoveMode: false,
            units: prev.units.map(unit => {
              if (unit.selected && unit.ownerId === prev.playerId) {
                if (shiftPressed && unit.targetX) {
                  return { ...unit, waypoints: [...unit.waypoints, { x: worldX, y: worldY, command: 'attackMove' as CommandType }] }
                }
                return { ...unit, targetX: worldX, targetY: worldY, command: 'attackMove' as CommandType, gatheringTarget: null, attackTarget: null, repairTarget: null, waypoints: [] }
              }
              return unit
            })
          }
        })
      } else if (gameState.attackGroundMode) {
        setGameState(prev => {
          if (!prev) return prev
          return {
            ...prev, attackGroundMode: false,
            units: prev.units.map(unit => {
              if (unit.selected && unit.ownerId === prev.playerId && unit.type === 'catapult') {
                return { ...unit, attackGroundX: worldX, attackGroundY: worldY, attackTarget: null }
              }
              return unit
            })
          }
        })
      } else if (gameState.patrolMode) {
        setGameState(prev => {
          if (!prev) return prev
          return {
            ...prev, patrolMode: false,
            units: prev.units.map(unit => {
              if (unit.selected && unit.ownerId === prev.playerId) {
                const currentPos = { x: unit.x, y: unit.y }
                return { ...unit, patrolPoints: [currentPos, { x: worldX, y: worldY }], patrolIndex: 0, targetX: worldX, targetY: worldY, command: 'patrol' as CommandType, gatheringTarget: null, attackTarget: null }
              }
              return unit
            })
          }
        })
      } else {
        setIsDragging(true)
        
        const clickedUnit = gameState.units.find(u => worldX >= u.x && worldX <= u.x + u.width && worldY >= u.y && worldY <= u.y + u.height)
        const clickedBuilding = gameState.buildings.find(b => worldX >= b.x && worldX <= b.x + b.width && worldY >= b.y && worldY <= b.y + b.height)
        
        if (clickedUnit || clickedBuilding) {
          const entity = clickedUnit || clickedBuilding
          if (entity && entity.ownerId === gameState.playerId) {
            if (ctrlPressed) {
              if (clickedUnit) setGameState(prev => {
                if (!prev) return prev
                return { ...prev, units: prev.units.map(u => u.id === clickedUnit.id ? { ...u, selected: !u.selected } : u) }
              })
              else if (clickedBuilding) setGameState(prev => {
                if (!prev) return prev
                return { ...prev, buildings: prev.buildings.map(b => b.id === clickedBuilding.id ? { ...b, selected: !b.selected } : b) }
              })
            } else {
              setGameState(prev => {
                if (!prev) return prev
                return {
                  ...prev,
                  units: prev.units.map(u => ({ ...u, selected: clickedUnit ? u.id === clickedUnit.id : false })),
                  buildings: prev.buildings.map(b => ({ ...b, selected: clickedBuilding ? b.id === clickedBuilding.id : false }))
                }
              })
            }
          } else if (entity && entity.ownerId !== gameState.playerId) {
            setGameState(prev => {
              if (!prev) return prev
              return {
                ...prev,
                units: prev.units.map(unit => {
                  if (unit.selected && unit.ownerId === prev.playerId) {
                    if (shiftPressed && unit.targetX) {
                      return { ...unit, waypoints: [...unit.waypoints, { x: worldX, y: worldY, command: 'attack' as CommandType, target: entity }] }
                    }
                    return { ...unit, attackTarget: entity, gatheringTarget: null, waypoints: [] }
                  }
                  return unit
                })
              }
            })
          }
        } else {
          if (!ctrlPressed) {
            setGameState(prev => {
              if (!prev) return prev
              return { ...prev, units: prev.units.map(u => ({ ...u, selected: false })), buildings: prev.buildings.map(b => ({ ...b, selected: false })) }
            })
          }
          setGameState(prev => {
            if (!prev) return prev
            return { ...prev, selectionBox: { startX: x, startY: y, endX: x, endY: y } }
          })
        }
      }
    } else if (e.button === 2) {
      e.preventDefault()
      
      if (gameState.attackMoveMode || gameState.patrolMode || gameState.placingBuilding || gameState.attackGroundMode) {
        setGameState(prev => {
          if (!prev) return prev
          return { ...prev, attackMoveMode: false, patrolMode: false, placingBuilding: null, attackGroundMode: false }
        })
        return
      }
      
      const clickedResource = gameState.resources.find(r => worldX >= r.x && worldX <= r.x + r.width && worldY >= r.y && worldY <= r.y + r.height)
      const clickedEnemy = gameState.units.find(u => u.ownerId !== gameState.playerId && worldX >= u.x && worldX <= u.x + u.width && worldY >= u.y && worldY <= u.y + u.height)
      const clickedEnemyBuilding = gameState.buildings.find(b => b.ownerId !== gameState.playerId && worldX >= b.x && worldX <= b.x + b.width && worldY >= b.y && worldY <= b.y + b.height)
      const clickedOwnBuilding = gameState.buildings.find(b => b.ownerId === gameState.playerId && worldX >= b.x && worldX <= b.x + b.width && worldY >= b.y && worldY <= b.y + b.height)
      
      setGameState(prev => {
        if (!prev) return prev
        return {
          ...prev,
          units: prev.units.map(unit => {
            if (unit.selected && unit.ownerId === prev.playerId) {
              if (unit.type === 'worker' && clickedResource) {
                if (shiftPressed && unit.targetX) {
                  return { ...unit, waypoints: [...unit.waypoints, { x: clickedResource.x + clickedResource.width / 2, y: clickedResource.y + clickedResource.height / 2, command: 'gather' as CommandType, target: clickedResource }] }
                }
                return { ...unit, targetX: clickedResource.x + clickedResource.width / 2, targetY: clickedResource.y + clickedResource.height / 2, gatheringTarget: clickedResource, returningToBase: false, command: 'gather', attackTarget: null, repairTarget: null, waypoints: [] }
              } else if (clickedEnemy || clickedEnemyBuilding) {
                if (shiftPressed && unit.targetX) {
                  return { ...unit, waypoints: [...unit.waypoints, { x: worldX, y: worldY, command: 'attack' as CommandType, target: (clickedEnemy || clickedEnemyBuilding) as Entity }] }
                }
                return { ...unit, attackTarget: clickedEnemy || clickedEnemyBuilding, gatheringTarget: null, command: 'attack', repairTarget: null, waypoints: [] }
              } else if (unit.type === 'worker' && clickedOwnBuilding && clickedOwnBuilding.hp < clickedOwnBuilding.maxHp) {
                return { ...unit, repairTarget: clickedOwnBuilding, gatheringTarget: null, command: 'repair', attackTarget: null }
              }
              if (shiftPressed && unit.targetX) {
                return { ...unit, waypoints: [...unit.waypoints, { x: worldX, y: worldY, command: 'move' as CommandType }] }
              }
              return { ...unit, targetX: worldX, targetY: worldY, gatheringTarget: null, command: 'move', attackTarget: null, repairTarget: null, waypoints: [] }
            }
            return unit
          }),
          buildings: prev.buildings.map(b => {
            if (b.selected && b.ownerId === prev.playerId && b.productionQueue.length > 0) return { ...b, rallyPoint: { x: worldX, y: worldY } }
            return b
          })
        }
      })
    }
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!gameState) return
    const canvas = canvasRef.current
    if (!canvas) return
    
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    setMousePos({ x, y })
    
    const scrollSpeed = 12
    let newCameraX = gameState.camera.x
    let newCameraY = gameState.camera.y
    
    if (x < 30) newCameraX -= scrollSpeed
    if (x > canvas.width - 30) newCameraX += scrollSpeed
    if (y < 30) newCameraY -= scrollSpeed
    if (y > canvas.height - 30) newCameraY += scrollSpeed
    
    newCameraX = clamp(newCameraX, 0, MAP_WIDTH - canvas.width)
    newCameraY = clamp(newCameraY, 0, MAP_HEIGHT - canvas.height)
    
    if (newCameraX !== gameState.camera.x || newCameraY !== gameState.camera.y) {
      setGameState(prev => {
        if (!prev) return prev
        return { ...prev, camera: { x: newCameraX, y: newCameraY } }
      })
    }
    
    if (isDragging && gameState.selectionBox) {
      setGameState(prev => {
        if (!prev) return prev
        return { ...prev, selectionBox: { ...prev.selectionBox!, endX: x, endY: y } }
      })
    }
  }

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!gameState) return
    if (e.button === 0) {
      setIsDragging(false)
      
      if (gameState.selectionBox) {
        const box = gameState.selectionBox
        const x1 = Math.min(box.startX, box.endX) + gameState.camera.x
        const y1 = Math.min(box.startY, box.endY) + gameState.camera.y
        const x2 = Math.max(box.startX, box.endX) + gameState.camera.x
        const y2 = Math.max(box.startY, box.endY) + gameState.camera.y
        
        const isClick = Math.abs(box.endX - box.startX) < 5 && Math.abs(box.endY - box.startY) < 5
        
        setGameState(prev => {
          if (!prev) return prev
          return {
            ...prev, selectionBox: null,
            units: prev.units.map(unit => {
              if (unit.ownerId !== prev.playerId) return unit
              if (isClick) return unit
              const inBox = unit.x >= x1 && unit.x + unit.width <= x2 && unit.y >= y1 && unit.y + unit.height <= y2
              return { ...unit, selected: ctrlPressed ? (unit.selected || inBox) : inBox }
            }),
            buildings: prev.buildings.map(b => {
              if (b.ownerId !== prev.playerId) return { ...b, selected: false }
              if (isClick) return b
              const inBox = b.x >= x1 && b.x + b.width <= x2 && b.y >= y1 && b.y + b.height <= y2
              return { ...b, selected: ctrlPressed ? (b.selected || inBox) : inBox }
            })
          }
        })
      }
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!gameState) return
    
    if (e.key === 'Control') { setCtrlPressed(true); return }
    if (e.key === 'Shift') { setShiftPressed(true); return }
    
    if (e.key >= '1' && e.key <= '9') {
      const groupNum = parseInt(e.key)
      if (ctrlPressed) {
        const unitIds = gameState.units.filter(u => u.selected && u.ownerId === gameState.playerId).map(u => u.id)
        const buildingIds = gameState.buildings.filter(b => b.selected && b.ownerId === gameState.playerId).map(b => b.id)
        setGameState(prev => {
          if (!prev) return prev
          return { ...prev, controlGroups: { ...prev.controlGroups, [groupNum]: { unitIds, buildingIds } } }
        })
        addNotification(`Group ${groupNum} saved`, 'info')
      } else {
        const group = gameState.controlGroups[groupNum]
        if (group) {
          setGameState(prev => {
            if (!prev) return prev
            return {
              ...prev,
              units: prev.units.map(u => ({ ...u, selected: group.unitIds.includes(u.id) })),
              buildings: prev.buildings.map(b => ({ ...b, selected: group.buildingIds.includes(b.id) }))
            }
          })
        }
      }
      return
    }
    
    if (e.key === 'a' || e.key === 'A') setGameState(prev => {
      if (!prev) return prev
      return { ...prev, attackMoveMode: true, patrolMode: false, placingBuilding: null, attackGroundMode: false }
    })
    if (e.key === 'p' || e.key === 'P') setGameState(prev => {
      if (!prev) return prev
      return { ...prev, patrolMode: true, attackMoveMode: false, placingBuilding: null, attackGroundMode: false }
    })
    if (e.key === 'g' || e.key === 'G') setGameState(prev => {
      if (!prev) return prev
      return { ...prev, attackGroundMode: true, attackMoveMode: false, patrolMode: false, placingBuilding: null }
    })
    
    if (e.key === 's' || e.key === 'S') {
      setGameState(prev => {
        if (!prev) return prev
        return {
          ...prev, units: prev.units.map(unit => {
            if (unit.selected && unit.ownerId === prev.playerId) return { ...unit, targetX: null, targetY: null, command: null, attackTarget: null, gatheringTarget: null, repairTarget: null, waypoints: [], attackGroundX: null, attackGroundY: null }
            return unit
          })
        }
      })
    }
    
    if (e.key === 'h' || e.key === 'H') {
      setGameState(prev => {
        if (!prev) return prev
        return {
          ...prev, units: prev.units.map(unit => {
            if (unit.selected && unit.ownerId === prev.playerId) return { ...unit, targetX: null, targetY: null, command: 'hold' as CommandType, gatheringTarget: null, repairTarget: null, waypoints: [] }
            return unit
          })
        }
      })
    }
    
    if (e.key === 'z' || e.key === 'Z') {
      if (ctrlPressed) {
        setGameState(prev => {
          if (!prev) return prev
          return {
            ...prev, units: prev.units.map(u => ({ ...u, selected: u.ownerId === prev.playerId && (u.type === 'soldier' || u.type === 'archer' || u.type === 'catapult') }))
          }
        })
      }
    }
    
    if (e.key === 'y' || e.key === 'Y') {
      const idleWorker = gameState.units.find(u => u.ownerId === gameState.playerId && u.type === 'worker' && !u.targetX && !u.gatheringTarget && !u.attackTarget && !u.repairTarget)
      if (idleWorker) {
        setGameState(prev => {
          if (!prev) return prev
          return {
            ...prev,
            camera: { x: clamp(idleWorker.x - CANVAS_WIDTH/2, 0, MAP_WIDTH - CANVAS_WIDTH), y: clamp(idleWorker.y - CANVAS_HEIGHT/2, 0, MAP_HEIGHT - CANVAS_HEIGHT) },
            units: prev.units.map(u => ({ ...u, selected: u.id === idleWorker.id })),
            buildings: prev.buildings.map(b => ({ ...b, selected: false }))
          }
        })
      }
    }
    
    const selectedBuilding = gameState.buildings.find(b => b.selected && b.ownerId === gameState.playerId)
    
    if (e.key === 'w' || e.key === 'W') {
      if (selectedBuilding?.type === 'base' && selectedBuilding.isComplete) {
        if (gameState.playerResources.gold >= 50 && gameState.playerResources.supply < gameState.playerResources.maxSupply) {
          setGameState(prev => {
            if (!prev) return prev
            return {
              ...prev, playerResources: { ...prev.playerResources, gold: prev.playerResources.gold - 50, supply: prev.playerResources.supply + 1 },
              buildings: prev.buildings.map(b => b.id === selectedBuilding.id ? { ...b, productionQueue: [...b.productionQueue, { type: 'worker', progress: 0, totalTime: 8 }] } : b)
            }
          })
        }
      }
    }
    
    if (e.key === 'e' || e.key === 'E') {
      if (selectedBuilding?.type === 'barracks' && selectedBuilding.isComplete) {
        if (gameState.playerResources.gold >= 80 && gameState.playerResources.wood >= 20 && gameState.playerResources.supply + 2 <= gameState.playerResources.maxSupply) {
          setGameState(prev => {
            if (!prev) return prev
            return {
              ...prev, playerResources: { ...prev.playerResources, gold: prev.playerResources.gold - 80, wood: prev.playerResources.wood - 20, supply: prev.playerResources.supply + 2 },
              buildings: prev.buildings.map(b => b.id === selectedBuilding.id ? { ...b, productionQueue: [...b.productionQueue, { type: 'soldier', progress: 0, totalTime: 12 }] } : b)
            }
          })
        }
      }
    }
    
    if (e.key === 'r' || e.key === 'R') {
      if (selectedBuilding?.type === 'barracks' && selectedBuilding.isComplete) {
        if (gameState.playerResources.gold >= 60 && gameState.playerResources.wood >= 40 && gameState.playerResources.supply + 2 <= gameState.playerResources.maxSupply) {
          setGameState(prev => {
            if (!prev) return prev
            return {
              ...prev, playerResources: { ...prev.playerResources, gold: prev.playerResources.gold - 60, wood: prev.playerResources.wood - 40, supply: prev.playerResources.supply + 2 },
              buildings: prev.buildings.map(b => b.id === selectedBuilding.id ? { ...b, productionQueue: [...b.productionQueue, { type: 'archer', progress: 0, totalTime: 10 }] } : b)
            }
          })
        }
      }
    }
    
    if (e.key === 'q' || e.key === 'Q') {
      if (selectedBuilding?.type === 'barracks' && selectedBuilding.isComplete) {
        if (gameState.playerResources.gold >= 80 && gameState.playerResources.wood >= 30 && gameState.playerResources.supply + 2 <= gameState.playerResources.maxSupply) {
          setGameState(prev => {
            if (!prev) return prev
            return {
              ...prev, playerResources: { ...prev.playerResources, gold: prev.playerResources.gold - 80, wood: prev.playerResources.wood - 30, supply: prev.playerResources.supply + 2 },
              buildings: prev.buildings.map(b => b.id === selectedBuilding.id ? { ...b, productionQueue: [...b.productionQueue, { type: 'healer', progress: 0, totalTime: 11 }] } : b)
            }
          })
        }
      }
    }
    
    if (e.key === 'c' || e.key === 'C') {
      if (selectedBuilding?.type === 'siegeWorkshop' && selectedBuilding.isComplete) {
        if (gameState.playerResources.gold >= 120 && gameState.playerResources.wood >= 80 && gameState.playerResources.supply + 3 <= gameState.playerResources.maxSupply) {
          setGameState(prev => {
            if (!prev) return prev
            return {
              ...prev, playerResources: { ...prev.playerResources, gold: prev.playerResources.gold - 120, wood: prev.playerResources.wood - 80, supply: prev.playerResources.supply + 3 },
              buildings: prev.buildings.map(b => b.id === selectedBuilding.id ? { ...b, productionQueue: [...b.productionQueue, { type: 'catapult', progress: 0, totalTime: 15 }] } : b)
            }
          })
        }
      }
    }
    
    if ((e.key === 'u' || e.key === 'U') && selectedBuilding?.type === 'blacksmith' && selectedBuilding.isComplete) {
      if (gameState.playerResources.gold >= 100 && gameState.upgrades.player.attack < 3) {
        setGameState(prev => {
          if (!prev) return prev
          return {
            ...prev, playerResources: { ...prev.playerResources, gold: prev.playerResources.gold - 100 },
            upgrades: { ...prev.upgrades, player: { ...prev.upgrades.player, attack: prev.upgrades.player.attack + 1 } }
          }
        })
        addNotification('Attack upgraded!', 'success')
      }
    }
    if ((e.key === 'i' || e.key === 'I') && selectedBuilding?.type === 'blacksmith' && selectedBuilding.isComplete) {
      if (gameState.playerResources.gold >= 100 && gameState.upgrades.player.defense < 3) {
        setGameState(prev => {
          if (!prev) return prev
          return {
            ...prev, playerResources: { ...prev.playerResources, gold: prev.playerResources.gold - 100 },
            upgrades: { ...prev.upgrades, player: { ...prev.upgrades.player, defense: prev.upgrades.player.defense + 1 } }
          }
        })
        addNotification('Defense upgraded!', 'success')
      }
    }
    if ((e.key === 'o' || e.key === 'O') && selectedBuilding?.type === 'blacksmith' && selectedBuilding.isComplete) {
      if (gameState.playerResources.gold >= 100 && gameState.upgrades.player.range < 2) {
        setGameState(prev => {
          if (!prev) return prev
          return {
            ...prev, playerResources: { ...prev.playerResources, gold: prev.playerResources.gold - 100 },
            upgrades: { ...prev.upgrades, player: { ...prev.upgrades.player, range: prev.upgrades.player.range + 1 } }
          }
        })
        addNotification('Range upgraded!', 'success')
      }
    }
    
    // Buildings
    if (e.key === 'b' || e.key === 'B') setGameState(prev => {
      if (!prev) return prev
      return { ...prev, placingBuilding: 'barracks', attackMoveMode: false, patrolMode: false, attackGroundMode: false }
    })
    if (e.key === 'f' || e.key === 'F') setGameState(prev => {
      if (!prev) return prev
      return { ...prev, placingBuilding: 'farm', attackMoveMode: false, patrolMode: false, attackGroundMode: false }
    })
    if (e.key === 't' || e.key === 'T') setGameState(prev => {
      if (!prev) return prev
      return { ...prev, placingBuilding: 'tower', attackMoveMode: false, patrolMode: false, attackGroundMode: false }
    })
    if (e.key === 'n' || e.key === 'N') setGameState(prev => {
      if (!prev) return prev
      return { ...prev, placingBuilding: 'blacksmith', attackMoveMode: false, patrolMode: false, attackGroundMode: false }
    })
    if (e.key === 'v' || e.key === 'V') setGameState(prev => {
      if (!prev) return prev
      return { ...prev, placingBuilding: 'siegeWorkshop', attackMoveMode: false, patrolMode: false, attackGroundMode: false }
    })
    if (e.key === 'x' || e.key === 'X') setGameState(prev => {
      if (!prev) return prev
      return { ...prev, placingBuilding: 'wall', attackMoveMode: false, patrolMode: false, attackGroundMode: false }
    })
    
    if (e.key === '-' || e.key === '_') setGameState(prev => {
      if (!prev) return prev
      return { ...prev, gameSpeed: Math.max(0.5, prev.gameSpeed - 0.25) }
    })
    if (e.key === '=' || e.key === '+') setGameState(prev => {
      if (!prev) return prev
      return { ...prev, gameSpeed: Math.min(3, prev.gameSpeed + 0.25) }
    })
    
    if (e.key === 'm' || e.key === 'M') setGameState(prev => {
      if (!prev) return prev
      // Don't allow toggling fog of war in multiplayer
      if (prev.isMultiplayer) return prev
      return { ...prev, fogOfWar: !prev.fogOfWar }
    })
    
    if (e.key === 'Escape') {
      setGameState(prev => {
        if (!prev) return prev
        return {
          ...prev, placingBuilding: null, attackMoveMode: false, patrolMode: false, attackGroundMode: false,
          units: prev.units.map(u => ({ ...u, selected: false })),
          buildings: prev.buildings.map(b => ({ ...b, selected: false }))
        }
      })
    }
    
    const scrollSpeed = 25
    let newCameraX = gameState.camera.x
    let newCameraY = gameState.camera.y
    
    if (e.key === 'ArrowLeft') newCameraX -= scrollSpeed
    if (e.key === 'ArrowRight') newCameraX += scrollSpeed
    if (e.key === 'ArrowUp') newCameraY -= scrollSpeed
    if (e.key === 'ArrowDown') newCameraY += scrollSpeed
    
    newCameraX = clamp(newCameraX, 0, MAP_WIDTH - CANVAS_WIDTH)
    newCameraY = clamp(newCameraY, 0, MAP_HEIGHT - CANVAS_HEIGHT)
    
    if (newCameraX !== gameState.camera.x || newCameraY !== gameState.camera.y) {
      setGameState(prev => {
        if (!prev) return prev
        return { ...prev, camera: { x: newCameraX, y: newCameraY } }
      })
    }
  }

  const handleKeyUp = (e: React.KeyboardEvent) => {
    if (e.key === 'Control') setCtrlPressed(false)
    if (e.key === 'Shift') setShiftPressed(false)
  }

  const handleMinimapClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!gameState) return
    const minimap = minimapRef.current
    if (!minimap) return
    
    const rect = minimap.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    
    const minimapScale = MINIMAP_SIZE / MAP_WIDTH
    const worldX = x / minimapScale
    const worldY = y / minimapScale
    
    setGameState(prev => {
      if (!prev) return prev
      return {
        ...prev,
        camera: { x: clamp(worldX - CANVAS_WIDTH / 2, 0, MAP_WIDTH - CANVAS_WIDTH), y: clamp(worldY - CANVAS_HEIGHT / 2, 0, MAP_HEIGHT - CANVAS_HEIGHT) }
      }
    })
  }

  const restartGame = () => {
    const seed = Math.floor(Math.random() * 1000000)
    const newTileMap = generateMapWFC(MAP_TILES_X, MAP_TILES_Y, seed)
    const newState = generateGameFromMap(newTileMap, seed, playerId, playerName)
    const stateWithEnemy = addEnemyEntities(newState, gameState?.difficulty || 'normal', 'ai')
    stateWithEnemy.gameStarted = true
    stateWithEnemy.difficulty = gameState?.difficulty || 'normal'
    setGameState(stateWithEnemy)
  }

  const backToMenu = () => {
    setGameState(null)
    setScreen('menu')
  }

  // Lobby Screen - fetch rooms periodically
  useEffect(() => {
    if (screen !== 'lobby') return
    fetchRooms()
    const interval = setInterval(fetchRooms, 3000)
    return () => clearInterval(interval)
  }, [screen, fetchRooms])

  // ===== SCREENS =====
  
  // Main Menu
  if (screen === 'menu') {
    return (
      <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: '#1a1a2e', fontFamily: 'Arial, sans-serif' }}>
        <h1 style={{ color: '#4ade80', fontSize: '48px', marginBottom: '10px', textShadow: '0 0 20px rgba(74, 222, 128, 0.5)' }}>⚔️ RTS Commander</h1>
        <h2 style={{ color: '#888', fontSize: '18px', marginBottom: '40px' }}>Multiplayer Edition</h2>
        
        <div style={{ marginBottom: '30px' }}>
          <label style={{ color: '#fff', marginRight: '10px' }}>Your Name:</label>
          <input 
            value={playerName} 
            onChange={(e) => setPlayerName(e.target.value)}
            style={{ padding: '8px 15px', fontSize: '16px', borderRadius: '5px', border: '2px solid #0f3460', backgroundColor: '#16213e', color: '#fff' }}
          />
        </div>
        
        <div style={{ display: 'flex', gap: '20px', marginBottom: '30px' }}>
          <button onClick={() => setScreen('lobby')} style={{ padding: '20px 40px', fontSize: '18px', backgroundColor: '#3b82f6', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>
            🌐 Multiplayer
            <div style={{ fontSize: '12px', fontWeight: 'normal', marginTop: '5px' }}>Create or join rooms</div>
          </button>
        </div>
        
        <div style={{ color: '#666', marginBottom: '20px' }}>— OR —</div>
        
        <div style={{ display: 'flex', gap: '20px' }}>
          <button onClick={() => startSinglePlayer('easy')} style={{ padding: '20px 40px', fontSize: '18px', backgroundColor: '#22c55e', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>
            Easy
            <div style={{ fontSize: '12px', fontWeight: 'normal', marginTop: '5px' }}>Slower enemy</div>
          </button>
          <button onClick={() => startSinglePlayer('normal')} style={{ padding: '20px 40px', fontSize: '18px', backgroundColor: '#f59e0b', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>
            Normal
            <div style={{ fontSize: '12px', fontWeight: 'normal', marginTop: '5px' }}>Balanced</div>
          </button>
          <button onClick={() => startSinglePlayer('hard')} style={{ padding: '20px 40px', fontSize: '18px', backgroundColor: '#ef4444', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>
            Hard
            <div style={{ fontSize: '12px', fontWeight: 'normal', marginTop: '5px' }}>Fast enemy</div>
          </button>
        </div>
        
        <div style={{ marginTop: '40px', color: '#666', fontSize: '14px', textAlign: 'center' }}>
          <div>Build your base, train your army, and destroy the enemy!</div>
        </div>
      </div>
    )
  }
  
  // Lobby Screen
  if (screen === 'lobby') {
    return (
      <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: '#1a1a2e', fontFamily: 'Arial, sans-serif' }}>
        <div style={{ padding: '20px', backgroundColor: '#16213e', borderBottom: '2px solid #0f3460' }}>
          <button onClick={() => setScreen('menu')} style={{ padding: '10px 20px', backgroundColor: '#ef4444', color: '#fff', border: 'none', borderRadius: '5px', cursor: 'pointer' }}>
            ← Back to Menu
          </button>
          <span style={{ color: '#fff', fontSize: '24px', marginLeft: '20px' }}>Game Lobby</span>
          <span style={{ color: '#888', marginLeft: '10px' }}>Player: {playerName}</span>
        </div>
        
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* Room List */}
          <div style={{ flex: 1, padding: '20px', overflowY: 'auto' }}>
            <h2 style={{ color: '#fff', marginBottom: '15px' }}>Available Rooms</h2>
            {rooms.length === 0 ? (
              <div style={{ color: '#666' }}>No rooms available. Create one!</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {rooms.map(room => (
                  <div key={room.id} style={{ backgroundColor: '#16213e', padding: '15px', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ color: '#fff', fontSize: '16px', fontWeight: 'bold' }}>{room.name}</div>
                      <div style={{ color: '#888', fontSize: '12px' }}>
                        Host: {room.players[0]?.name} | Players: {room.players.length}/{room.maxPlayers} | Difficulty: {room.difficulty}
                      </div>
                    </div>
                    <button onClick={() => handleJoinRoom(room.id)} style={{ padding: '8px 20px', backgroundColor: '#22c55e', color: '#fff', border: 'none', borderRadius: '5px', cursor: 'pointer' }}>
                      Join
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          
          {/* Create Room */}
          <div style={{ width: '300px', padding: '20px', backgroundColor: '#16213e', borderLeft: '2px solid #0f3460' }}>
            <h2 style={{ color: '#fff', marginBottom: '15px' }}>Create Room</h2>
            <div style={{ marginBottom: '15px' }}>
              <label style={{ color: '#888', display: 'block', marginBottom: '5px' }}>Room Name</label>
              <input 
                value={roomName} 
                onChange={(e) => setRoomName(e.target.value)}
                style={{ width: '100%', padding: '10px', backgroundColor: '#0f3460', border: '1px solid #333', borderRadius: '5px', color: '#fff' }}
              />
            </div>
            <div style={{ marginBottom: '15px' }}>
              <label style={{ color: '#888', display: 'block', marginBottom: '5px' }}>Difficulty</label>
              <select 
                value={selectedDifficulty} 
                onChange={(e) => setSelectedDifficulty(e.target.value as any)}
                style={{ width: '100%', padding: '10px', backgroundColor: '#0f3460', border: '1px solid #333', borderRadius: '5px', color: '#fff' }}
              >
                <option value="easy">Easy</option>
                <option value="normal">Normal</option>
                <option value="hard">Hard</option>
              </select>
            </div>
            <button onClick={handleCreateRoom} style={{ width: '100%', padding: '12px', backgroundColor: '#3b82f6', color: '#fff', border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold' }}>
              Create Room
            </button>
          </div>
        </div>
        
        {/* Current Room Panel */}
        {currentRoom && (
          <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', backgroundColor: '#16213e', padding: '30px', borderRadius: '10px', border: '2px solid #0f3460', minWidth: '400px' }}>
            <h2 style={{ color: '#fff', marginBottom: '20px' }}>{currentRoom.name}</h2>
            <div style={{ marginBottom: '20px' }}>
              <div style={{ color: '#888', marginBottom: '10px' }}>Players:</div>
              {currentRoom.players.map((p: any) => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                  <div style={{ width: '15px', height: '15px', backgroundColor: p.color, borderRadius: '50%' }}></div>
                  <span style={{ color: '#fff' }}>{p.name}</span>
                  {p.id === currentRoom.host && <span style={{ color: '#fbbf24', fontSize: '12px' }}>(Host)</span>}
                  <span style={{ color: p.ready ? '#22c55e' : '#ef4444', fontSize: '12px' }}>
                    {p.ready ? '✓ Ready' : '○ Not Ready'}
                  </span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              {currentRoom.host === playerId && (
                <button 
                  onClick={handleStartGame} 
                  disabled={!currentRoom.players.every((p: any) => p.ready)}
                  style={{ 
                    flex: 1, padding: '12px', backgroundColor: currentRoom.players.every((p: any) => p.ready) ? '#22c55e' : '#666', 
                    color: '#fff', border: 'none', borderRadius: '5px', cursor: currentRoom.players.every((p: any) => p.ready) ? 'pointer' : 'not-allowed', fontWeight: 'bold' 
                  }}
                >
                  Start Game
                </button>
              )}
              <button onClick={handleToggleReady} style={{ flex: 1, padding: '12px', backgroundColor: '#3b82f6', color: '#fff', border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold' }}>
                {currentRoom.players.find((p: any) => p.id === playerId)?.ready ? 'Not Ready' : 'Ready'}
              </button>
              <button onClick={handleLeaveRoom} style={{ flex: 1, padding: '12px', backgroundColor: '#ef4444', color: '#fff', border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold' }}>
                Leave
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }
  
  // Game Screen
  if (!gameState) return null

  const selectedUnits = gameState.units.filter(u => u.selected && u.ownerId === gameState.playerId)
  const selectedBuildings = gameState.buildings.filter(b => b.selected && b.ownerId === gameState.playerId)
  
  const selectedUnitCounts = {
    worker: selectedUnits.filter(u => u.type === 'worker').length,
    soldier: selectedUnits.filter(u => u.type === 'soldier').length,
    archer: selectedUnits.filter(u => u.type === 'archer').length,
    healer: selectedUnits.filter(u => u.type === 'healer').length,
    catapult: selectedUnits.filter(u => u.type === 'catapult').length,
  }
  
  const idleWorkers = gameState.units.filter(u => u.ownerId === gameState.playerId && u.type === 'worker' && !u.targetX && !u.gatheringTarget && !u.attackTarget && !u.repairTarget)

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: '#1a1a2e', fontFamily: 'Arial, sans-serif' }}
      onKeyDown={handleKeyDown} onKeyUp={handleKeyUp} tabIndex={0}>
      
      {/* Top UI Bar */}
      <div style={{ height: '55px', backgroundColor: '#16213e', display: 'flex', alignItems: 'center', padding: '0 15px', gap: '20px', borderBottom: '2px solid #0f3460' }}>
        <button onClick={backToMenu} style={{ padding: '5px 15px', backgroundColor: '#ef4444', color: '#fff', border: 'none', borderRadius: '3px', cursor: 'pointer', fontSize: '12px' }}>
          Menu
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span style={{ color: '#FFD700', fontSize: '16px' }}>💰</span>
          <span style={{ color: '#fff', fontSize: '15px', fontWeight: 'bold' }}>{Math.floor(gameState.playerResources.gold)}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span style={{ color: '#8B4513', fontSize: '16px' }}>🪵</span>
          <span style={{ color: '#fff', fontSize: '15px', fontWeight: 'bold' }}>{Math.floor(gameState.playerResources.wood)}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span style={{ color: '#4ade80', fontSize: '16px' }}>👥</span>
          <span style={{ color: '#fff', fontSize: '15px', fontWeight: 'bold' }}>{gameState.playerResources.supply}/{gameState.playerResources.maxSupply}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', borderLeft: '1px solid #333', paddingLeft: '15px' }}>
          <span style={{ color: '#f87171', fontSize: '12px' }}>⚔{gameState.upgrades.player.attack}</span>
          <span style={{ color: '#60a5fa', fontSize: '12px' }}>🛡{gameState.upgrades.player.defense}</span>
          <span style={{ color: '#fbbf24', fontSize: '12px' }}>🏹{gameState.upgrades.player.range}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span style={{ color: '#888', fontSize: '12px' }}>Speed:</span>
          <span style={{ color: '#fff', fontSize: '14px' }}>{gameState.gameSpeed}x</span>
        </div>
        {gameState.isMultiplayer && (
          <div style={{ color: '#3b82f6', fontSize: '12px', fontWeight: 'bold' }}>
            🌐 MULTIPLAYER
          </div>
        )}
        <div style={{ color: '#888', fontSize: '12px' }}>
          {gameState.isMultiplayer ? `Room: ${gameState.roomId?.substring(0, 8)}...` : `Difficulty: ${gameState.difficulty.toUpperCase()}`}
        </div>
        
        {idleWorkers.length > 0 && (
          <button onClick={() => {
            const idle = idleWorkers[0]
            setGameState(prev => {
              if (!prev) return prev
              return {
                ...prev,
                camera: { x: clamp(idle.x - CANVAS_WIDTH/2, 0, MAP_WIDTH - CANVAS_WIDTH), y: clamp(idle.y - CANVAS_HEIGHT/2, 0, MAP_HEIGHT - CANVAS_HEIGHT) },
                units: prev.units.map(u => ({ ...u, selected: u.id === idle.id })),
                buildings: prev.buildings.map(b => ({ ...b, selected: false }))
              }
            })
          }} style={{ padding: '5px 10px', backgroundColor: '#fbbf24', color: '#000', border: 'none', borderRadius: '3px', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold' }}>
            Idle: {idleWorkers.length} [Y]
          </button>
        )}
        
        <div style={{ position: 'absolute', top: '60px', right: '220px', display: 'flex', flexDirection: 'column', gap: '4px', zIndex: 10 }}>
          {gameState.notifications.map(n => (
            <div key={n.id} style={{ padding: '6px 10px', backgroundColor: n.type === 'success' ? '#22c55e' : n.type === 'warning' ? '#eab308' : n.type === 'danger' ? '#ef4444' : '#3b82f6', color: '#fff', borderRadius: '3px', fontSize: '11px', fontWeight: 'bold' }}>
              {n.message}
            </div>
          ))}
        </div>
      </div>

      {/* Main Game Area */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <canvas ref={canvasRef} width={CANVAS_WIDTH} height={CANVAS_HEIGHT} style={{ display: 'block', cursor: gameState.attackMoveMode ? 'crosshair' : gameState.placingBuilding ? 'cell' : 'default' }}
            onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onContextMenu={(e) => e.preventDefault()} />
          
          {/* Minimap */}
          <div style={{ position: 'absolute', bottom: '10px', right: '10px', border: '2px solid #0f3460', backgroundColor: '#000' }}>
            <canvas ref={minimapRef} width={MINIMAP_SIZE} height={MINIMAP_SIZE} onClick={handleMinimapClick} onContextMenu={handleMinimapClick} style={{ cursor: 'pointer' }} />
          </div>
          
          {/* Mode indicators */}
          {gameState.attackMoveMode && <div style={{ position: 'absolute', top: '10px', left: '10px', backgroundColor: '#ff0000', color: '#fff', padding: '5px 10px', borderRadius: '3px', fontSize: '12px' }}>Attack Move - Click target</div>}
          {gameState.attackGroundMode && <div style={{ position: 'absolute', top: '10px', left: '10px', backgroundColor: '#8B4513', color: '#fff', padding: '5px 10px', borderRadius: '3px', fontSize: '12px' }}>Attack Ground - Click target (Catapults)</div>}
          {gameState.patrolMode && <div style={{ position: 'absolute', top: '10px', left: '10px', backgroundColor: '#22c55e', color: '#fff', padding: '5px 10px', borderRadius: '3px', fontSize: '12px' }}>Patrol - Click patrol point</div>}
          {gameState.fogOfWar && <div style={{ position: 'absolute', top: '10px', left: '10px', backgroundColor: '#333', color: '#fff', padding: '3px 8px', borderRadius: '3px', fontSize: '11px' }}>Fog of War ON [M to toggle]</div>}
          
          {/* Game Over Overlay */}
          {gameState.gameOver && (
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.8)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <h1 style={{ color: gameState.winner === 'player' ? '#22c55e' : '#ef4444', fontSize: '48px', marginBottom: '20px' }}>
                {gameState.winner === 'player' ? '🎉 VICTORY!' : '💀 DEFEAT!'}
              </h1>
              <button onClick={restartGame} style={{ padding: '15px 40px', fontSize: '18px', backgroundColor: '#3b82f6', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', marginBottom: '10px' }}>
                Play Again
              </button>
              <button onClick={backToMenu} style={{ padding: '15px 40px', fontSize: '18px', backgroundColor: '#666', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>
                Main Menu
              </button>
            </div>
          )}
        </div>

        {/* Side Panel */}
        <div style={{ width: '210px', backgroundColor: '#16213e', padding: '10px', display: 'flex', flexDirection: 'column', gap: '8px', borderLeft: '2px solid #0f3460', overflowY: 'auto' }}>
          {/* Selection Info */}
          <div style={{ backgroundColor: '#0f3460', padding: '8px', borderRadius: '5px' }}>
            <h3 style={{ color: '#fff', margin: '0 0 6px 0', fontSize: '12px' }}>Selection ({selectedUnits.length + selectedBuildings.length})</h3>
            {selectedUnits.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                {selectedUnitCounts.worker > 0 && <span style={{ color: '#4ade80', fontSize: '10px' }}>W:{selectedUnitCounts.worker}</span>}
                {selectedUnitCounts.soldier > 0 && <span style={{ color: '#f87171', fontSize: '10px' }}>S:{selectedUnitCounts.soldier}</span>}
                {selectedUnitCounts.archer > 0 && <span style={{ color: '#06b6d4', fontSize: '10px' }}>A:{selectedUnitCounts.archer}</span>}
                {selectedUnitCounts.healer > 0 && <span style={{ color: '#22c55e', fontSize: '10px' }}>H:{selectedUnitCounts.healer}</span>}
                {selectedUnitCounts.catapult > 0 && <span style={{ color: '#8B4513', fontSize: '10px' }}>C:{selectedUnitCounts.catapult}</span>}
              </div>
            )}
            {selectedBuildings.length > 0 && <div style={{ color: '#60a5fa', fontSize: '11px' }}>{selectedBuildings.map(b => b.type).join(', ')}</div>}
            {selectedUnits.length === 0 && selectedBuildings.length === 0 && <div style={{ color: '#666', fontSize: '11px' }}>Nothing selected</div>}
          </div>

          {/* Production */}
          {selectedBuildings.length > 0 && (
            <div style={{ backgroundColor: '#0f3460', padding: '8px', borderRadius: '5px' }}>
              <h3 style={{ color: '#fff', margin: '0 0 6px 0', fontSize: '12px' }}>Production</h3>
              
              {selectedBuildings.some(b => b.type === 'base' && b.isComplete) && (
                <button onClick={() => {
                  const selectedBase = selectedBuildings.find(b => b.type === 'base')
                  if (selectedBase && gameState.playerResources.gold >= 50 && gameState.playerResources.supply < gameState.playerResources.maxSupply) {
                    setGameState(prev => {
                      if (!prev) return prev
                      return {
                        ...prev, playerResources: { ...prev.playerResources, gold: prev.playerResources.gold - 50, supply: prev.playerResources.supply + 1 },
                        buildings: prev.buildings.map(b => b.id === selectedBase.id ? { ...b, productionQueue: [...b.productionQueue, { type: 'worker', progress: 0, totalTime: 8 }] } : b)
                      }
                    })
                  }
                }} style={{ width: '100%', padding: '6px', marginBottom: '4px', backgroundColor: '#4ade80', color: '#000', border: 'none', borderRadius: '3px', cursor: 'pointer', fontSize: '11px' }}>
                  Worker [W] - 50g
                </button>
              )}
              
              {selectedBuildings.some(b => b.type === 'barracks' && b.isComplete) && (
                <>
                  <button onClick={() => {
                    const selectedBarracks = selectedBuildings.find(b => b.type === 'barracks')
                    if (selectedBarracks && gameState.playerResources.gold >= 80 && gameState.playerResources.wood >= 20 && gameState.playerResources.supply + 2 <= gameState.playerResources.maxSupply) {
                      setGameState(prev => {
                        if (!prev) return prev
                        return {
                          ...prev, playerResources: { ...prev.playerResources, gold: prev.playerResources.gold - 80, wood: prev.playerResources.wood - 20, supply: prev.playerResources.supply + 2 },
                          buildings: prev.buildings.map(b => b.id === selectedBarracks.id ? { ...b, productionQueue: [...b.productionQueue, { type: 'soldier', progress: 0, totalTime: 12 }] } : b)
                        }
                      })
                    }
                  }} style={{ width: '100%', padding: '6px', marginBottom: '4px', backgroundColor: '#f87171', color: '#fff', border: 'none', borderRadius: '3px', cursor: 'pointer', fontSize: '11px' }}>
                    Soldier [E] - 80g 20w
                  </button>
                  <button onClick={() => {
                    const selectedBarracks = selectedBuildings.find(b => b.type === 'barracks')
                    if (selectedBarracks && gameState.playerResources.gold >= 60 && gameState.playerResources.wood >= 40 && gameState.playerResources.supply + 2 <= gameState.playerResources.maxSupply) {
                      setGameState(prev => {
                        if (!prev) return prev
                        return {
                          ...prev, playerResources: { ...prev.playerResources, gold: prev.playerResources.gold - 60, wood: prev.playerResources.wood - 40, supply: prev.playerResources.supply + 2 },
                          buildings: prev.buildings.map(b => b.id === selectedBarracks.id ? { ...b, productionQueue: [...b.productionQueue, { type: 'archer', progress: 0, totalTime: 10 }] } : b)
                        }
                      })
                    }
                  }} style={{ width: '100%', padding: '6px', marginBottom: '4px', backgroundColor: '#06b6d4', color: '#fff', border: 'none', borderRadius: '3px', cursor: 'pointer', fontSize: '11px' }}>
                    Archer [R] - 60g 40w
                  </button>
                  <button onClick={() => {
                    const selectedBarracks = selectedBuildings.find(b => b.type === 'barracks')
                    if (selectedBarracks && gameState.playerResources.gold >= 80 && gameState.playerResources.wood >= 30 && gameState.playerResources.supply + 2 <= gameState.playerResources.maxSupply) {
                      setGameState(prev => {
                        if (!prev) return prev
                        return {
                          ...prev, playerResources: { ...prev.playerResources, gold: prev.playerResources.gold - 80, wood: prev.playerResources.wood - 30, supply: prev.playerResources.supply + 2 },
                          buildings: prev.buildings.map(b => b.id === selectedBarracks.id ? { ...b, productionQueue: [...b.productionQueue, { type: 'healer', progress: 0, totalTime: 11 }] } : b)
                        }
                      })
                    }
                  }} style={{ width: '100%', padding: '6px', marginBottom: '4px', backgroundColor: '#22c55e', color: '#fff', border: 'none', borderRadius: '3px', cursor: 'pointer', fontSize: '11px' }}>
                    Healer [Q] - 80g 30w
                  </button>
                </>
              )}
              
              {selectedBuildings.some(b => b.type === 'siegeWorkshop' && b.isComplete) && (
                <button onClick={() => {
                  const selectedSiege = selectedBuildings.find(b => b.type === 'siegeWorkshop')
                  if (selectedSiege && gameState.playerResources.gold >= 120 && gameState.playerResources.wood >= 80 && gameState.playerResources.supply + 3 <= gameState.playerResources.maxSupply) {
                    setGameState(prev => {
                      if (!prev) return prev
                      return {
                        ...prev, playerResources: { ...prev.playerResources, gold: prev.playerResources.gold - 120, wood: prev.playerResources.wood - 80, supply: prev.playerResources.supply + 3 },
                        buildings: prev.buildings.map(b => b.id === selectedSiege.id ? { ...b, productionQueue: [...b.productionQueue, { type: 'catapult', progress: 0, totalTime: 15 }] } : b)
                      }
                    })
                  }
                }} style={{ width: '100%', padding: '6px', marginBottom: '4px', backgroundColor: '#8B4513', color: '#fff', border: 'none', borderRadius: '3px', cursor: 'pointer', fontSize: '11px' }}>
                  Catapult [C] - 120g 80w
                </button>
              )}
              
              {selectedBuildings.some(b => b.type === 'blacksmith' && b.isComplete) && (
                <>
                  <button onClick={() => {
                    if (gameState.playerResources.gold >= 100 && gameState.upgrades.player.attack < 3) {
                      setGameState(prev => {
                        if (!prev) return prev
                        return {
                          ...prev, playerResources: { ...prev.playerResources, gold: prev.playerResources.gold - 100 },
                          upgrades: { ...prev.upgrades, player: { ...prev.upgrades.player, attack: prev.upgrades.player.attack + 1 } }
                        }
                      })
                      addNotification('Attack upgraded!', 'success')
                    }
                  }} style={{ width: '100%', padding: '6px', marginBottom: '4px', backgroundColor: '#f87171', color: '#fff', border: 'none', borderRadius: '3px', cursor: 'pointer', fontSize: '11px' }}>
                    ⚔ Attack [U] - 100g
                  </button>
                  <button onClick={() => {
                    if (gameState.playerResources.gold >= 100 && gameState.upgrades.player.defense < 3) {
                      setGameState(prev => {
                        if (!prev) return prev
                        return {
                          ...prev, playerResources: { ...prev.playerResources, gold: prev.playerResources.gold - 100 },
                          upgrades: { ...prev.upgrades, player: { ...prev.upgrades.player, defense: prev.upgrades.player.defense + 1 } }
                        }
                      })
                      addNotification('Defense upgraded!', 'success')
                    }
                  }} style={{ width: '100%', padding: '6px', marginBottom: '4px', backgroundColor: '#60a5fa', color: '#fff', border: 'none', borderRadius: '3px', cursor: 'pointer', fontSize: '11px' }}>
                    🛡 Defense [I] - 100g
                  </button>
                  <button onClick={() => {
                    if (gameState.playerResources.gold >= 100 && gameState.upgrades.player.range < 2) {
                      setGameState(prev => {
                        if (!prev) return prev
                        return {
                          ...prev, playerResources: { ...prev.playerResources, gold: prev.playerResources.gold - 100 },
                          upgrades: { ...prev.upgrades, player: { ...prev.upgrades.player, range: prev.upgrades.player.range + 1 } }
                        }
                      })
                      addNotification('Range upgraded!', 'success')
                    }
                  }} style={{ width: '100%', padding: '6px', marginBottom: '4px', backgroundColor: '#fbbf24', color: '#000', border: 'none', borderRadius: '3px', cursor: 'pointer', fontSize: '11px' }}>
                    🏹 Range [O] - 100g
                  </button>
                </>
              )}
              
              {/* Production Queue */}
              {selectedBuildings.some(b => b.productionQueue.length > 0) && (
                <div style={{ marginTop: '8px' }}>
                  <div style={{ color: '#888', fontSize: '10px', marginBottom: '4px' }}>Queue:</div>
                  {selectedBuildings.filter(b => b.productionQueue.length > 0).map(building => (
                    building.productionQueue.map((item, idx) => (
                      <div key={idx} style={{ color: '#fff', fontSize: '10px', padding: '2px 5px', backgroundColor: '#333', marginBottom: '2px', borderRadius: '2px' }}>
                        {item.type} - {Math.floor(item.progress / item.totalTime * 100)}%
                      </div>
                    ))
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Building Menu */}
          <div style={{ backgroundColor: '#0f3460', padding: '8px', borderRadius: '5px' }}>
            <h3 style={{ color: '#fff', margin: '0 0 6px 0', fontSize: '12px' }}>Buildings</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
              <button onClick={() => setGameState(prev => prev ? { ...prev, placingBuilding: 'barracks' } : prev)} style={{ padding: '8px 4px', backgroundColor: '#333', color: '#fff', border: 'none', borderRadius: '3px', cursor: 'pointer', fontSize: '10px' }}>
                Barracks [B]<br/>120g 60w
              </button>
              <button onClick={() => setGameState(prev => prev ? { ...prev, placingBuilding: 'farm' } : prev)} style={{ padding: '8px 4px', backgroundColor: '#333', color: '#fff', border: 'none', borderRadius: '3px', cursor: 'pointer', fontSize: '10px' }}>
                Farm [F]<br/>60g 80w
              </button>
              <button onClick={() => setGameState(prev => prev ? { ...prev, placingBuilding: 'tower' } : prev)} style={{ padding: '8px 4px', backgroundColor: '#333', color: '#fff', border: 'none', borderRadius: '3px', cursor: 'pointer', fontSize: '10px' }}>
                Tower [T]<br/>100g 50w
              </button>
              <button onClick={() => setGameState(prev => prev ? { ...prev, placingBuilding: 'blacksmith' } : prev)} style={{ padding: '8px 4px', backgroundColor: '#333', color: '#fff', border: 'none', borderRadius: '3px', cursor: 'pointer', fontSize: '10px' }}>
                Smith [N]<br/>150g 100w
              </button>
              <button onClick={() => setGameState(prev => prev ? { ...prev, placingBuilding: 'siegeWorkshop' } : prev)} style={{ padding: '8px 4px', backgroundColor: '#333', color: '#fff', border: 'none', borderRadius: '3px', cursor: 'pointer', fontSize: '10px' }}>
                Siege [V]<br/>180g 120w
              </button>
              <button onClick={() => setGameState(prev => prev ? { ...prev, placingBuilding: 'wall' } : prev)} style={{ padding: '8px 4px', backgroundColor: '#333', color: '#fff', border: 'none', borderRadius: '3px', cursor: 'pointer', fontSize: '10px' }}>
                Wall [X]<br/>20g 10w
              </button>
            </div>
          </div>

          {/* Controls */}
          <div style={{ backgroundColor: '#0f3460', padding: '8px', borderRadius: '5px' }}>
            <h3 style={{ color: '#fff', margin: '0 0 6px 0', fontSize: '12px' }}>Controls</h3>
            <div style={{ color: '#888', fontSize: '9px', lineHeight: '1.5' }}>
              <div>Left Click: Select</div>
              <div>Right Click: Move/Attack</div>
              <div>Drag: Box Select</div>
              <div>A: Attack Move</div>
              <div>P: Patrol</div>
              <div>G: Attack Ground</div>
              <div>S: Stop | H: Hold</div>
              <div>Ctrl+1-9: Save Group</div>
              <div>1-9: Load Group</div>
              <div>Y: Find Idle Worker</div>
              <div>Ctrl+Z: Select Army</div>
              <div>M: Toggle Fog</div>
              <div>+/-: Game Speed</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
