// Room Manager - Manages game rooms and player assignments
// Handles room lifecycle, player connections, and game state

import { GameEngine } from './engine'
import { validateAction, checkRateLimit, cleanupRateLimits, ValidationResult } from './validator'
import { 
  RoomConfig, 
  RoomState, 
  Player, 
  GameSnapshot, 
  ActionType,
  PlayerResources 
} from './types'

// Room states
type RoomStatus = 'waiting' | 'starting' | 'playing' | 'ended'

interface GameRoom {
  id: string
  name: string
  config: RoomConfig
  players: Map<string, PlayerConnection>
  status: RoomStatus
  engine: GameEngine | null
  createdAt: number
  startedAt: number | null
  hostId: string
  tickInterval: NodeJS.Timeout | null
  snapshotInterval: NodeJS.Timeout | null
}

interface PlayerConnection {
  id: string
  name: string
  team: 'host' | 'guest'
  color: string
  ready: boolean
  lastPing: number
  isConnected: boolean
  resources: PlayerResources
  ownedUnitIds: Set<string>
  ownedBuildingIds: Set<string>
}

// In-memory room storage
const rooms = new Map<string, GameRoom>()

// Generate unique room ID
function generateRoomId(): string {
  return `room-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

// Create a new game room
export function createRoom(
  hostId: string,
  hostName: string,
  roomName: string,
  difficulty: 'easy' | 'normal' | 'hard' = 'normal'
): RoomState | null {
  const roomId = generateRoomId()
  
  const config: RoomConfig = {
    roomId,
    roomName,
    mapSeed: Math.floor(Math.random() * 1000000),
    difficulty,
    maxPlayers: 2
  }
  
  const hostConnection: PlayerConnection = {
    id: hostId,
    name: hostName,
    team: 'host',
    color: '#4169E1', // Blue
    ready: false,
    lastPing: Date.now(),
    isConnected: true,
    resources: { gold: 200, wood: 100, supply: 5, maxSupply: 10 },
    ownedUnitIds: new Set(),
    ownedBuildingIds: new Set()
  }
  
  const room: GameRoom = {
    id: roomId,
    name: roomName,
    config,
    players: new Map([[hostId, hostConnection]]),
    status: 'waiting',
    engine: null,
    createdAt: Date.now(),
    startedAt: null,
    hostId,
    tickInterval: null,
    snapshotInterval: null
  }
  
  rooms.set(roomId, room)
  
  return convertToRoomState(room)
}

// Get room by ID
export function getRoom(roomId: string): RoomState | null {
  const room = rooms.get(roomId)
  return room ? convertToRoomState(room) : null
}

// Get all available rooms
export function getAvailableRooms(): RoomState[] {
  return Array.from(rooms.values())
    .filter(room => room.status === 'waiting' && room.players.size < room.config.maxPlayers)
    .map(room => convertToRoomState(room))
}

// Join a room
export function joinRoom(roomId: string, playerId: string, playerName: string): RoomState | null {
  const room = rooms.get(roomId)
  if (!room) return null
  
  if (room.status !== 'waiting') {
    return null // Can't join after game started
  }
  
  if (room.players.size >= room.config.maxPlayers) {
    return null // Room full
  }
  
  // Check if player already in room
  if (room.players.has(playerId)) {
    return convertToRoomState(room)
  }
  
  const guestConnection: PlayerConnection = {
    id: playerId,
    name: playerName,
    team: 'guest',
    color: '#DC143C', // Red
    ready: false,
    lastPing: Date.now(),
    isConnected: true,
    resources: { gold: 200, wood: 100, supply: 5, maxSupply: 10 },
    ownedUnitIds: new Set(),
    ownedBuildingIds: new Set()
  }
  
  room.players.set(playerId, guestConnection)
  
  return convertToRoomState(room)
}

// Leave a room
export function leaveRoom(playerId: string): void {
  for (const [roomId, room] of rooms.entries()) {
    if (room.players.has(playerId)) {
      room.players.delete(playerId)
      
      // Handle host leaving
      if (room.hostId === playerId) {
        if (room.players.size > 0) {
          // Assign new host
          const newHost = room.players.values().next().value
          if (newHost) {
            room.hostId = newHost.id
            newHost.team = 'host'
            newHost.color = '#4169E1'
          }
        } else {
          // No players left, delete room
          cleanupRoom(roomId)
          return
        }
      }
      
      // If game not started and no players left, delete room
      if (room.status === 'waiting' && room.players.size === 0) {
        cleanupRoom(roomId)
      }
      
      return
    }
  }
}

// Toggle player ready status
export function setPlayerReady(roomId: string, playerId: string, ready: boolean): RoomState | null {
  const room = rooms.get(roomId)
  if (!room) return null
  
  const player = room.players.get(playerId)
  if (!player) return null
  
  player.ready = ready
  return convertToRoomState(room)
}

// Start game in a room
export function startGame(roomId: string, hostId: string): RoomState | null {
  const room = rooms.get(roomId)
  if (!room) return null
  
  if (room.hostId !== hostId) {
    return null // Only host can start
  }
  
  if (room.status !== 'waiting') {
    return null // Game already started
  }
  
  // Check all players ready
  const allReady = Array.from(room.players.values()).every(p => p.ready)
  if (!allReady && room.players.size > 1) {
    return null // Not all ready
  }
  
  // Create game engine
  const engine = new GameEngine(room.config.mapSeed, room.config.difficulty)
  
  // Add players to engine
  for (const [playerId, connection] of room.players.entries()) {
    engine.addPlayer(playerId, connection.name, connection.team, connection.color)
  }
  
  // Initialize game
  engine.initializeGame()
  
  room.engine = engine
  room.status = 'playing'
  room.startedAt = Date.now()
  
  // Start tick loop (60 ticks per second)
  room.tickInterval = setInterval(() => {
    if (room.engine) {
      engine.update(1) // 1 tick
      
      // Check game over
      if (engine.isGameOver()) {
        endGame(roomId, engine.getWinner())
      }
    }
  }, 1000 / 60)
  
  // Start snapshot broadcasting (10 times per second)
  room.snapshotInterval = setInterval(() => {
    if (room.engine) {
      const snapshot = engine.createSnapshot()
      broadcastSnapshot(roomId, snapshot)
    }
  }, 100)
  
  return convertToRoomState(room)
}

// Process player action
export function processAction(
  roomId: string,
  playerId: string,
  action: ActionType
): ValidationResult {
  const room = rooms.get(roomId)
  if (!room || !room.engine) {
    return { valid: false, reason: 'Room or game not found' }
  }
  
  const player = room.players.get(playerId)
  if (!player) {
    return { valid: false, reason: 'Player not in room' }
  }
  
  // Check rate limit
  const rateLimitResult = checkRateLimit(playerId)
  if (!rateLimitResult.valid) {
    return rateLimitResult
  }
  
  // Validate action
  const validationResult = validateAction(
    action,
    playerId,
    player.resources,
    player.ownedUnitIds,
    player.ownedBuildingIds,
    {
      mapWidth: room.engine.getState().map.width * room.engine.getState().map.tileSize,
      mapHeight: room.engine.getState().map.height * room.engine.getState().map.tileSize,
      units: room.engine.getState().units,
      buildings: room.engine.getState().buildings,
      resources: room.engine.getState().players
    }
  )
  
  if (!validationResult.valid) {
    return validationResult
  }
  
  // Process action in engine
  const success = room.engine.processAction(playerId, action)
  
  return { valid: success, reason: success ? undefined : 'Failed to process action' }
}

// Get game snapshot for a player
export function getSnapshot(roomId: string): GameSnapshot | null {
  const room = rooms.get(roomId)
  if (!room || !room.engine) return null
  
  return room.engine.createSnapshot()
}

// Handle player ping
export function handlePing(roomId: string, playerId: string): number {
  const room = rooms.get(roomId)
  if (!room) return 0
  
  const player = room.players.get(playerId)
  if (!player) return 0
  
  player.lastPing = Date.now()
  player.isConnected = true
  
  return Date.now()
}

// Check for disconnected players
export function checkConnections(roomId: string): string[] {
  const room = rooms.get(roomId)
  if (!room) return []
  
  const disconnected: string[] = []
  const now = Date.now()
  
  for (const [playerId, player] of room.players.entries()) {
    // Consider disconnected if no ping for 30 seconds
    if (now - player.lastPing > 30000) {
      player.isConnected = false
      disconnected.push(playerId)
    }
  }
  
  return disconnected
}

// End game
function endGame(roomId: string, winnerId: string | null): void {
  const room = rooms.get(roomId)
  if (!room) return
  
  room.status = 'ended'
  
  // Stop intervals
  if (room.tickInterval) {
    clearInterval(room.tickInterval)
    room.tickInterval = null
  }
  
  if (room.snapshotInterval) {
    clearInterval(room.snapshotInterval)
    room.snapshotInterval = null
  }
  
  // Broadcast game over
  const snapshot = room.engine?.createSnapshot()
  if (snapshot) {
    snapshot.gameOver = true
    snapshot.winner = winnerId
    broadcastSnapshot(roomId, snapshot)
  }
}

// Clean up room
function cleanupRoom(roomId: string): void {
  const room = rooms.get(roomId)
  if (!room) return
  
  // Stop intervals
  if (room.tickInterval) {
    clearInterval(room.tickInterval)
  }
  
  if (room.snapshotInterval) {
    clearInterval(room.snapshotInterval)
  }
  
  rooms.delete(roomId)
}

// Broadcast snapshot to all players
function broadcastSnapshot(roomId: string, snapshot: GameSnapshot): void {
  // This would be replaced with actual WebSocket sending
  // For now, just a placeholder
  console.log(`Broadcasting snapshot to room ${roomId}: tick ${snapshot.tick}`)
}

// Convert internal room to API response format
function convertToRoomState(room: GameRoom): RoomState {
  return {
    config: room.config,
    players: Array.from(room.players.values()).map(p => ({
      id: p.id,
      name: p.name,
      team: p.team,
      color: p.color,
      ready: p.ready,
      resources: p.resources,
      upgrades: { attack: 0, defense: 0, range: 0 }
    })),
    gameState: room.engine ? {
      tick: room.engine.getState().tick,
      map: room.engine.getState().map,
      units: room.engine.getState().units,
      buildings: room.engine.getState().buildings,
      projectiles: room.engine.getState().projectiles,
      players: room.engine.getState().players,
      discoveredTiles: room.engine.getState().discoveredTiles,
      gameOver: room.engine.getState().gameOver,
      winner: room.engine.getState().winner,
      winnerReason: room.engine.getState().winnerReason
    } : null,
    gameStarted: room.status === 'playing' || room.status === 'ended',
    createdAt: room.createdAt,
    hostId: room.hostId
  }
}

// Periodic cleanup
setInterval(() => {
  cleanupRateLimits()
  
  // Clean up old rooms
  for (const [roomId, room] of rooms.entries()) {
    // Remove rooms older than 1 hour
    if (Date.now() - room.createdAt > 3600000) {
      cleanupRoom(roomId)
    }
  }
}, 60000)

export type { GameRoom, PlayerConnection }
