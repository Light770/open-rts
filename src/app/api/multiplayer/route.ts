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

// Clean up old rooms on each request
cleanupRooms(1800000) // 30 minutes

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const action = searchParams.get('action')
  const roomId = searchParams.get('roomId')
  const playerId = searchParams.get('playerId')

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
          return NextResponse.json({ error: 'Room not found' }, { status: 404 })
        }
        return NextResponse.json({ room })
      
      case 'state':
        if (!roomId || !playerId) {
          return NextResponse.json({ error: 'Room ID and Player ID required' }, { status: 400 })
        }
        const stateRoom = getRoom(roomId)
        if (!stateRoom) {
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

    switch (action) {
      case 'create':
        if (!playerId || !playerName || !roomName) {
          return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
        }
        const newRoom = createRoom(playerId, playerName, roomName, difficulty || 'normal')
        return NextResponse.json({ room: newRoom })
      
      case 'join':
        if (!roomId || !playerId || !playerName) {
          return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
        }
        const joinedRoom = joinRoom(roomId, playerId, playerName)
        if (!joinedRoom) {
          return NextResponse.json({ error: 'Cannot join room' }, { status: 400 })
        }
        return NextResponse.json({ room: joinedRoom })
      
      case 'ready':
        if (!roomId || !playerId) {
          return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
        }
        const readyRoom = toggleReady(roomId, playerId)
        if (!readyRoom) {
          return NextResponse.json({ error: 'Cannot toggle ready' }, { status: 400 })
        }
        return NextResponse.json({ room: readyRoom })
      
      case 'start':
        if (!roomId || !playerId) {
          return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
        }
        const startedRoom = startGame(roomId, playerId)
        if (!startedRoom) {
          return NextResponse.json({ error: 'Cannot start game' }, { status: 400 })
        }
        return NextResponse.json({ room: startedRoom })
      
      case 'syncPlayer':
        if (!roomId || !playerId || !playerState) {
          return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
        }
        const syncedPlayerRoom = updatePlayerState(roomId, playerId, playerState as PlayerGameState)
        if (!syncedPlayerRoom) {
          return NextResponse.json({ error: 'Cannot sync player state' }, { status: 400 })
        }
        return NextResponse.json({ success: true })
      
      case 'syncGame':
        if (!roomId || !gameState) {
          return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
        }
        const syncedGameRoom = updateGameState(roomId, gameState as MultiplayerGameState)
        if (!syncedGameRoom) {
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
