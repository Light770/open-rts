// Netlify KV Store wrapper for persistent multiplayer rooms
// Uses @netlify/blobs for serverless-compatible storage

import { getGlobalStore } from '@netlify/blobs'

// Types for our room storage
export interface Player {
  id: string
  name: string
  team: 'host' | 'guest'
  ready: boolean
  color: string
}

export interface Room {
  id: string
  name: string
  host: string
  players: Player[]
  maxPlayers: number
  gameStarted: boolean
  mapSeed: number
  difficulty: 'easy' | 'normal' | 'hard'
  createdAt: number
  gameState: any
  hostState: any
  guestState: any
}

export interface PlayerGameState {
  units: any[]
  buildings: any[]
  resources: { gold: number; wood: number; supply: number; maxSupply: number }
  upgrades: { attack: number; defense: number; range: number }
  lastUpdate: number
}

export interface MultiplayerGameState {
  resources: any[]
  projectiles: any[]
  tick: number
  gameOver: boolean
  winner: string | null
}

// Get the rooms store
function getRoomsStore() {
  try {
    return getGlobalStore({ name: 'multiplayer-rooms' })
  } catch (e) {
    console.error('[KV Store] Failed to initialize:', e)
    return null
  }
}

// Generate unique ID
export function generateId(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
}

// Player colors
const PLAYER_COLORS = {
  host: '#4169E1',
  guest: '#DC143C',
}

// Create a new room
export async function createRoom(hostId: string, hostName: string, roomName: string, difficulty: 'easy' | 'normal' | 'hard'): Promise<Room | null> {
  const store = getRoomsStore()
  if (!store) return null
  
  const roomId = generateId()
  const room: Room = {
    id: roomId,
    name: roomName,
    host: hostId,
    players: [{
      id: hostId,
      name: hostName,
      team: 'host',
      ready: false,
      color: PLAYER_COLORS.host
    }],
    maxPlayers: 2,
    gameStarted: false,
    mapSeed: Math.floor(Math.random() * 1000000),
    difficulty,
    createdAt: Date.now(),
    gameState: null,
    hostState: null,
    guestState: null
  }
  
  await store.setJSON(roomId, room)
  
  // Also index by host ID for quick lookup
  await store.setJSON(`host:${hostId}`, roomId)
  
  console.log('[KV Store] Room created:', roomId)
  return room
}

// Get all available rooms
export async function getRooms(): Promise<Room[]> {
  const store = getRoomsStore()
  if (!store) return []
  
  try {
    const { blobs } = await store.list()
    const rooms: Room[] = []
    
    for (const blob of blobs) {
      // Skip index entries
      if (blob.key.startsWith('host:')) continue
      
      try {
        const room = await store.getJSON<Room>(blob.key)
        if (room && !room.gameStarted && room.players.length < room.maxPlayers) {
          rooms.push(room)
        }
      } catch (e) {
        // Skip invalid entries
      }
    }
    
    return rooms.sort((a, b) => b.createdAt - a.createdAt)
  } catch (e) {
    console.error('[KV Store] Failed to list rooms:', e)
    return []
  }
}

// Get a specific room
export async function getRoom(roomId: string): Promise<Room | undefined> {
  const store = getRoomsStore()
  if (!store) return undefined
  
  try {
    const room = await store.getJSON<Room>(roomId)
    return room
  } catch (e) {
    return undefined
  }
}

// Join a room
export async function joinRoom(roomId: string, playerId: string, playerName: string): Promise<Room | null> {
  const store = getRoomsStore()
  if (!store) return null
  
  const room = await getRoom(roomId)
  if (!room || room.gameStarted || room.players.length >= room.maxPlayers) {
    return null
  }
  
  // Check if player is already in this room
  if (room.players.some(p => p.id === playerId)) {
    return room
  }
  
  // Leave any previous room
  await leaveRoom(playerId)
  
  room.players.push({
    id: playerId,
    name: playerName,
    team: 'guest',
    ready: false,
    color: PLAYER_COLORS.guest
  })
  
  await store.setJSON(roomId, room)
  await store.setJSON(`player:${playerId}`, roomId)
  
  console.log('[KV Store] Player joined:', playerId.substring(0, 8), 'room:', roomId.substring(0, 8))
  return room
}

