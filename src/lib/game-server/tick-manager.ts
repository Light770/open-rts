// Tick Manager - Server-side game loop management
// Handles the server tick loop, snapshot broadcasting, and tick synchronization

import { GameEngine } from './engine'
import { GameSnapshot, Player } from './types'

export interface TickManagerConfig {
  tickRate: number // Ticks per second
  snapshotRate: number // Snapshots broadcasted per second
  maxPlayers: number
  timeoutMs: number
}

const DEFAULT_CONFIG: TickManagerConfig = {
  tickRate: 60,
  snapshotRate: 10,
  maxPlayers: 2,
  timeoutMs: 30000
}

interface PlayerState {
  id: string
  lastAckedTick: number
  lastInputTick: number
  pendingInputs: TickInput[]
}

interface TickInput {
  tick: number
  action: any
  timestamp: number
}

interface ManagedRoom {
  id: string
  engine: GameEngine
  players: Map<string, PlayerState>
  config: TickManagerConfig
  status: 'running' | 'paused' | 'stopped'
  tickInterval: NodeJS.Timeout | null
  snapshotInterval: NodeJS.Timeout | null
  lastTick: number
  tickCount: number
  startTime: number
  broadcastCallback?: (snapshot: GameSnapshot, playerId?: string) => void
}

// Active tick managers
const managedRooms = new Map<string, ManagedRoom>()

// Create a new tick manager for a room
export function createTickManager(
  roomId: string,
  engine: GameEngine,
  config: Partial<TickManagerConfig> = {},
  broadcastCallback?: (snapshot: GameSnapshot, playerId?: string) => void
): ManagedRoom {
  const fullConfig = { ...DEFAULT_CONFIG, ...config }
  
  const manager: ManagedRoom = {
    id: roomId,
    engine,
    players: new Map(),
    config: fullConfig,
    status: 'stopped',
    tickInterval: null,
    snapshotInterval: null,
    lastTick: 0,
    tickCount: 0,
    startTime: 0,
    broadcastCallback
  }
  
  managedRooms.set(roomId, manager)
  return manager
}

// Add a player to a room
export function addPlayer(roomId: string, playerId: string): boolean {
  const room = managedRooms.get(roomId)
  if (!room) return false
  
  room.players.set(playerId, {
    id: playerId,
    lastAckedTick: 0,
    lastInputTick: 0,
    pendingInputs: []
  })
  
  return true
}

// Remove a player from a room
export function removePlayer(roomId: string, playerId: string): boolean {
  const room = managedRooms.get(roomId)
  if (!room) return false
  
  room.players.delete(playerId)
  return true
}

// Submit player input for a tick
export function submitInput(
  roomId: string,
  playerId: string,
  input: any,
  tick: number
): boolean {
  const room = managedRooms.get(roomId)
  if (!room || room.status !== 'running') return false
  
  const player = room.players.get(playerId)
  if (!player) return false
  
  // Queue input for processing
  player.pendingInputs.push({
    tick,
    action: input,
    timestamp: Date.now()
  })
  
  // Keep only last 60 inputs
  if (player.pendingInputs.length > 60) {
    player.pendingInputs = player.pendingInputs.slice(-60)
  }
  
  return true
}

