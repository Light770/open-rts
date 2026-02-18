// Action Validator - Server-side validation for multiplayer actions
// This ensures all actions are valid before processing

import { 
  ActionType, 
  UnitType, 
  BuildingType, 
  UNIT_STATS, 
  BUILDING_STATS,
  PlayerResources,
  Position 
} from './types'

export interface ValidationResult {
  valid: boolean
  reason?: string
  details?: any
}

// Rate limiting configuration
interface RateLimitConfig {
  maxActionsPerSecond: number
  maxActionsPerMinute: number
}

const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  maxActionsPerSecond: 10,
  maxActionsPerMinute: 300
}

interface PlayerRateLimit {
  actionCount: number
  minuteCount: number
  lastActionTime: number
  recentActions: number[]
}

const playerRateLimits = new Map<string, PlayerRateLimit>()

// Rate limiting for a player
export function checkRateLimit(playerId: string, config: RateLimitConfig = DEFAULT_RATE_LIMIT): ValidationResult {
  const now = Date.now()
  let rateLimit = playerRateLimits.get(playerId)
  
  if (!rateLimit) {
    rateLimit = {
      actionCount: 0,
      minuteCount: 0,
      lastActionTime: now,
      recentActions: []
    }
    playerRateLimits.set(playerId, rateLimit)
  }
  
  // Clean old actions from recentActions (keep last 1 second)
  rateLimit.recentActions = rateLimit.recentActions.filter(t => now - t < 1000)
  
  // Check per-second limit
  if (rateLimit.recentActions.length >= config.maxActionsPerSecond) {
    return { 
      valid: false, 
      reason: 'Rate limit exceeded: too many actions per second' 
    }
  }
  
  // Check per-minute limit
  if (rateLimit.minuteCount >= config.maxActionsPerMinute) {
    return { 
      valid: false, 
      reason: 'Rate limit exceeded: too many actions per minute' 
    }
  }
  
  // Update counters
  rateLimit.recentActions.push(now)
  
  // Reset minute counter if needed
  if (now - rateLimit.lastActionTime >= 60000) {
    rateLimit.minuteCount = 0
    rateLimit.lastActionTime = now
  }
  
  rateLimit.minuteCount++
  
  return { valid: true }
}

// Clean up stale rate limit data
export function cleanupRateLimits(): void {
  const now = Date.now()
  for (const [playerId, rateLimit] of playerRateLimits.entries()) {
    if (now - rateLimit.lastActionTime > 300000) {
      playerRateLimits.delete(playerId)
    }
  }
}

// Type guards for ActionType
function isMoveAction(action: ActionType): action is ActionType & { type: 'move'; unitId: string; target: Position } {
  return action.type === 'move'
}

function isAttackMoveAction(action: ActionType): action is ActionType & { type: 'attackMove'; unitId: string; target: Position } {
  return action.type === 'attackMove'
}

function isPatrolAction(action: ActionType): action is ActionType & { type: 'patrol'; unitId: string; target: Position } {
  return action.type === 'patrol'
}

function isAttackGroundAction(action: ActionType): action is ActionType & { type: 'attackGround'; unitId: string; target: Position } {
  return action.type === 'attackGround'
}

function isAttackAction(action: ActionType): action is ActionType & { type: 'attack'; unitId: string; targetId: string } {
  return action.type === 'attack'
}

function isStopAction(action: ActionType): action is ActionType & { type: 'stop'; unitId: string } {
  return action.type === 'stop'
}

function isHoldPositionAction(action: ActionType): action is ActionType & { type: 'holdPosition'; unitId: string } {
  return action.type === 'holdPosition'
}

function isProduceAction(action: ActionType): action is ActionType & { type: 'produce'; buildingId: string; unitType: UnitType } {
  return action.type === 'produce'
}

function isBuildAction(action: ActionType): action is ActionType & { type: 'build'; buildingType: BuildingType; position: Position } {
  return action.type === 'build'
}

function isUpgradeAction(action: ActionType): action is ActionType & { type: 'upgrade'; buildingId: string; upgradeType: 'attack' | 'defense' | 'range' } {
  return action.type === 'upgrade'
}

function isGatherAction(action: ActionType): action is ActionType & { type: 'gather'; unitId: string; resourceId: string } {
  return action.type === 'gather'
}

function isReturnResourcesAction(action: ActionType): action is ActionType & { type: 'returnResources'; unitId: string } {
  return action.type === 'returnResources'
}

function isCancelProductionAction(action: ActionType): action is ActionType & { type: 'cancelProduction'; buildingId: string; queueItemId: string } {
  return action.type === 'cancelProduction'
}

function isSetRallyPointAction(action: ActionType): action is ActionType & { type: 'setRallyPoint'; buildingId: string; position: Position } {
  return action.type === 'setRallyPoint'
}

