// Multiplayer Room Management System

export interface Player {
  id: string
  name: string
  team: 'host' | 'guest'  // host is blue team, guest is red team
  ready: boolean
  color: string
}

export interface Room {
  id: string
  name: string
  host: string  // player id of host
  players: Player[]
  maxPlayers: number
  gameStarted: boolean
  mapSeed: number
  difficulty: 'easy' | 'normal' | 'hard'
  createdAt: number
  gameState: MultiplayerGameState | null
  hostState: PlayerGameState | null
  guestState: PlayerGameState | null
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
  winner: string | null  // player id of winner
}

// In-memory room storage
const rooms: Map<string, Room> = new Map()
const playerRooms: Map<string, string> = new Map()

// Generate unique ID
export function generateId(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
}

// Player colors
const PLAYER_COLORS = {
  host: '#4169E1',   // Blue
  guest: '#DC143C',  // Red
}

// Create a new room
export function createRoom(hostId: string, hostName: string, roomName: string, difficulty: 'easy' | 'normal' | 'hard'): Room {
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
  rooms.set(roomId, room)
  playerRooms.set(hostId, roomId)
  return room
}

// Get all available rooms
export function getRooms(): Room[] {
  return Array.from(rooms.values())
    .filter(r => !r.gameStarted && r.players.length < r.maxPlayers)
    .sort((a, b) => b.createdAt - a.createdAt)
}

// Get a specific room
export function getRoom(roomId: string): Room | undefined {
  return rooms.get(roomId)
}

// Join a room
export function joinRoom(roomId: string, playerId: string, playerName: string): Room | null {
  const room = rooms.get(roomId)
  if (!room || room.gameStarted || room.players.length >= room.maxPlayers) {
    return null
  }
  
  // Check if player is already in this room
  if (room.players.some(p => p.id === playerId)) {
    return room
  }
  
  // Remove player from any other room
  leaveRoom(playerId)
  
  room.players.push({
    id: playerId,
    name: playerName,
    team: 'guest',
    ready: false,
    color: PLAYER_COLORS.guest
  })
  
  playerRooms.set(playerId, roomId)
  return room
}

// Leave a room
export function leaveRoom(playerId: string): void {
  const roomId = playerRooms.get(playerId)
  if (!roomId) return
  
  const room = rooms.get(roomId)
  if (!room) return
  
  room.players = room.players.filter(p => p.id !== playerId)
  playerRooms.delete(playerId)
  
  // If room is empty, delete it
  if (room.players.length === 0) {
    rooms.delete(roomId)
    return
  }
  
  // If host left, assign new host
  if (room.host === playerId && room.players.length > 0) {
    room.host = room.players[0].id
    room.players[0].team = 'host'
    room.players[0].color = PLAYER_COLORS.host
  }
}

// Toggle ready status
export function toggleReady(roomId: string, playerId: string): Room | null {
  const room = rooms.get(roomId)
  if (!room) return null
  
  const player = room.players.find(p => p.id === playerId)
  if (!player) return null
  
  player.ready = !player.ready
  return room
}

// Start the game
export function startGame(roomId: string, playerId: string): Room | null {
  const room = rooms.get(roomId)
  if (!room || room.host !== playerId) return null
  
  // Check if all players are ready
  if (!room.players.every(p => p.ready)) return null
  
  room.gameStarted = true
  return room
}

// Update player state
export function updatePlayerState(roomId: string, playerId: string, state: PlayerGameState): Room | null {
  const room = rooms.get(roomId)
  if (!room) return null
  
  const player = room.players.find(p => p.id === playerId)
  if (!player) return null
  
  if (player.team === 'host') {
    room.hostState = state
  } else {
    room.guestState = state
  }
  
  return room
}

// Update shared game state
export function updateGameState(roomId: string, gameState: MultiplayerGameState): Room | null {
  const room = rooms.get(roomId)
  if (!room) return null
  
  room.gameState = gameState
  return room
}

// Get opponent's state
export function getOpponentState(roomId: string, playerId: string): PlayerGameState | null {
  const room = rooms.get(roomId)
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
export function cleanupRooms(maxAgeMs: number = 3600000): void {
  const now = Date.now()
  for (const [id, room] of rooms.entries()) {
    if (now - room.createdAt > maxAgeMs && !room.gameStarted) {
      rooms.delete(id)
      room.players.forEach(p => playerRooms.delete(p.id))
    }
  }
}

// Get player's current room
export function getPlayerRoom(playerId: string): Room | undefined {
  const roomId = playerRooms.get(playerId)
  if (!roomId) return undefined
  return rooms.get(roomId)
}

// Get player team
export function getPlayerTeam(roomId: string, playerId: string): 'host' | 'guest' | null {
  const room = rooms.get(roomId)
  if (!room) return null
  
  const player = room.players.find(p => p.id === playerId)
  if (!player) return null
  
  return player.team
}