// Start the tick loop
export function startTickManager(roomId: string): boolean {
  const room = managedRooms.get(roomId)
  if (!room || room.status === 'running') return false
  
  room.status = 'running'
  room.startTime = Date.now()
  room.lastTick = 0
  room.tickCount = 0
  
  const tickIntervalMs = 1000 / room.config.tickRate
  const snapshotIntervalMs = 1000 / room.config.snapshotRate
  
  // Main tick loop
  room.tickInterval = setInterval(() => {
    if (room.status !== 'running') return
    
    room.tickCount++
    const currentTick = room.tickCount
    
    // Process player inputs for this tick
    for (const [playerId, playerState] of room.players.entries()) {
      // Get inputs for this tick
      const tickInputs = playerState.pendingInputs.filter(i => i.tick === currentTick)
      
      for (const input of tickInputs) {
        room.engine.processAction(playerId, input.action)
      }
      
      // Clear processed inputs
      playerState.pendingInputs = playerState.pendingInputs.filter(i => i.tick > currentTick)
    }
    
    // Update game state
    room.engine.update(1)
    
    // Check win condition
    if (room.engine.isGameOver()) {
      stopTickManager(roomId)
      return
    }
    
    room.lastTick = currentTick
  }, tickIntervalMs)
  
  // Snapshot broadcast loop
  room.snapshotInterval = setInterval(() => {
    if (room.status !== 'running') return
    
    const snapshot = room.engine.createSnapshot()
    
    if (room.broadcastCallback) {
      // Broadcast to all players
      room.broadcastCallback(snapshot)
    }
  }, snapshotIntervalMs)
  
  return true
}

// Stop the tick loop
export function stopTickManager(roomId: string): boolean {
  const room = managedRooms.get(roomId)
  if (!room) return false
  
  room.status = 'stopped'
  
  if (room.tickInterval) {
    clearInterval(room.tickInterval)
    room.tickInterval = null
  }
  
  if (room.snapshotInterval) {
    clearInterval(room.snapshotInterval)
    room.snapshotInterval = null
  }
  
  return true
}

// Pause the tick loop
export function pauseTickManager(roomId: string): boolean {
  const room = managedRooms.get(roomId)
  if (!room || room.status !== 'running') return false
  
  room.status = 'paused'
  return true
}

// Resume the tick loop
export function resumeTickManager(roomId: string): boolean {
  const room = managedRooms.get(roomId)
  if (!room || room.status !== 'paused') return false
  
  room.status = 'running'
  return true
}

// Get room status
export function getRoomStatus(roomId: string): 'running' | 'paused' | 'stopped' | null {
  const room = managedRooms.get(roomId)
  return room?.status || null
}

// Get current tick
export function getCurrentTick(roomId: string): number {
  const room = managedRooms.get(roomId)
  return room?.tickCount || 0
}

// Get snapshot for a specific tick
export function getSnapshotAtTick(roomId: string, tick: number): GameSnapshot | null {
  const room = managedRooms.get(roomId)
  if (!room) return null
  
  // For now, just return current snapshot
  // In a full implementation, we'd store tick snapshots
  return room.engine.createSnapshot()
}

// Check for player timeouts
export function checkPlayerTimeouts(roomId: string): string[] {
  const room = managedRooms.get(roomId)
  if (!room) return []
  
  const timedOut: string[] = []
  const now = Date.now()
  
  for (const [playerId, playerState] of room.players.entries()) {
    const lastInput = playerState.pendingInputs[playerState.pendingInputs.length - 1]
    
    if (lastInput && now - lastInput.timestamp > room.config.timeoutMs) {
      timedOut.push(playerId)
    }
  }
  
  return timedOut
}

// Get tick statistics
export function getTickStats(roomId: string): {
  tickRate: number
  tickCount: number
  uptime: number
  playerCount: number
} | null {
  const room = managedRooms.get(roomId)
  if (!room) return null
  
  return {
    tickRate: room.config.tickRate,
    tickCount: room.tickCount,
    uptime: Date.now() - room.startTime,
    playerCount: room.players.size
  }
}

// Clean up a room
export function cleanupRoom(roomId: string): void {
  stopTickManager(roomId)
  managedRooms.delete(roomId)
}

// Periodic cleanup of old rooms
setInterval(() => {
  const now = Date.now()
  
  for (const [roomId, room] of managedRooms.entries()) {
    // Remove rooms that have been stopped for more than 1 hour
    if (room.status === 'stopped' && now - room.startTime > 3600000) {
      cleanupRoom(roomId)
    }
  }
}, 300000) // Every 5 minutes