// Validate action based on game state
export function validateAction(
  action: ActionType,
  playerId: string,
  playerResources: PlayerResources,
  ownedUnitIds: Set<string>,
  ownedBuildingIds: Set<string>,
  gameState?: {
    mapWidth: number
    mapHeight: number
    units: Map<string, any>
    buildings: Map<string, any>
    resources?: Map<string, any>
  }
): ValidationResult {
  // Movement actions
  if (isMoveAction(action) || isAttackMoveAction(action) || isPatrolAction(action) || isAttackGroundAction(action)) {
    return validateMovementAction(action, ownedUnitIds, gameState)
  }
  
  // Attack action
  if (isAttackAction(action)) {
    return validateAttackAction(action, ownedUnitIds, gameState)
  }
  
  // Stop/Hold actions
  if (isStopAction(action) || isHoldPositionAction(action)) {
    return validateStopAction(action, ownedUnitIds)
  }
  
  // Produce action
  if (isProduceAction(action)) {
    return validateProduceAction(action, ownedBuildingIds, playerResources)
  }
  
  // Build action
  if (isBuildAction(action)) {
    return validateBuildAction(action, playerResources, gameState)
  }
  
  // Upgrade action
  if (isUpgradeAction(action)) {
    return validateUpgradeAction(action, ownedBuildingIds, playerResources)
  }
  
  // Gather action
  if (isGatherAction(action)) {
    return validateGatherAction(action, ownedUnitIds, gameState)
  }
  
  // Return resources action
  if (isReturnResourcesAction(action)) {
    return validateReturnResourcesAction(action, ownedUnitIds)
  }
  
  // Cancel production action
  if (isCancelProductionAction(action)) {
    return validateCancelProductionAction(action, ownedBuildingIds)
  }
  
  // Set rally point action
  if (isSetRallyPointAction(action)) {
    return validateSetRallyPointAction(action, ownedBuildingIds)
  }
  
  return { valid: false, reason: 'Unknown action type' }
}

function validateMovementAction(
  action: ActionType & { unitId: string; target: Position },
  ownedUnitIds: Set<string>,
  gameState?: any
): ValidationResult {
  if (!action.unitId) {
    return { valid: false, reason: 'Missing unit ID' }
  }
  
  if (!ownedUnitIds.has(action.unitId)) {
    return { valid: false, reason: 'Unit not owned by player' }
  }
  
  if (!action.target || typeof action.target.x !== 'number' || typeof action.target.y !== 'number') {
    return { valid: false, reason: 'Invalid target position' }
  }
  
  if (gameState) {
    if (action.target.x < 0 || action.target.x > gameState.mapWidth ||
        action.target.y < 0 || action.target.y > gameState.mapHeight) {
      return { valid: false, reason: 'Target position out of bounds' }
    }
  }
  
  return { valid: true }
}

function validateAttackAction(
  action: ActionType & { unitId: string; targetId: string },
  ownedUnitIds: Set<string>,
  gameState?: any
): ValidationResult {
  if (!action.unitId) {
    return { valid: false, reason: 'Missing unit ID' }
  }
  
  if (!ownedUnitIds.has(action.unitId)) {
    return { valid: false, reason: 'Unit not owned by player' }
  }
  
  if (!action.targetId) {
    return { valid: false, reason: 'Missing target ID' }
  }
  
  if (gameState) {
    const targetUnit = gameState.units.get(action.targetId)
    const targetBuilding = gameState.buildings.get(action.targetId)
    
    if (!targetUnit && !targetBuilding) {
      return { valid: false, reason: 'Target not found' }
    }
    
    if (targetUnit && targetUnit.ownerId === action.unitId.split('-')[0]) {
      return { valid: false, reason: 'Cannot attack own units' }
    }
  }
  
  return { valid: true }
}

function validateStopAction(
  action: ActionType & { unitId: string },
  ownedUnitIds: Set<string>
): ValidationResult {
  if (!action.unitId) {
    return { valid: false, reason: 'Missing unit ID' }
  }
  
  if (!ownedUnitIds.has(action.unitId)) {
    return { valid: false, reason: 'Unit not owned by player' }
  }
  
  return { valid: true }
}

function validateProduceAction(
  action: ActionType & { buildingId: string; unitType: UnitType },
  ownedBuildingIds: Set<string>,
  playerResources: PlayerResources
): ValidationResult {
  if (!action.buildingId) {
    return { valid: false, reason: 'Missing building ID' }
  }
  
  if (!ownedBuildingIds.has(action.buildingId)) {
    return { valid: false, reason: 'Building not owned by player' }
  }
  
  if (!action.unitType || !UNIT_STATS[action.unitType]) {
    return { valid: false, reason: 'Invalid unit type' }
  }
  
  const stats = UNIT_STATS[action.unitType]
  
  if (playerResources.gold < stats.cost.gold || playerResources.wood < stats.cost.wood) {
    return { valid: false, reason: 'Insufficient resources' }
  }
  
  if (playerResources.supply >= playerResources.maxSupply) {
    return { valid: false, reason: 'Insufficient supply' }
  }
  
  return { valid: true }
}

