// Anti-Cheat System - Server-side cheat detection
// Monitors for suspicious activity and validates client data

import { PlayerResources, Unit, Building } from './types'

export interface CheatDetectionResult {
  flagged: boolean
  reason?: string
  severity: 'warning' | 'suspicious' | 'confirmed'
  details?: any
}

export interface PlayerStats {
  playerId: string
  actionsPerMinute: number
  unitsProduced: number
  buildingsBuilt: number
  resourcesGathered: number
  damageDealt: number
  unitsKilled: number
  buildingsDestroyed: number
  actions: CheatAction[]
}

interface CheatAction {
  timestamp: number
  type: string
  suspicious: boolean
}

// Track player stats for anti-cheat
const playerStats = new Map<string, PlayerStats>()
const recentActions = new Map<string, number[]>() // For rate limiting

// Thresholds
const MAX_ACTIONS_PER_SECOND = 15
const MAX_ACTIONS_PER_MINUTE = 30
const MAX_UNITS_PER_MINUTE = 30
const MAX_BUILDINGS_PER_MINUTE = 20

// Validate resources (anti-cheat)
export function validateResources(
  playerId: string,
  clientResources: PlayerResources,
  serverResources: PlayerResources,
  tolerance: number = 5
): CheatDetectionResult {
  // Check gold
  const goldDiff = Math.abs(clientResources.gold - serverResources.gold)
  if (goldDiff > tolerance * 10) {
    return {
      flagged: true,
      reason: `Significant gold discrepancy: client=${clientResources.gold}, server=${serverResources.gold}`,
      severity: 'confirmed',
      details: { goldDiff, clientGold: clientResources.gold, serverGold: serverResources.gold }
    }
  } else if (goldDiff > tolerance) {
    return {
      flagged: true,
      reason: `Minor gold discrepancy: client=${clientResources.gold}, server=${serverResources.gold}`,
      severity: 'warning',
      details: { goldDiff }
    }
  }
  
  // Check wood
  const woodDiff = Math.abs(clientResources.wood - serverResources.wood)
  if (woodDiff > tolerance * 10) {
    return {
      flagged: true,
      reason: `Significant wood discrepancy: client=${clientResources.wood}, server=${serverResources.wood}`,
      severity: 'confirmed',
      details: { woodDiff, clientWood: clientResources.wood, serverWood: serverResources.wood }
    }
  } else if (woodDiff > tolerance) {
    return {
      flagged: true,
      reason: `Minor wood discrepancy: client=${clientResources.wood}, server=${serverResources.wood}`,
      severity: 'warning',
      details: { woodDiff }
    }
  }
  
  // Check supply
  if (clientResources.supply > clientResources.maxSupply) {
    return {
      flagged: true,
      reason: `Invalid supply: ${clientResources.supply}/${clientResources.maxSupply}`,
      severity: 'confirmed'
    }
  }
  
  return { flagged: false, severity: 'warning' }
}

// Check for impossible unit positions
export function validateUnitPosition(
  unit: Unit,
  mapWidth: number,
  mapHeight: number
): CheatDetectionResult {
  // Check if out of bounds
  if (unit.x < 0 || unit.x > mapWidth || unit.y < 0 || unit.y > mapHeight) {
    return {
      flagged: true,
      reason: 'Unit out of map bounds',
      severity: 'confirmed',
      details: { x: unit.x, y: unit.y, mapWidth, mapHeight }
    }
  }
  
  // Check for teleportation (unit moved too far in one frame)
  // This would require tracking previous positions
  
  return { flagged: false, severity: 'warning' }
}

// Check for impossible building placement
export function validateBuildingPlacement(
  building: Building,
  existingBuildings: Building[],
  mapWidth: number,
  mapHeight: number
): CheatDetectionResult {
  // Check if out of bounds
  const halfSize = building.size / 2
  if (building.x - halfSize < 0 || building.x + halfSize > mapWidth ||
      building.y - halfSize < 0 || building.y + halfSize > mapHeight) {
    return {
      flagged: true,
      reason: 'Building out of map bounds',
      severity: 'confirmed',
      details: { x: building.x, y: building.y, size: building.size }
    }
  }
  
  // Check for overlap with existing buildings
  for (const existing of existingBuildings) {
    if (building.id === existing.id) continue
    
    const dx = building.x - existing.x
    const dy = building.y - existing.y
    const dist = Math.sqrt(dx * dx + dy * dy)
    
    if (dist < (building.size + existing.size) / 2) {
      return {
        flagged: true,
        reason: 'Building overlaps with existing building',
        severity: 'confirmed',
        details: { buildingId: building.id, existingId: existing.id, dist }
      }
    }
  }
  
  return { flagged: false, severity: 'warning' }
}

