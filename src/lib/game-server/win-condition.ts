// Win Condition Manager - Server-side win condition detection
// Monitors game state and determines when a player wins

import { Building, Unit, Player, GameState } from './types'

export interface WinConditionResult {
  gameOver: boolean
  winner: string | null
  reason: string | null
  eliminatedPlayers: string[]
}

// Check win conditions based on current game state
export function checkWinConditions(gameState: GameState): WinConditionResult {
  const players = Array.from(gameState.players.values())
  const eliminatedPlayers: string[] = []
  
  // Check if any player has lost their base
  for (const player of players) {
    const playerBuildings = Array.from(gameState.buildings.values())
      .filter(b => b.ownerId === player.id)
    
    const hasBase = playerBuildings.some(b => b.type === 'base')
    
    if (!hasBase) {
      eliminatedPlayers.push(player.id)
    }
  }
  
  // If all but one player eliminated, winner is the last one standing
  if (eliminatedPlayers.length > 0) {
    const remainingPlayers = players.filter(p => !eliminatedPlayers.includes(p.id))
    
    if (remainingPlayers.length === 1) {
      return {
        gameOver: true,
        winner: remainingPlayers[0].id,
        reason: `${getPlayerName(remainingPlayers[0], gameState.players)} wins by elimination!`,
        eliminatedPlayers
      }
    }
    
    // Check if host or guest has base (for 2-player games)
    if (players.length === 2) {
      const hostHasBase = Array.from(gameState.buildings.values())
        .some(b => b.type === 'base' && b.ownerId === players[0]?.id)
      const guestHasBase = Array.from(gameState.buildings.values())
        .some(b => b.type === 'base' && b.ownerId === players[1]?.id)
      
      if (!hostHasBase && guestHasBase) {
        return {
          gameOver: true,
          winner: players[1].id,
          reason: `${getPlayerName(players[1], gameState.players)} wins! Enemy base destroyed!`,
          eliminatedPlayers: [players[0].id]
        }
      }
      
      if (!guestHasBase && hostHasBase) {
        return {
          gameOver: true,
          winner: players[0].id,
          reason: `${getPlayerName(players[0], gameState.players)} wins! Enemy base destroyed!`,
          eliminatedPlayers: [players[1].id]
        }
      }
    }
  }
  
  // Check for victory by destruction (all enemy units and buildings destroyed)
  if (players.length === 2) {
    const player1 = players[0]
    const player2 = players[1]
    
    if (player1 && player2) {
      const player1Units = Array.from(gameState.units.values())
        .filter(u => u.ownerId === player1.id)
      const player1Buildings = Array.from(gameState.buildings.values())
        .filter(b => b.ownerId === player1.id)
      
      const player2Units = Array.from(gameState.units.values())
        .filter(u => u.ownerId === player2.id)
      const player2Buildings = Array.from(gameState.buildings.values())
        .filter(b => b.ownerId === player2.id)
      
      // Player 1 has been eliminated
      if (player1Units.length === 0 && player1Buildings.length === 0 && player1Buildings.filter(b => b.type === 'base').length === 0) {
        return {
          gameOver: true,
          winner: player2.id,
          reason: `${getPlayerName(player2, gameState.players)} wins! Enemy army destroyed!`,
          eliminatedPlayers: [player1.id]
        }
      }
      
      // Player 2 has been eliminated
      if (player2Units.length === 0 && player2Buildings.length === 0 && player2Buildings.filter(b => b.type === 'base').length === 0) {
        return {
          gameOver: true,
          winner: player1.id,
          reason: `${getPlayerName(player1, gameState.players)} wins! Enemy army destroyed!`,
          eliminatedPlayers: [player2.id]
        }
      }
    }
  }
  
  // Check for surrender (could be triggered by client)
  // This would require tracking surrender votes
  
  return {
    gameOver: false,
    winner: null,
    reason: null,
    eliminatedPlayers: []
  }
}

// Get player name from players map
function getPlayerName(player: Player, players: Map<string, Player>): string {
  return player.name || `Player ${player.id.substring(0, 8)}`
}

// Check if a specific player has won
export function checkPlayerVictory(playerId: string, gameState: GameState): boolean {
  const players = Array.from(gameState.players.values())
  const otherPlayers = players.filter(p => p.id !== playerId)
  
  // Player wins if all other players have no base
  for (const otherPlayer of otherPlayers) {
    const hasBase = Array.from(gameState.buildings.values())
      .some(b => b.ownerId === otherPlayer.id && b.type === 'base')
    
    if (hasBase) {
      return false
    }
  }
  
  return true
}

// Check if a specific player has been defeated
export function checkPlayerDefeat(playerId: string, gameState: GameState): boolean {
  const playerBuildings = Array.from(gameState.buildings.values())
    .filter(b => b.ownerId === playerId)
  
  const hasBase = playerBuildings.some(b => b.type === 'base')
  
  return !hasBase
}

// Calculate victory points (for scoring system)
export function calculateVictoryPoints(playerId: string, gameState: GameState): number {
  let points = 0
  
  // Points for buildings
  const playerBuildings = Array.from(gameState.buildings.values())
    .filter(b => b.ownerId === playerId)
  
  for (const building of playerBuildings) {
    switch (building.type) {
      case 'base': points += 100; break
      case 'barracks': points += 50; break
      case 'tower': points += 30; break
      case 'blacksmith': points += 25; break
      case 'siegeWorkshop': points += 40; break
      case 'farm': points += 10; break
      case 'wall': points += 5; break
    }
  }
  
  // Points for units
  const playerUnits = Array.from(gameState.units.values())
    .filter(u => u.ownerId === playerId)
  
  for (const unit of playerUnits) {
    switch (unit.type) {
      case 'soldier': points += 10; break
      case 'archer': points += 12; break
      case 'healer': points += 15; break
      case 'catapult': points += 25; break
      case 'worker': points += 5; break
    }
  }
  
  // Bonus for destroying enemy buildings/units
  const enemyBuildings = Array.from(gameState.buildings.values())
    .filter(b => b.ownerId !== playerId && b.hp <= 0)
  
  const enemyUnits = Array.from(gameState.units.values())
    .filter(u => u.ownerId !== playerId && u.hp <= 0)
  
  points += enemyBuildings.length * 20
  points += enemyUnits.length * 10
  
  return points
}

// Get game duration in minutes
export function getGameDuration(startTime: number): number {
  return Math.floor((Date.now() - startTime) / 60000)
}

// Format win message
export function formatWinMessage(
  winner: Player | null, 
  reason: string, 
  duration: number
): string {
  if (!winner) {
    return `Game ended in a draw after ${duration} minutes`
  }
  
  return `${winner.name} wins! ${reason} (Duration: ${duration} minutes)`
}
