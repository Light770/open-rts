// Client-side Interpolation - Smooth rendering of game state
// Interpolates between server snapshots for smooth visual output

import { Unit, Building, Projectile, GameSnapshot } from '../game-server/types'

export interface InterpolatedState {
  units: Map<string, InterpolatedUnit>
  buildings: Map<string, InterpolatedBuilding>
  projectiles: InterpolatedProjectile[]
  tick: number
  timestamp: number
}

export interface InterpolatedUnit {
  id: string
  x: number
  y: number
  hp: number
  state: string
  targetX?: number
  targetY?: number
}

export interface InterpolatedBuilding {
  id: string
  x: number
  y: number
  hp: number
  progress?: number
}

export interface InterpolatedProjectile {
  id: string
  x: number
  y: number
  targetX: number
  targetY: number
}

export interface InterpolationConfig {
  interpolationDelay: number // ms to delay for smoothing
  snapDistance: number // Distance threshold to snap instead of interpolate
}

const DEFAULT_CONFIG: InterpolationConfig = {
  interpolationDelay: 100,
  snapDistance: 500
}

// Interpolation state
let previousSnapshot: GameSnapshot | null = null
let nextSnapshot: GameSnapshot | null = null
let interpolationStartTime: number = 0
let interpolationFactor: number = 0

const interpolatedUnits = new Map<string, InterpolatedUnit>()
const interpolatedBuildings = new Map<string, InterpolatedBuilding>()
const interpolatedProjectiles: InterpolatedProjectile[] = []

// Update snapshots for interpolation
export function updateSnapshots(snapshot: GameSnapshot): void {
  previousSnapshot = nextSnapshot
  nextSnapshot = snapshot
  interpolationStartTime = Date.now()
}

// Calculate interpolation factor (0-1)
function calculateInterpolationFactor(): number {
  if (!previousSnapshot || !nextSnapshot) return 1
  
  const elapsed = Date.now() - interpolationStartTime
  const snapshotDelta = nextSnapshot.timestamp - (previousSnapshot?.timestamp || nextSnapshot.timestamp)
  
  if (snapshotDelta <= 0) return 1
  
  // Factor with delay
  const factor = elapsed / (snapshotDelta + 100) // +100ms for smoothing
  
  return Math.min(1, Math.max(0, factor))
}

// Linear interpolation
function lerp(start: number, end: number, factor: number): number {
  return start + (end - start) * factor
}

// Get interpolated state
export function getInterpolatedState(): InterpolatedState {
  interpolationFactor = calculateInterpolationFactor()
  
  if (!nextSnapshot) {
    return {
      units: interpolatedUnits,
      buildings: interpolatedBuildings,
      projectiles: interpolatedProjectiles,
      tick: 0,
      timestamp: Date.now()
    }
  }
  
  // Interpolate units
  for (const unit of nextSnapshot.units) {
    let x = unit.x
    let y = unit.y
    
    if (previousSnapshot) {
      const prevUnit = previousSnapshot.units.find(u => u.id === unit.id)
      if (prevUnit) {
        // Check if unit teleported (too far to interpolate)
        const dx = unit.x - prevUnit.x
        const dy = unit.y - prevUnit.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        
        if (dist > DEFAULT_CONFIG.snapDistance) {
          // Snap to new position
          x = unit.x
          y = unit.y
        } else {
          // Interpolate
          x = lerp(prevUnit.x, unit.x, interpolationFactor)
          y = lerp(prevUnit.y, unit.y, interpolationFactor)
        }
      }
    }
    
    interpolatedUnits.set(unit.id, {
      id: unit.id,
      x,
      y,
      hp: unit.hp,
      state: unit.state,
      targetX: unit.targetPosition?.x,
      targetY: unit.targetPosition?.y
    })
  }
  
  // Remove units that no longer exist
  for (const [id] of interpolatedUnits) {
    if (!nextSnapshot.units.find(u => u.id === id)) {
      interpolatedUnits.delete(id)
    }
  }
  
  // Interpolate buildings
  for (const building of nextSnapshot.buildings) {
    let x = building.x
    let y = building.y
    
    if (previousSnapshot) {
      const prevBuilding = previousSnapshot.buildings.find(b => b.id === building.id)
      if (prevBuilding) {
        x = lerp(prevBuilding.x, building.x, interpolationFactor)
        y = lerp(prevBuilding.y, building.y, interpolationFactor)
      }
    }
    
    interpolatedBuildings.set(building.id, {
      id: building.id,
      x,
      y,
      hp: building.hp,
      progress: building.progress
    })
  }
  
  // Remove buildings that no longer exist
  for (const [id] of interpolatedBuildings) {
    if (!nextSnapshot.buildings.find(b => b.id === id)) {
      interpolatedBuildings.delete(id)
    }
  }
  
  // Interpolate projectiles (simplified - just use current position)
  interpolatedProjectiles.length = 0
  for (const proj of nextSnapshot.projectiles) {
    interpolatedProjectiles.push({
      id: proj.id,
      x: proj.x,
      y: proj.y,
      targetX: proj.targetPosition.x,
      targetY: proj.targetPosition.y
    })
  }
  
  return {
    units: interpolatedUnits,
    buildings: interpolatedBuildings,
    projectiles: interpolatedProjectiles,
    tick: nextSnapshot.tick,
    timestamp: Date.now()
  }
}

