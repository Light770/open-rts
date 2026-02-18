import { NextRequest, NextResponse } from 'next/server'
import {
  createRoom,
  getRooms,
  getRoom,
  joinRoom,
  leaveRoom,
  toggleReady,
  startGame,
  updatePlayerState,
  updateGameState,
  getOpponentState,
  cleanupRooms,
  PlayerGameState,
  MultiplayerGameState
} from '@/lib/multiplayer'

// Only clean up rooms periodically, not on every request
let lastCleanup = 0
const CLEANUP_INTERVAL = 60000 // 1 minute

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const action = searchParams.get('action')
  const roomId = searchParams.get('roomId')
  const playerId = searchParams.get('playerId')

  // Periodic cleanup
  const now = Date.now()
  if (now - lastCleanup > CLEANUP_INTERVAL) {
    cleanupRooms(1800000) // 30 minutes
    lastCleanup = now
  }

  try {
    switch (action) {
      case 'list':
        return NextResponse.json({ rooms: getRooms() })
      
      case 'get':
        if (!roomId) {
          return NextResponse.json({ error: 'Room ID required' }, { status: 400 })
        }
        const room = getRoom(roomId)
        if (!room) {
          console.log('[Multiplayer API] Room not found:', roomId)
          return NextResponse.json({ error: 'Room not found' }, { status: 404 })
        }
        return NextResponse.json({ room })
      
      case 'state':
        if (!roomId || !playerId) {
          return NextResponse.json({ error: 'Room ID and Player ID required' }, { status: 400 })
        }
        const stateRoom = getRoom(roomId)
        if (!stateRoom) {
          console.log('[Multiplayer API] Room not found for state:', roomId)
          return NextResponse.json({ error: 'Room not found' }, { status: 404 })
        }
        
        // Get opponent's state
        const opponentState = getOpponentState(roomId, playerId)
        
        return NextResponse.json({ 
          gameState: stateRoom.gameState,
          opponentState,
          gameStarted: stateRoom.gameStarted,
          players: stateRoom.players,
          hostState: stateRoom.hostState,
          guestState: stateRoom.guestState
        })
      
      case 'leave':
        if (!playerId) {
          return NextResponse.json({ error: 'Player ID required' }, { status: 400 })
        }
        leaveRoom(playerId)
        return NextResponse.json({ success: true })
      
      default:
        return NextResponse.json({ rooms: getRooms() })
    }
  } catch (error) {
    console.error('Multiplayer API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action, playerId, playerName, roomId, roomName, difficulty, playerState, gameState } = body

    console.log('[Multiplayer API] POST action:', action, { roomId, playerId: playerId?.substring(0, 8) })

    switch (action) {
      case 'create':
        if (!playerId || !playerName || !roomName) {
          return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
        }
        const newRoom = createRoom(playerId, playerName, roomName, difficulty || 'normal')
        console.log('[Multiplayer API] Room created:', newRoom.id)
        return NextResponse.json({ room: newRoom })
      
      case 'join':
        if (!roomId || !playerId || !playerName) {
          return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
        }
        const joinedRoom = joinRoom(roomId, playerId, playerName)
        if (!joinedRoom) {
          console.log('[Multiplayer API] Cannot join room:', roomId)
          return NextResponse.json({ error: 'Cannot join room' }, { status: 400 })
        }
        console.log('[Multiplayer API] Player joined:', playerId.substring(0, 8), 'room:', roomId)
        return NextResponse.json({ room: joinedRoom })
      
      case 'ready':
        if (!roomId || !playerId) {
          return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
        }
        const readyRoom = toggleReady(roomId, playerId)
        if (!readyRoom) {
          console.log('[Multiplayer API] Cannot toggle ready:', roomId)
          return NextResponse.json({ error: 'Cannot toggle ready' }, { status: 400 })
        }
        return NextResponse.json({ room: readyRoom })
      
      case 'start':
        if (!roomId || !playerId) {
          return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
        }
        const startedRoom = startGame(roomId, playerId)
        if (!startedRoom) {
          console.log('[Multiplayer API] Cannot start game:', roomId)
          return NextResponse.json({ error: 'Cannot start game' }, { status: 400 })
        }
        console.log('[Multiplayer API] Game started in room:', roomId)
        return NextResponse.json({ room: startedRoom })
      
      case 'syncPlayer':
        if (!roomId || !playerId || !playerState) {
          console.log('[Multiplayer API] syncPlayer missing fields:', { roomId: !!roomId, playerId: !!playerId, playerState: !!playerState })
          return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
        }
        console.log('[Multiplayer API] Syncing player state for:', playerId.substring(0, 8), 'room:', roomId?.substring(0, 8))
        const syncedPlayerRoom = updatePlayerState(roomId, playerId, playerState as PlayerGameState)
        if (!syncedPlayerRoom) {
          // Debug: check what's happening
          const room = getRoom(roomId)
          console.log('[Multiplayer API] syncPlayer failed:', { 
            roomId: roomId?.substring(0, 8), 
            roomExists: !!room,
            players: room?.players?.map(p => p.id.substring(0, 8))
          })
          return NextResponse.json({ error: 'Cannot sync player state' }, { status: 400 })
        }
        return NextResponse.json({ success: true })
      
      case 'syncGame':
        if (!roomId || !gameState) {
          return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
        }
        const syncedGameRoom = updateGameState(roomId, gameState as MultiplayerGameState)
        if (!syncedGameRoom) {
          console.log('[Multiplayer API] Cannot sync game state:', roomId)
          return NextResponse.json({ error: 'Cannot sync game state' }, { status: 400 })
        }
        return NextResponse.json({ success: true })
      
      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }
  } catch (error) {
    console.error('Multiplayer API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