// Check action rate limiting
export function checkActionRate(playerId: string): CheatDetectionResult {
  const now = Date.now()
  const actions = recentActions.get(playerId) || []
  
  // Keep only last second of actions
  const recent = actions.filter(t => now - t < 1000)
  
  if (recent.length >= MAX_ACTIONS_PER_SECOND) {
    return {
      flagged: true,
      reason: `Action rate too high: ${recent.length} actions per second`,
      severity: 'suspicious',
      details: { actionsPerSecond: recent.length }
    }
  }
  
  // Add current action
  recent.push(now)
  recentActions.set(playerId, recent)
  
  return { flagged: false, severity: 'warning' }
}

// Track player action
export function trackAction(playerId: string, actionType: string): void {
  let stats = playerStats.get(playerId)
  if (!stats) {
    stats = {
      playerId,
      actionsPerMinute: 0,
      unitsProduced: 0,
      buildingsBuilt: 0,
      resourcesGathered: 0,
      damageDealt: 0,
      unitsKilled: 0,
      buildingsDestroyed: 0,
      actions: []
    }
    playerStats.set(playerId, stats)
  }
  
  stats.actions.push({
    timestamp: Date.now(),
    type: actionType,
    suspicious: false
  })
  
  // Keep only last 1000 actions
  if (stats.actions.length > 1000) {
    stats.actions = stats.actions.slice(-1000)
  }
}

// Get player stats
export function getPlayerStats(playerId: string): PlayerStats | null {
  return playerStats.get(playerId) || null
}

// Analyze player behavior for suspicious patterns
export function analyzePlayerBehavior(playerId: string): CheatDetectionResult {
  const stats = playerStats.get(playerId)
  if (!stats) {
    return { flagged: false, severity: 'warning' }
  }
  
  const now = Date.now()
  const oneMinuteAgo = now - 60000
  
  // Count recent actions
  const recentActions = stats.actions.filter(a => a.timestamp > oneMinuteAgo)
  const actionsPerMinute = recentActions.length
  
  if (actionsPerMinute > MAX_ACTIONS_PER_MINUTE * 2) {
    return {
      flagged: true,
      reason: `Extremely high action rate: ${actionsPerMinute} actions/minute`,
      severity: 'confirmed',
      details: { actionsPerMinute }
    }
  }
  
  if (actionsPerMinute > MAX_ACTIONS_PER_MINUTE) {
    return {
      flagged: true,
      reason: `High action rate: ${actionsPerMinute} actions/minute`,
      severity: 'suspicious',
      details: { actionsPerMinute }
    }
  }
  
  return { flagged: false, severity: 'warning' }
}

// Check for invalid unit stats
export function validateUnitStats(
  unit: Unit,
  expectedStats: {
    hp: number
    damage: number
    range: number
    speed: number
  }
): CheatDetectionResult {
  if (unit.hp > expectedStats.hp * 1.5) {
    return {
      flagged: true,
      reason: `Unit HP too high: ${unit.hp} (expected max ${expectedStats.hp})`,
      severity: 'confirmed',
      details: { actualHp: unit.hp, expectedHp: expectedStats.hp }
    }
  }
  
  if (unit.attackDamage > expectedStats.damage * 2) {
    return {
      flagged: true,
      reason: `Unit damage too high: ${unit.attackDamage} (expected max ${expectedStats.damage})`,
      severity: 'confirmed',
      details: { actualDamage: unit.attackDamage, expectedDamage: expectedStats.damage }
    }
  }
  
  if (unit.attackRange > expectedStats.range * 2 && expectedStats.range > 0) {
    return {
      flagged: true,
      reason: `Unit range too high: ${unit.attackRange} (expected max ${expectedStats.range})`,
      severity: 'suspicious',
      details: { actualRange: unit.attackRange, expectedRange: expectedStats.range }
    }
  }
  
  if (unit.moveSpeed > expectedStats.speed * 1.5) {
    return {
      flagged: true,
      reason: `Unit speed too high: ${unit.moveSpeed} (expected max ${expectedStats.speed})`,
      severity: 'confirmed',
      details: { actualSpeed: unit.moveSpeed, expectedSpeed: expectedStats.speed }
    }
  }
  
  return { flagged: false, severity: 'warning' }
}

// Clean up old stats
export function cleanupStats(): void {
  const now = Date.now()
  const maxAge = 3600000 // 1 hour
  
  for (const [playerId, stats] of playerStats.entries()) {
    const lastAction = stats.actions[stats.actions.length - 1]
    if (lastAction && now - lastAction.timestamp > maxAge) {
      playerStats.delete(playerId)
    }
  }
  
  // Clean up recent actions
  for (const [playerId, actions] of recentActions.entries()) {
    const recent = actions.filter(t => now - t < 1000)
    if (recent.length === 0) {
      recentActions.delete(playerId)
    } else {
      recentActions.set(playerId, recent)
    }
  }
}

// Run cleanup every 5 minutes
setInterval(cleanupStats, 300000)

// Log cheat detection (would connect to a logging service in production)
export function logCheatDetection(
  playerId: string,
  result: CheatDetectionResult,
  context?: any
): void {
  if (result.flagged) {
    console.warn(`[ANTI-CHEAT] ${result.severity.toUpperCase()}: Player ${playerId} - ${result.reason}`, {
      ...result.details,
      ...context
    })
  }
}