// Predict unit position based on velocity
export function predictUnitPosition(
  unit: InterpolatedUnit,
  deltaTime: number
): { x: number; y: number } {
  if (!unit.targetX || !unit.targetY) {
    return { x: unit.x, y: unit.y }
  }
  
  const dx = unit.targetX - unit.x
  const dy = unit.targetY - unit.y
  const dist = Math.sqrt(dx * dx + dy * dy)
  
  if (dist < 5) {
    return { x: unit.x, y: unit.y }
  }
  
  // Assume constant speed (would need actual speed data)
  const speed = 2 // pixels per frame
  
  const factor = Math.min(1, (speed * deltaTime) / dist)
  
  return {
    x: unit.x + dx * factor,
    y: unit.y + dy * factor
  }
}

// Reset interpolation state
export function resetInterpolation(): void {
  previousSnapshot = null
  nextSnapshot = null
  interpolationStartTime = 0
  interpolationFactor = 0
  interpolatedUnits.clear()
  interpolatedBuildings.clear()
  interpolatedProjectiles.length = 0
}

// Get latency estimate based on snapshot timing
export function getLatencyEstimate(): number {
  if (!previousSnapshot || !nextSnapshot) return 0
  
  return nextSnapshot.timestamp - (previousSnapshot?.timestamp || 0)
}

// Extrapolate state for high-latency scenarios
export function extrapolateState(
  state: InterpolatedState,
  latencyMs: number
): InterpolatedState {
  // Only extrapolate if latency is high
  if (latencyMs < 200) return state
  
  const extrapolationFactor = latencyMs / 1000 // seconds
  
  const extrapolatedUnits = new Map<string, InterpolatedUnit>()
  
  for (const [id, unit] of state.units) {
    if (unit.targetX !== undefined && unit.targetY !== undefined) {
      const dx = unit.targetX - unit.x
      const dy = unit.targetY - unit.y
      const dist = Math.sqrt(dx * dx + dy * dy)
      
      if (dist > 5) {
        // Move towards target
        const speed = 2 * extrapolationFactor
        const factor = Math.min(1, speed / dist)
        
        extrapolatedUnits.set(id, {
          ...unit,
          x: unit.x + dx * factor,
          y: unit.y + dy * factor
        })
      } else {
        extrapolatedUnits.set(id, unit)
      }
    } else {
      extrapolatedUnits.set(id, unit)
    }
  }
  
  return {
    ...state,
    units: extrapolatedUnits
  }
}