function validateBuildAction(
  action: ActionType & { buildingType: BuildingType; position: Position },
  playerResources: PlayerResources,
  gameState?: any
): ValidationResult {
  if (!action.buildingType || !BUILDING_STATS[action.buildingType]) {
    return { valid: false, reason: 'Invalid building type' }
  }
  
  if (!action.position || typeof action.position.x !== 'number' || typeof action.position.y !== 'number') {
    return { valid: false, reason: 'Invalid build position' }
  }
  
  const stats = BUILDING_STATS[action.buildingType]
  
  if (playerResources.gold < stats.cost.gold || playerResources.wood < stats.cost.wood) {
    return { valid: false, reason: 'Insufficient resources' }
  }
  
  if (gameState) {
    const halfSize = stats.size / 2
    if (action.position.x - halfSize < 0 || action.position.x + halfSize > gameState.mapWidth ||
        action.position.y - halfSize < 0 || action.position.y + halfSize > gameState.mapHeight) {
      return { valid: false, reason: 'Build position out of bounds' }
    }
    
    for (const building of gameState.buildings.values()) {
      const dx = building.x - action.position.x
      const dy = building.y - action.position.y
      const dist = Math.sqrt(dx * dx + dy * dy)
      
      if (dist < (building.size + stats.size) / 2 + 10) {
        return { valid: false, reason: 'Cannot build here: too close to another building' }
      }
    }
  }
  
  return { valid: true }
}

function validateUpgradeAction(
  action: ActionType & { buildingId: string; upgradeType: 'attack' | 'defense' | 'range' },
  ownedBuildingIds: Set<string>,
  playerResources: PlayerResources
): ValidationResult {
  if (!action.buildingId) {
    return { valid: false, reason: 'Missing building ID' }
  }
  
  if (!ownedBuildingIds.has(action.buildingId)) {
    return { valid: false, reason: 'Building not owned by player' }
  }
  
  if (!['attack', 'defense', 'range'].includes(action.upgradeType)) {
    return { valid: false, reason: 'Invalid upgrade type' }
  }
  
  if (playerResources.gold < 100) {
    return { valid: false, reason: 'Insufficient resources (need 100 gold)' }
  }
  
  return { valid: true }
}

function validateGatherAction(
  action: ActionType & { unitId: string; resourceId: string },
  ownedUnitIds: Set<string>,
  gameState?: any
): ValidationResult {
  if (!action.unitId) {
    return { valid: false, reason: 'Missing unit ID' }
  }
  
  if (!ownedUnitIds.has(action.unitId)) {
    return { valid: false, reason: 'Unit not owned by player' }
  }
  
  if (!action.resourceId) {
    return { valid: false, reason: 'Missing resource ID' }
  }
  
  if (gameState?.resources) {
    const resource = Array.from(gameState.resources.values())
      .find((r: any) => r.id === action.resourceId)
    
    if (!resource) {
      return { valid: false, reason: 'Resource not found' }
    }
  }
  
  return { valid: true }
}

function validateReturnResourcesAction(
  action: ActionType & { unitId: string },
  ownedUnitIds: Set<string>
): ValidationResult {
  if (!action.unitId) {
    return { valid: false, reason: 'Missing unit ID' }
  }
  
  if (!ownedUnitIds.has(action.unitId)) {
    return { valid: false, reason: 'Unit not owned by player' }
  }
  
  return { valid: true }
}

function validateCancelProductionAction(
  action: ActionType & { buildingId: string; queueItemId: string },
  ownedBuildingIds: Set<string>
): ValidationResult {
  if (!action.buildingId) {
    return { valid: false, reason: 'Missing building ID' }
  }
  
  if (!ownedBuildingIds.has(action.buildingId)) {
    return { valid: false, reason: 'Building not owned by player' }
  }
  
  if (!action.queueItemId) {
    return { valid: false, reason: 'Missing queue item ID' }
  }
  
  return { valid: true }
}

function validateSetRallyPointAction(
  action: ActionType & { buildingId: string; position: Position },
  ownedBuildingIds: Set<string>
): ValidationResult {
  if (!action.buildingId) {
    return { valid: false, reason: 'Missing building ID' }
  }
  
  if (!ownedBuildingIds.has(action.buildingId)) {
    return { valid: false, reason: 'Building not owned by player' }
  }
  
  if (!action.position || typeof action.position.x !== 'number' || typeof action.position.y !== 'number') {
    return { valid: false, reason: 'Invalid rally point position' }
  }
  
  return { valid: true }
}

// Validate player resources (anti-cheat)
export function validateResources(
  clientResources: PlayerResources,
  serverResources: PlayerResources,
  tolerance: number = 10
): ValidationResult {
  if (Math.abs(clientResources.gold - serverResources.gold) > tolerance) {
    return { 
      valid: false, 
      reason: 'Resource mismatch detected',
      details: { client: clientResources.gold, server: serverResources.gold }
    }
  }
  
  if (Math.abs(clientResources.wood - serverResources.wood) > tolerance) {
    return { 
      valid: false, 
      reason: 'Resource mismatch detected',
      details: { client: clientResources.wood, server: serverResources.wood }
    }
  }
  
  return { valid: true }
}
