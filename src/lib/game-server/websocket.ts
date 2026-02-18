// WebSocket Handler - Real-time multiplayer communication
// Handles WebSocket connections for low-latency game communication

import { GameSnapshot, ActionType, ClientMessage, ServerMessage } from './types'
import { processAction, getSnapshot, handlePing, checkConnections } from './room-manager'

export type MessageHandler = (message: ServerMessage) => void

interface WebSocketConnection {
  id: string
  playerId: string
  roomId: string
  socket: any // WebSocket-like object
  lastPing: number
  connected: boolean
}

// Active connections
const connections = new Map<string, WebSocketConnection>()
const playerConnections = new Map<string, string>() // playerId -> connectionId

// Create a WebSocket connection (simulated for serverless environments)
// In production, this would be a real WebSocket server
export class GameWebSocketHandler {
  private connections: Map<string, WebSocketConnection> = new Map()
  private messageHandlers: Map<string, MessageHandler> = new Map()
  
  // Handle new connection
  handleConnection(connectionId: string, playerId: string, roomId: string, socket: any): void {
    const connection: WebSocketConnection = {
      id: connectionId,
      playerId,
      roomId,
      socket,
      lastPing: Date.now(),
      connected: true
    }
    
    this.connections.set(connectionId, connection)
    playerConnections.set(playerId, connectionId)
  }
  
  // Handle disconnection
  handleDisconnection(connectionId: string): void {
    const connection = this.connections.get(connectionId)
    if (connection) {
      playerConnections.delete(connection.playerId)
      this.connections.delete(connectionId)
    }
  }
  
  // Handle incoming message
  handleMessage(connectionId: string, data: string): void {
    const connection = this.connections.get(connectionId)
    if (!connection || !connection.connected) return
    
    try {
      const message: ClientMessage = JSON.parse(data)
      this.processClientMessage(connection, message)
    } catch (e) {
      console.error('Failed to parse WebSocket message:', e)
    }
  }
  
  // Process client message
  private processClientMessage(connection: WebSocketConnection, message: ClientMessage): void {
    switch (message.type) {
      case 'action':
        this.handleAction(connection, message)
        break
      
      case 'join':
        this.handleJoin(connection, message)
        break
      
      case 'leave':
        this.handleLeave(connection, message)
        break
      
      case 'ready':
        this.handleReady(connection, message)
        break
      
      case 'ping':
        this.handlePingMessage(connection)
        break
      
      default:
        console.warn('Unknown message type:', message.type)
    }
  }
  
  // Handle action message
  private handleAction(connection: WebSocketConnection, message: ClientMessage): void {
    if (!message.action) return
    
    const result = processAction(
      connection.roomId,
      connection.playerId,
      message.action as unknown as ActionType
    )
    
    // Send result back to client
    const response: ServerMessage = {
      type: result.valid ? 'actionAccepted' : 'actionRejected',
      actionId: message.action['id'],
      error: result.reason
    }
    
    this.sendToPlayer(connection.playerId, response)
  }
  
  // Handle join message
  private handleJoin(connection: WebSocketConnection, message: ClientMessage): void {
    // Room joining is handled by HTTP API
    // This is for game-specific setup
    const snapshot = getSnapshot(connection.roomId)
    
    if (snapshot) {
      const response: ServerMessage = {
        type: 'snapshot',
        snapshot
      }
      
      this.sendToPlayer(connection.playerId, response)
    }
  }
  
  // Handle leave message
  private handleLeave(connection: WebSocketConnection, message: ClientMessage): void {
    this.handleDisconnection(connection.id)
  }
  
  // Handle ready message
  private handleReady(connection: WebSocketConnection, message: ClientMessage): void {
    // Ready status handled by HTTP API
  }
  
  // Handle ping
  private handlePingMessage(connection: WebSocketConnection): void {
    connection.lastPing = Date.now()
    
    const response: ServerMessage = {
      type: 'ping',
      timestamp: Date.now()
    }
    
    this.sendToPlayer(connection.playerId, response)
  }
  
  // Send message to specific player
  sendToPlayer(playerId: string, message: ServerMessage): void {
    const connectionId = playerConnections.get(playerId)
    if (!connectionId) return
    
    const connection = this.connections.get(connectionId)
    if (!connection || !connection.connected) return
    
    try {
      connection.socket.send(JSON.stringify(message))
    } catch (e) {
      console.error('Failed to send message:', e)
    }
  }
  
  // Broadcast to room
  broadcastToRoom(roomId: string, message: ServerMessage, excludePlayerId?: string): void {
    for (const [_, connection] of this.connections) {
      if (connection.roomId === roomId && connection.id !== excludePlayerId) {
        this.sendToPlayer(connection.playerId, message)
      }
    }
  }
  
  // Register message handler
  onMessage(playerId: string, handler: MessageHandler): void {
    this.messageHandlers.set(playerId, handler)
  }
  
  // Unregister message handler
  offMessage(playerId: string): void {
    this.messageHandlers.delete(playerId)
  }
  
  // Check for stale connections
  checkStaleConnections(): string[] {
    const stale: string[] = []
    const now = Date.now()
    
    for (const [connectionId, connection] of this.connections.entries()) {
      if (now - connection.lastPing > 60000) { // 1 minute timeout
        stale.push(connectionId)
      }
    }
    
    return stale
  }
}

// Global handler instance
export const wsHandler = new GameWebSocketHandler()

// Periodic connection health check
setInterval(() => {
  const stale = wsHandler.checkStaleConnections()
  
  for (const connectionId of stale) {
    wsHandler.handleDisconnection(connectionId)
  }
}, 30000) // Every 30 seconds

// Helper to create connection ID
export function createConnectionId(): string {
  return `conn-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

// Send game snapshot to room
export function broadcastSnapshot(roomId: string, snapshot: GameSnapshot): void {
  const message: ServerMessage = {
    type: 'snapshot',
    snapshot
  }
  
  wsHandler.broadcastToRoom(roomId, message)
}

// Send game over message
export function broadcastGameOver(roomId: string, winner: string | null, reason: string): void {
  const message: ServerMessage = {
    type: 'gameOver',
    winner: winner || undefined,
    reason
  }
  
  wsHandler.broadcastToRoom(roomId, message)
}