// Leave a room
export async function leaveRoom(playerId: string): Promise<void> {
  const store = getRoomsStore()
  if (!store) return
  
  try {
    const roomIdKey = await store.get(`player:${playerId}`)
    if (!roomIdKey) return
    
    const roomId = roomIdKey
    const room = await getRoom(roomId)
    if (!room) return
    
    room.players = room.players.filter(p => p.id !== playerId)
    await store.delete(`player:${playerId}`)
    
    // If room is empty, delete it
    if (room.players.length === 0) {
      await store.delete(roomId)
      if (room.host === playerId) {
        await store.delete(`host:${playerId}`)
      }
      return
    }
    
    // If host left, assign new host
    if (room.host === playerId && room.players.length > 0) {
      room.host = room.players[0].id
      room.players[0].team = 'host'
      room.players[0].color = PLAYER_COLORS.host
    }
    
    await store.setJSON(roomId, room)
  } catch (e) {
    console.error('[KV Store] Failed to leave room:', e)
  }
}

// Toggle ready status
export async function toggleReady(roomId: string, playerId: string): Promise<Room | null> {
  const store = getRoomsStore()
  if (!store) return null
  
  const room = await getRoom(roomId)
  if (!room) return null
  
  const player = room.players.find(p => p.id === playerId)
  if (!player) return null
  
  player.ready = !player.ready
  await store.setJSON(roomId, room)
  return room
}

// Start the game
export async function startGame(roomId: string, playerId: string): Promise<Room | null> {
  const store = getRoomsStore()
  if (!store) return null
  
  const room = await getRoom(roomId)
  if (!room || room.host !== playerId) return null
  
  // Check if all players are ready
  if (!room.players.every(p => p.ready)) return null
  
  room.gameStarted = true
  await store.setJSON(roomId, room)
  console.log('[KV Store] Game started in room:', roomId.substring(0, 8))
  return room
}

// Update player state
export async function updatePlayerState(roomId: string, playerId: string, state: PlayerGameState): Promise<Room | null> {
  const store = getRoomsStore()
  if (!store) return null
  
  const room = await getRoom(roomId)
  if (!room) {
    console.log('[KV Store] Room not found for updatePlayerState:', roomId?.substring(0, 8))
    return null
  }
  
  const player = room.players.find(p => p.id === playerId)
  if (!player) {
    console.log('[KV Store] Player not found:', playerId?.substring(0, 8), 'room:', roomId?.substring(0, 8))
    return null
  }
  
  if (player.team === 'host') {
    room.hostState = state
  } else {
    room.guestState = state
  }
  
  await store.setJSON(roomId, room)
  return room
}

// Update shared game state
export async function updateGameState(roomId: string, gameState: MultiplayerGameState): Promise<Room | null> {
  const store = getRoomsStore()
  if (!store) return null
  
  const room = await getRoom(roomId)
  if (!room) return null
  
  room.gameState = gameState
  await store.setJSON(roomId, room)
  return room
}

// Get opponent's state
export async function getOpponentState(roomId: string, playerId: string): Promise<PlayerGameState | null> {
  const store = getRoomsStore()
  if (!store) return null
  
  const room = await getRoom(roomId)
  if (!room) return null
  
  const player = room.players.find(p => p.id === playerId)
  if (!player) return null
  
  if (player.team === 'host') {
    return room.guestState
  } else {
    return room.hostState
  }
}

// Clean up old rooms
export async function cleanupRooms(maxAgeMs: number = 3600000): Promise<void> {
  const store = getRoomsStore()
  if (!store) return
  
  try {
    const { blobs } = await store.list()
    const now = Date.now()
    
    for (const blob of blobs) {
      if (blob.key.startsWith('host:') || blob.key.startsWith('player:')) continue
      
      try {
        const room = await store.getJSON<Room>(blob.key)
        if (room && now - room.createdAt > maxAgeMs && !room.gameStarted) {
          await store.delete(blob.key)
          console.log('[KV Store] Cleaned up room:', blob.key)
        }
      } catch (e) {
        // Skip invalid entries
      }
    }
  } catch (e) {
    console.error('[KV Store] Failed to cleanup:', e)
  }
}

// Get player's current room
export async function getPlayerRoom(playerId: string): Promise<Room | undefined> {
  const store = getRoomsStore()
  if (!store) return undefined
  
  try {
    const roomId = await store.get(`player:${playerId}`)
    if (!roomId) return undefined
    return getRoom(roomId)
  } catch (e) {
    return undefined
  }
}

// Get player team
export async function getPlayerTeam(roomId: string, playerId: string): Promise<'host' | 'guest' | null> {
  const room = await getRoom(roomId)
  if (!room) return null
  
  const player = room.players.find(p => p.id === playerId)
  if (!player) return null
  
  return player.team
}
