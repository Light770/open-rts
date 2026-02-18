// Game Engine - Authoritative Server Core
// This module handles all game simulation on the server

import {
  Unit, Building, Resource, Projectile,
  Player, GameState, GameMap, GameSnapshot,
  Position, UnitType, BuildingType, TileType, ActionType,
  UNIT_STATS, BUILDING_STATS, VISION_RANGE, TICK_RATE,
  DiscoveredTile
} from './types'

// Generate unique IDs
let idCounter = 0
export function generateId(): string {
  return `${Date.now()}-${idCounter++}-${Math.random().toString(36).substring(2, 9)}`
}

export class GameEngine {
  private tick: number = 0
  private map: GameMap
  private units: Map<string, Unit> = new Map()
  private buildings: Map<string, Building> = new Map()
  private resources: Map<string, Resource> = new Map()
  private projectiles: Projectile[] = []
  private players: Map<string, Player> = new Map()
  private discoveredTiles: Map<string, DiscoveredTile[]> = new Map()
  private gameOver: boolean = false
  private winner: string | null = null
  private winnerReason: string | null = null
  private difficulty: 'easy' | 'normal' | 'hard' = 'normal'

  // AI state for single player
  private aiEnabled: boolean = false
  private aiPlayerId: string | null = null

  constructor(mapSeed: number, difficulty: 'easy' | 'normal' | 'hard' = 'normal') {
    this.difficulty = difficulty
    this.map = this.generateMap(mapSeed)
  }

  // ====================
  // Initialization
  // ====================

  private generateMap(seed: number): GameMap {
    // Simplified WFC-like map generation
    const width = 60
    const height = 60
    const tileSize = 40
    const tiles: TileType[][] = []
    const resources: Resource[] = []

    // Simple seeded random
    const random = this.seededRandom(seed)

    // Generate terrain
    for (let y = 0; y < height; y++) {
      tiles[y] = []
      for (let x = 0; x < width; x++) {
        // Force grass at spawn areas
        const isPlayerSpawn = (x < 5 && y < 5)
        const isEnemySpawn = (x > 54 && y > 54)

        if (isPlayerSpawn || isEnemySpawn) {
          tiles[y][x] = 'grass'
        } else {
          // Random terrain
          const r = random()
          if (r < 0.5) tiles[y][x] = 'grass'
          else if (r < 0.7) tiles[y][x] = 'forest'
          else if (r < 0.85) tiles[y][x] = 'dirt'
          else if (r < 0.92) tiles[y][x] = 'sand'
          else if (r < 0.96) tiles[y][x] = 'gold'
          else tiles[y][x] = 'water'
        }
      }
    }

    // Add resources
    const numGoldMines = 20 + Math.floor(random() * 10)
    const numForests = 30 + Math.floor(random() * 15)

    for (let i = 0; i < numGoldMines; i++) {
      const x = Math.floor(random() * (width - 4)) + 2
      const y = Math.floor(random() * (height - 4)) + 2
      if (tiles[y][x] !== 'grass') {
        tiles[y][x] = 'gold'
        resources.push({
          id: generateId(),
          type: 'gold',
          x: x * tileSize + tileSize / 2,
          y: y * tileSize + tileSize / 2,
          amount: 1500 + Math.floor(random() * 1500),
          maxAmount: 3000
        })
      }
    }

    for (let i = 0; i < numForests; i++) {
      const x = Math.floor(random() * (width - 4)) + 2
      const y = Math.floor(random() * (height - 4)) + 2
      if (tiles[y][x] !== 'grass' && tiles[y][x] !== 'gold') {
        tiles[y][x] = 'forest'
        resources.push({
          id: generateId(),
          type: 'wood',
          x: x * tileSize + tileSize / 2,
          y: y * tileSize + tileSize / 2,
          amount: 800 + Math.floor(random() * 700),
          maxAmount: 1500
        })
      }
    }

    return { width, height, tileSize, tiles, resources }
  }

  private seededRandom(seed: number): () => number {
    let s = seed
    return () => {
      s = (s * 9301 + 49297) % 233280
      return s / 233280
    }
  }

  // ====================
  // Player Management
  // ====================

  addPlayer(id: string, name: string, team: 'host' | 'guest', color: string): void {
    this.players.set(id, {
      id,
      name,
      team,
      color,
      resources: {
        gold: team === 'host' ? 200 : 200,
        wood: team === 'host' ? 100 : 100,
        supply: 5,
        maxSupply: 10
      },
      upgrades: { attack: 0, defense: 0, range: 0 },
      ready: false
    })
    this.discoveredTiles.set(id, [])
  }

  addAIPlayer(id: string): void {
    this.aiEnabled = true
    this.aiPlayerId = id
    this.players.set(id, {
      id,
      name: 'Enemy AI',
      team: 'guest',
      color: '#DC143C',
      resources: {
        gold: 300,
        wood: 150,
        supply: 4,
        maxSupply: 10
      },
      upgrades: { attack: 0, defense: 0, range: 0 },
      ready: true
    })
    this.discoveredTiles.set(id, [])

    // Create AI buildings
    this.createBuildingAtPosition('base', id, 88, 88)
    this.createBuildingAtPosition('barracks', id, 85, 85)
  }

  private createBuildingAtPosition(type: BuildingType, ownerId: string, tileX: number, tileY: number): void {
    const stats = BUILDING_STATS[type]
    const x = tileX * this.map.tileSize + this.map.tileSize / 2
    const y = tileY * this.map.tileSize + this.map.tileSize / 2

    const building: Building = {
      id: generateId(),
      ownerId,
      x,
      y,
      hp: stats.hp,
      maxHp: stats.hp,
      size: stats.size,
      type,
      progress: type === 'base' ? 100 : 10,
      productionQueue: [],
      rallyPoint: null,
      isUnderAttack: false,
      lastAttackTime: 0
    }

    this.buildings.set(building.id, building)

    // Add supply if building provides it
    if (stats.supply) {
      const player = this.players.get(ownerId)
      if (player) {
        player.resources.maxSupply += stats.supply
      }
    }
  }

  // ====================
  // Game Start
  // ====================

  initializeGame(): void {
    // Create host player base at 12% position
    const hostPlayer = Array.from(this.players.values()).find(p => p.team === 'host')
    if (hostPlayer) {
      this.createBuildingAtPosition('base', hostPlayer.id, 12 * 0.6, 12 * 0.6)
    }

    // If AI enabled, create enemy base
    if (this.aiEnabled && this.aiPlayerId) {
      this.createBuildingAtPosition('base', this.aiPlayerId, 88 * 0.6, 88 * 0.6)
    }

    // Give starting workers
    if (hostPlayer) {
      this.spawnUnit('worker', hostPlayer.id)
      this.spawnUnit('worker', hostPlayer.id)
      this.spawnUnit('worker', hostPlayer.id)
    }

    if (this.aiEnabled && this.aiPlayerId) {
      this.spawnUnit('worker', this.aiPlayerId)
      this.spawnUnit('worker', this.aiPlayerId)
    }
  }

  // ====================
  // Main Game Loop
  // ====================

  update(deltaTime: number): void {
    if (this.gameOver) return

    this.tick++

    // Update all systems
    this.updateUnits()
    this.updateBuildings()
    this.updateProjectiles()
    this.updateEconomy()
    this.updateFogOfWar()
    this.checkWinCondition()

    // AI logic if enabled
    if (this.aiEnabled && this.tick % 60 === 0) {
      this.updateAI()
    }
  }

  // ====================
  // Unit Updates
  // ====================

  private updateUnits(): void {
    for (const unit of this.units.values()) {
      const stats = UNIT_STATS[unit.type]

      // Reduce cooldown
      if (unit.attackCooldownRemaining > 0) {
        unit.attackCooldownRemaining--
      }

      // Handle state
      switch (unit.state) {
        case 'moving':
        case 'attackMove':
          this.updateUnitMovement(unit)
          break
        case 'attacking':
          this.updateUnitAttack(unit)
          break
        case 'gathering':
          this.updateUnitGather(unit)
          break
        case 'returning':
          this.updateUnitReturn(unit)
          break
        case 'building':
          this.updateUnitBuild(unit)
          break
        case 'healing':
          this.updateUnitHeal(unit)
          break
      }
    }
  }

  private updateUnitMovement(unit: Unit): void {
    const target = unit.targetPosition || (unit.targetId ? this.getUnitPosition(unit.targetId) : null)
    if (!target) {
      unit.state = 'idle'
      return
    }

    const dx = target.x - unit.x
    const dy = target.y - unit.y
    const dist = Math.sqrt(dx * dx + dy * dy)

    if (dist < 5) {
      // Reached target
      if (unit.state === 'attackMove') {
        // Find nearest enemy to attack
        const enemy = this.findNearestEnemy(unit)
        if (enemy) {
          unit.state = 'attacking'
          unit.targetId = enemy.id
        } else {
          unit.state = 'idle'
        }
      } else {
        unit.state = 'idle'
      }
      unit.targetPosition = null
      return
    }

    // Move towards target
    const speed = UNIT_STATS[unit.type].speed
    unit.x += (dx / dist) * speed
    unit.y += (dy / dist) * speed

    // Attack move: attack enemies along the way
    if (unit.state === 'attackMove') {
      const enemy = this.findNearestEnemyInRange(unit)
      if (enemy) {
        unit.state = 'attacking'
        unit.targetId = enemy.id
      }
    }
  }

  private updateUnitAttack(unit: Unit): void {
    if (!unit.targetId) {
      unit.state = 'idle'
      return
    }

    const target = this.units.get(unit.targetId) || this.buildings.get(unit.targetId)
    if (!target || target.ownerId === unit.ownerId) {
      unit.state = 'idle'
      unit.targetId = null
      return
    }

    const dx = target.x - unit.x
    const dy = target.y - unit.y
    const dist = Math.sqrt(dx * dx + dy * dy)
    const stats = UNIT_STATS[unit.type]
    const player = this.players.get(unit.ownerId)

    // Check if in range
    if (dist > stats.range) {
      // Move towards target
      unit.x += (dx / dist) * stats.speed
      unit.y += (dy / dist) * stats.speed
      return
    }

    // Attack if cooldown ready
    if (unit.attackCooldownRemaining <= 0) {
      // Create projectile or instant damage
      if (unit.type === 'archer' || unit.type === 'catapult' || this.isTower(target)) {
        this.createProjectile(unit, target)
      } else {
        // Melee instant damage
        const damage = this.calculateDamage(unit, target)
        target.hp -= damage
        target.isUnderAttack = true
      }

      unit.attackCooldownRemaining = unit.attackCooldown
    }
  }

  private updateUnitGather(unit: Unit): void {
    if (!unit.targetId) {
      unit.state = 'idle'
      return
    }

    const resource = this.resources.get(unit.targetId)
    if (!resource) {
      unit.state = 'idle'
      unit.targetId = null
      return
    }

    const dx = resource.x - unit.x
    const dy = resource.y - unit.y
    const dist = Math.sqrt(dx * dx + dy * dy)

    if (dist > 20) {
      // Move towards resource
      unit.x += (dx / dist) * UNIT_STATS[unit.type].speed
      unit.y += (dy / dist) * UNIT_STATS[unit.type].speed
      return
    }

    // Gather
    const gatherAmount = UNIT_STATS[unit.type].gatherAmount || 8
    if (resource.amount > 0) {
      // Store in unit (simplified - just add to player immediately)
      const player = this.players.get(unit.ownerId)
      if (player) {
        if (resource.type === 'gold') {
          player.resources.gold += Math.min(gatherAmount, resource.amount)
        } else {
          player.resources.wood += Math.min(gatherAmount, resource.amount)
        }
      }
      resource.amount -= Math.min(gatherAmount, resource.amount)

      // Start returning
      if (resource.amount <= 0) {
        this.resources.delete(resource.id)
        unit.state = 'returning'
        unit.targetId = null
      }
    }
  }

  private updateUnitReturn(unit: Unit): void {
    // Find nearest base or farm
    const depositPoint = this.findNearestDepositPoint(unit)
    if (!depositPoint) {
      unit.state = 'idle'
      return
    }

    const dx = depositPoint.x - unit.x
    const dy = depositPoint.y - unit.y
    const dist = Math.sqrt(dx * dx + dy * dy)

    if (dist > 30) {
      unit.x += (dx / dist) * UNIT_STATS[unit.type].speed
      unit.y += (dy / dist) * UNIT_STATS[unit.type].speed
    } else {
      // Find a new resource to gather
      const resource = this.findNearestResource(unit)
      if (resource) {
        unit.state = 'gathering'
        unit.targetId = resource.id
      } else {
        unit.state = 'idle'
      }
    }
  }

  private updateUnitBuild(unit: Unit): void {
    // Similar to gather but for building construction
    // Simplified: just progress the building
    if (!unit.targetId) {
      unit.state = 'idle'
      return
    }

    const building = this.buildings.get(unit.targetId)
    if (!building || building.progress >= 100) {
      unit.state = 'idle'
      unit.targetId = null
      return
    }

    // Move to building if not close
    const dx = building.x - unit.x
    const dy = building.y - unit.y
    const dist = Math.sqrt(dx * dx + dy * dy)

    if (dist > 40) {
      unit.x += (dx / dist) * UNIT_STATS[unit.type].speed
      unit.y += (dy / dist) * UNIT_STATS[unit.type].speed
      return
    }

    // Build
    building.progress = Math.min(100, building.progress + 2)

    if (building.progress >= 100) {
      unit.state = 'idle'
      unit.targetId = null
    }
  }

  private updateUnitHeal(unit: Unit): void {
    if (!unit.targetId) {
      unit.state = 'idle'
      return
    }

    const target = this.units.get(unit.targetId)
    if (!target || target.ownerId !== unit.ownerId || target.hp >= target.maxHp) {
      unit.state = 'idle'
      unit.targetId = null
      return
    }

    const dx = target.x - unit.x
    const dy = target.y - unit.y
    const dist = Math.sqrt(dx * dx + dy * dy)

    if (dist > UNIT_STATS[unit.type].range) {
      unit.x += (dx / dist) * UNIT_STATS[unit.type].speed
      unit.y += (dy / dist) * UNIT_STATS[unit.type].speed
      return
    }

    if (unit.attackCooldownRemaining <= 0) {
      // Heal (negative damage)
      target.hp = Math.min(target.maxHp, target.hp + 8)
      unit.attackCooldownRemaining = unit.attackCooldown
    }
  }

  // ====================
  // Building Updates
  // ====================

  private updateBuildings(): void {
    for (const building of this.buildings.values()) {
      // Update production queue
      if (building.productionQueue.length > 0) {
        const item = building.productionQueue[0]
        item.progress++

        const stats = UNIT_STATS[item.type]
        if (item.progress >= stats.buildTime) {
          // Unit complete
          this.spawnUnit(item.type, building.ownerId)
          building.productionQueue.shift()
        }
      }

      // Tower attacks
      if (building.type === 'tower' && building.hp > 0) {
        this.updateTowerAttack(building)
      }

      // Reset under attack flag
      if (building.isUnderAttack && Date.now() - building.lastAttackTime > 120) {
        building.isUnderAttack = false
      }
    }
  }

  private updateTowerAttack(building: Building): void {
    const stats = BUILDING_STATS.tower
    if (!stats.attackDamage) return

    // Find nearest enemy in range
    let nearestEnemy: Unit | null = null
    let nearestDist = stats.attackRange || 150

    for (const unit of this.units.values()) {
      if (unit.ownerId === building.ownerId) continue

      const dx = unit.x - building.x
      const dy = unit.y - building.y
      const dist = Math.sqrt(dx * dx + dy * dy)

      if (dist < nearestDist) {
        nearestDist = dist
        nearestEnemy = unit
      }
    }

    if (nearestEnemy) {
      // Fire projectile
      this.createProjectile({
        id: generateId(),
        ownerId: building.ownerId,
        x: building.x,
        y: building.y,
        type: 'worker', // placeholder
        hp: 0,
        maxHp: 0,
        size: 0,
        state: 'idle',
        targetId: nearestEnemy.id,
        targetPosition: null,
        waypoints: [],
        attackRange: 0,
        attackDamage: stats.attackDamage,
        attackCooldown: 60,
        attackCooldownRemaining: 0,
        moveSpeed: 0,
        armor: 0,
        gatherAmount: 0,
        gatherRate: 0,
        isUnderAttack: false
      }, nearestEnemy)
    }
  }

  // ====================
  // Projectile Updates
  // ====================

  private createProjectile(source: Partial<Unit>, target: Unit | Building): void {
    const stats = UNIT_STATS[source.type as UnitType]
    const isSplash = source.type === 'catapult'

    const projectile: Projectile = {
      id: generateId(),
      type: source.type === 'healer' ? 'heal' : (source.type === 'catapult' ? 'boulder' : 'arrow'),
      x: source.x!,
      y: source.y!,
      targetId: target.id,
      targetPosition: { x: target.x, y: target.y },
      speed: source.type === 'catapult' ? 5 : (source.type === 'healer' ? 6 : 8),
      damage: source.attackDamage || 10,
      ownerId: source.ownerId!,
      splashRadius: isSplash ? 50 : 0,
      createdAt: this.tick
    }

    this.projectiles.push(projectile)
  }

  private updateProjectiles(): void {
    const toRemove: string[] = []

    for (const proj of this.projectiles) {
      const target = this.units.get(proj.targetId) || this.buildings.get(proj.targetId)
      if (!target) {
        toRemove.push(proj.id)
        continue
      }

      const dx = target.x - proj.x
      const dy = target.y - proj.y
      const dist = Math.sqrt(dx * dx + dy * dy)

      if (dist < 10) {
        // Hit!
        if (proj.splashRadius > 0) {
          // Splash damage
          this.applySplashDamage(proj)
        } else if (proj.type === 'heal') {
          // Healing
          if (target.ownerId === proj.ownerId && target.hp < target.maxHp) {
            target.hp = Math.min(target.maxHp, target.hp - proj.damage)
          }
        } else {
          // Regular damage
          const damage = this.calculateDamageFromProjectile(proj, target)
          target.hp -= damage
          target.isUnderAttack = true
          target.lastAttackTime = Date.now()
        }

        toRemove.push(proj.id)
        continue
      }

      // Move projectile
      proj.x += (dx / dist) * proj.speed
      proj.y += (dy / dist) * proj.speed
    }

    // Remove hit projectiles
    this.projectiles = this.projectiles.filter(p => !toRemove.includes(p.id))
  }

  private applySplashDamage(proj: Projectile): void {
    const targets = [...Array.from(this.units.values()), ...Array.from(this.buildings.values())]

    for (const target of targets) {
      if (target.ownerId === proj.ownerId) continue

      const dx = target.x - proj.x
      const dy = target.y - proj.y
      const dist = Math.sqrt(dx * dx + dy * dy)

      if (dist <= proj.splashRadius) {
        const falloff = 1 - (dist / proj.splashRadius / 2)
        target.hp -= proj.damage * falloff
        target.isUnderAttack = true
        target.lastAttackTime = Date.now()
      }
    }
  }

  // ====================
  // Economy
  // ====================

  private updateEconomy(): void {
    // AI income (for single player balance)
    if (this.aiEnabled && this.aiPlayerId) {
      const aiPlayer = this.players.get(this.aiPlayerId)
      if (aiPlayer) {
        const incomeMultiplier = this.difficulty === 'easy' ? 0.5 : (this.difficulty === 'hard' ? 1.5 : 1)
        aiPlayer.resources.gold += 0.5 * incomeMultiplier
      }
    }
  }

  // ====================
  // Fog of War
  // ====================

  private updateFogOfWar(): void {
    // Update discovered tiles for each player
    for (const player of this.players.values()) {
      const tiles: DiscoveredTile[] = []
      const playerEntities = [
        ...Array.from(this.units.values()).filter(u => u.ownerId === player.id),
        ...Array.from(this.buildings.values()).filter(b => b.ownerId === player.id)
      ]

      for (const entity of playerEntities) {
        // Check tiles in vision range
        const tileRadius = Math.ceil(VISION_RANGE / this.map.tileSize)

        for (let dy = -tileRadius; dy <= tileRadius; dy++) {
          for (let dx = -tileRadius; dx <= tileRadius; dx++) {
            const tileX = Math.floor(entity.x / this.map.tileSize) + dx
            const tileY = Math.floor(entity.y / this.map.tileSize) + dy

            // Check if within actual vision range
            const dist = Math.sqrt(dx * dx + dy * dy) * this.map.tileSize
            if (dist > VISION_RANGE) continue

            // Check bounds
            if (tileX < 0 || tileX >= this.map.width || tileY < 0 || tileY >= this.map.height) continue

            // Check if tile visible
            if (this.isTileVisible(entity.x, entity.y, tileX, tileY)) {
              tiles.push({ x: tileX, y: tileY, discoveredAt: Date.now() })
            }
          }
        }
      }

      this.discoveredTiles.set(player.id, tiles)
    }
  }

  private isTileVisible(observerX: number, observerY: number, tileX: number, tileY: number): boolean {
    const tileCenterX = tileX * this.map.tileSize + this.map.tileSize / 2
    const tileCenterY = tileY * this.map.tileSize + this.map.tileSize / 2

    const dx = tileCenterX - observerX
    const dy = tileCenterY - observerY
    const dist = Math.sqrt(dx * dx + dy * dy)

    return dist <= VISION_RANGE
  }

  // ====================
  // AI
  // ====================

  private updateAI(): void {
    if (!this.aiEnabled || !this.aiPlayerId) return

    const aiPlayer = this.players.get(this.aiPlayerId)
    if (!aiPlayer) return

    const aiUnits = Array.from(this.units.values()).filter(u => u.ownerId === this.aiPlayerId)
    const aiBuildings = Array.from(this.buildings.values()).filter(b => b.ownerId === this.aiPlayerId)

    // Count workers
    const workers = aiUnits.filter(u => u.type === 'worker')
    const soldiers = aiUnits.filter(u => u.type === 'soldier')

    // Produce workers if we have resources and supply
    if (aiPlayer.resources.gold >= 50 && aiPlayer.resources.supply < aiPlayer.resources.maxSupply) {
      const base = aiBuildings.find(b => b.type === 'base')
      if (base && base.productionQueue.length === 0) {
        this.queueUnitProduction(base.id, 'worker')
      }
    }

    // Produce combat units
    if (aiPlayer.resources.gold >= 60) {
      const barracks = aiBuildings.find(b => b.type === 'barracks')
      if (barracks && barracks.productionQueue.length === 0) {
        const roll = Math.random()
        if (roll < 0.4) {
          this.queueUnitProduction(barracks.id, 'soldier')
        } else if (roll < 0.7) {
          this.queueUnitProduction(barracks.id, 'archer')
        } else {
          this.queueUnitProduction(barracks.id, 'healer')
        }
      }
    }

    // Attack with soldiers
    const hostPlayer = Array.from(this.players.values()).find(p => p.team === 'host')
    if (hostPlayer && soldiers.length >= 3) {
      for (const soldier of soldiers) {
        if (soldier.state === 'idle') {
          // Find player base
          const playerBase = Array.from(this.buildings.values())
            .find(b => b.ownerId === hostPlayer.id && b.type === 'base')
          if (playerBase) {
            soldier.state = 'attackMove'
            soldier.targetId = playerBase.id
          }
        }
      }
    }

    // Gather with workers if idle
    for (const worker of workers) {
      if (worker.state === 'idle') {
        const resource = this.findNearestResource(worker)
        if (resource) {
          worker.state = 'gathering'
          worker.targetId = resource.id
        }
      }
    }
  }

  // ====================
  // Win Condition
  // ====================

  private checkWinCondition(): void {
    if (this.gameOver) return

    const playerIds = Array.from(this.players.keys())

    for (const playerId of playerIds) {
      const playerBases = Array.from(this.buildings.values())
        .filter(b => b.type === 'base' && b.ownerId === playerId)

      if (playerBases.length === 0) {
        // This player has no base, they lose
        const enemyIds = playerIds.filter(id => id !== playerId)
        const enemyBase = enemyIds.map(id =>
          Array.from(this.buildings.values()).find(b => b.type === 'base' && b.ownerId === id)
        ).find(b => b !== undefined)

        this.gameOver = true
        this.winner = enemyBase?.ownerId || null
        this.winnerReason = `${this.players.get(playerId)?.name || 'Player'} eliminated`
        return
      }
    }
  }

  // ====================
  // Action Processing
  // ====================

  processAction(playerId: string, action: ActionType): boolean {
    const player = this.players.get(playerId)
    if (!player) return false

    switch (action.type) {
      case 'move':
        return this.handleMove(playerId, action.unitId, action.target)
      case 'attack':
        return this.handleAttack(playerId, action.unitId, action.targetId)
      case 'stop':
        return this.handleStop(playerId, action.unitId)
      case 'holdPosition':
        return this.handleHoldPosition(playerId, action.unitId)
      case 'patrol':
        return this.handlePatrol(playerId, action.unitId, action.target)
      case 'attackMove':
        return this.handleAttackMove(playerId, action.unitId, action.target)
      case 'produce':
        return this.handleProduce(playerId, action.buildingId, action.unitType)
      case 'build':
        return this.handleBuild(playerId, action.buildingType, action.position)
      case 'upgrade':
        return this.handleUpgrade(playerId, action.buildingId, action.upgradeType)
      case 'gather':
        return this.handleGather(playerId, action.unitId, action.resourceId)
    }

    return false
  }

  private handleMove(playerId: string, unitId: string, target: Position): boolean {
    const unit = this.units.get(unitId)
    if (!unit || unit.ownerId !== playerId) return false

    unit.state = 'moving'
    unit.targetPosition = target
    unit.targetId = null
    return true
  }

  private handleAttack(playerId: string, unitId: string, targetId: string): boolean {
    const unit = this.units.get(unitId)
    if (!unit || unit.ownerId !== playerId) return false

    const target = this.units.get(targetId) || this.buildings.get(targetId)
    if (!target || target.ownerId === playerId) return false

    unit.state = 'attacking'
    unit.targetId = targetId
    unit.targetPosition = null
    return true
  }

  private handleStop(playerId: string, unitId: string): boolean {
    const unit = this.units.get(unitId)
    if (!unit || unit.ownerId !== playerId) return false

    unit.state = 'idle'
    unit.targetId = null
    unit.targetPosition = null
    unit.waypoints = []
    return true
  }

  private handleHoldPosition(playerId: string, unitId: string): boolean {
    // Similar to stop but unit will attack enemies that come in range
    return this.handleStop(playerId, unitId)
  }

  private handlePatrol(playerId: string, unitId: string, target: Position): boolean {
    const unit = this.units.get(unitId)
    if (!unit || unit.ownerId !== playerId) return false

    unit.state = 'patrol'
    unit.waypoints.push(target)
    return true
  }

  private handleAttackMove(playerId: string, unitId: string, target: Position): boolean {
    const unit = this.units.get(unitId)
    if (!unit || unit.ownerId !== playerId) return false

    unit.state = 'attackMove'
    unit.targetPosition = target
    unit.targetId = null
    return true
  }

  private handleProduce(playerId: string, buildingId: string, unitType: UnitType): boolean {
    const building = this.buildings.get(buildingId)
    if (!building || building.ownerId !== playerId) return false

    const stats = UNIT_STATS[unitType]
    const player = this.players.get(playerId)
    if (!player) return false

    // Check resources
    if (player.resources.gold < stats.cost.gold || player.resources.wood < stats.cost.wood) {
      return false
    }

    // Check supply
    const currentSupply = Array.from(this.units.values())
      .filter(u => u.ownerId === playerId).length
    if (currentSupply + stats.supply > player.resources.maxSupply) {
      return false
    }

    // Deduct resources
    player.resources.gold -= stats.cost.gold
    player.resources.wood -= stats.cost.wood

    // Add to queue
    building.productionQueue.push({
      id: generateId(),
      type: unitType,
      progress: 0,
      queuedAt: this.tick
    })

    return true
  }

  private handleBuild(playerId: string, buildingType: BuildingType, position: Position): boolean {
    const player = this.players.get(playerId)
    if (!player) return false

    const stats = BUILDING_STATS[buildingType]

    // Check resources
    if (player.resources.gold < stats.cost.gold || player.resources.wood < stats.cost.wood) {
      return false
    }

    // Check placement
    if (!this.canBuildAt(buildingType, position)) {
      return false
    }

    // Deduct resources
    player.resources.gold -= stats.cost.gold
    player.resources.wood -= stats.cost.wood

    // Create building
    const building: Building = {
      id: generateId(),
      ownerId: playerId,
      x: position.x,
      y: position.y,
      hp: stats.hp * 0.1, // Start at 10%
      maxHp: stats.hp,
      size: stats.size,
      type: buildingType,
      progress: 10,
      productionQueue: [],
      rallyPoint: null,
      isUnderAttack: false,
      lastAttackTime: 0
    }

    this.buildings.set(building.id, building)

    return true
  }

  private handleUpgrade(playerId: string, buildingId: string, upgradeType: 'attack' | 'defense' | 'range'): boolean {
    const building = this.buildings.get(buildingId)
    if (!building || building.ownerId !== playerId) return false

    const player = this.players.get(playerId)
    if (!player) return false

    const currentLevel = player.upgrades[upgradeType]
    const maxLevel = upgradeType === 'range' ? 2 : 3

    if (currentLevel >= maxLevel) return false
    if (player.resources.gold < 100) return false

    player.resources.gold -= 100
    player.upgrades[upgradeType]++

    return true
  }

  private handleGather(playerId: string, unitId: string, resourceId: string): boolean {
    const unit = this.units.get(unitId)
    if (!unit || unit.ownerId !== playerId || unit.type !== 'worker') return false

    const resource = this.resources.get(resourceId)
    if (!resource) return false

    unit.state = 'gathering'
    unit.targetId = resourceId

    return true
  }

  // ====================
  // Helpers
  // ====================

  private spawnUnit(type: UnitType, ownerId: string): Unit {
    const stats = UNIT_STATS[type]
    const player = this.players.get(ownerId)
    if (!player) throw new Error('Player not found')

    // Find spawn point (near base)
    const base = Array.from(this.buildings.values())
      .find(b => b.ownerId === ownerId && b.type === 'base')

    const x = base ? base.x + (Math.random() - 0.5) * 60 : 100
    const y = base ? base.y + (Math.random() - 0.5) * 60 : 100

    const unit: Unit = {
      id: generateId(),
      ownerId,
      x,
      y,
      hp: stats.hp,
      maxHp: stats.hp,
      size: 16,
      type,
      state: 'idle',
      targetId: null,
      targetPosition: null,
      waypoints: [],
      attackRange: stats.range,
      attackDamage: stats.damage,
      attackCooldown: 60, // 1 second
      attackCooldownRemaining: 0,
      moveSpeed: stats.speed,
      armor: stats.armor,
      gatherAmount: stats.gatherAmount || 0,
      gatherRate: stats.gatherRate || 0,
      isUnderAttack: false,
      lastAttackTime: 0
    }

    // Apply upgrades
    if (player && base) {
      unit.attackDamage += player.upgrades.attack * 2
      if (unit.type === 'archer' || unit.type === 'worker') {
        unit.attackRange += player.upgrades.range * 10
      }
    }

    this.units.set(unit.id, unit)
    return unit
  }

  private queueUnitProduction(buildingId: string, unitType: UnitType): boolean {
    const building = this.buildings.get(buildingId)
    if (!building) return false

    building.productionQueue.push({
      id: generateId(),
      type: unitType,
      progress: 0,
      queuedAt: this.tick
    })

    return true
  }

  private getUnitPosition(id: string): Position | null {
    const unit = this.units.get(id)
    return unit ? { x: unit.x, y: unit.y } : null
  }

  private findNearestEnemy(unit: Unit): Unit | null {
    let nearest: Unit | null = null
    let nearestDist = 400 // Vision range for attack move

    for (const other of this.units.values()) {
      if (other.ownerId === unit.ownerId) continue

      const dx = other.x - unit.x
      const dy = other.y - unit.y
      const dist = Math.sqrt(dx * dx + dy * dy)

      if (dist < nearestDist) {
        nearestDist = dist
        nearest = other
      }
    }

    return nearest
  }

  private findNearestEnemyInRange(unit: Unit): Unit | null {
    const range = UNIT_STATS[unit.type].range

    for (const other of this.units.values()) {
      if (other.ownerId === unit.ownerId) continue

      const dx = other.x - unit.x
      const dy = other.y - unit.y
      const dist = Math.sqrt(dx * dx + dy * dy)

      if (dist <= range) {
        return other
      }
    }

    return null
  }

  private findNearestDepositPoint(unit: Unit): Position | null {
    for (const building of this.buildings.values()) {
      if (building.ownerId !== unit.ownerId) continue
      if (building.type !== 'base' && building.type !== 'farm') continue
      if (building.progress < 100) continue

      return { x: building.x, y: building.y }
    }

    return null
  }

  private findNearestResource(unit: Unit): Resource | null {
    let nearest: Resource | null = null
    let nearestDist = 1000

    for (const resource of this.resources.values()) {
      const dx = resource.x - unit.x
      const dy = resource.y - unit.y
      const dist = Math.sqrt(dx * dx + dy * dy)

      if (dist < nearestDist) {
        nearestDist = dist
        nearest = resource
      }
    }

    return nearest
  }

  private canBuildAt(buildingType: BuildingType, position: Position): boolean {
    const stats = BUILDING_STATS[buildingType]
    const halfSize = stats.size / 2

    // Check bounds
    if (position.x - halfSize < 0 || position.x + halfSize > this.map.width * this.map.tileSize) {
      return false
    }
    if (position.y - halfSize < 0 || position.y + halfSize > this.map.height * this.map.tileSize) {
      return false
    }

    // Check collision with other buildings
    for (const building of this.buildings.values()) {
      const dx = building.x - position.x
      const dy = building.y - position.y
      const dist = Math.sqrt(dx * dx + dy * dy)

      if (dist < (building.size + stats.size) / 2 + 10) {
        return false
      }
    }

    return true
  }

  private isTower(entity: Unit | Building): boolean {
    return 'type' in entity && entity.type === 'tower'
  }

  private calculateDamage(attacker: Unit, target: Unit | Building): number {
    const stats = UNIT_STATS[attacker.type]
    const attackerPlayer = this.players.get(attacker.ownerId)
    const targetPlayer = this.players.get(target.ownerId)

    let damage = stats.damage

    // Apply attack upgrade
    if (attackerPlayer) {
      damage += attackerPlayer.upgrades.attack * 2
    }

    // Tower attack upgrade bonus
    if (attacker.type === 'worker' && this.isTower(target)) {
      if (attackerPlayer) {
        damage += attackerPlayer.upgrades.attack * 3
      }
    }

    // Apply defense
    if (targetPlayer) {
      damage -= targetPlayer.upgrades.defense * 2
    }

    return Math.max(1, damage)
  }

  private calculateDamageFromProjectile(projectile: Projectile, target: Unit | Building): number {
    let damage = projectile.damage

    const projectileOwner = this.players.get(projectile.ownerId)
    const targetOwner = this.players.get(target.ownerId)

    if (projectileOwner) {
      damage += projectileOwner.upgrades.attack * 2
    }

    if (targetOwner) {
      damage -= targetOwner.upgrades.defense * 2
    }

    return Math.max(1, damage)
  }

  // ====================
  // Serialization
  // ====================

  createSnapshot(): GameSnapshot {
    return {
      tick: this.tick,
      timestamp: Date.now(),
      units: Array.from(this.units.values()),
      buildings: Array.from(this.buildings.values()),
      projectiles: this.projectiles,
      players: Object.fromEntries(
        Array.from(this.players.entries()).map(([id, p]) => [
          id,
          { resources: p.resources, upgrades: p.upgrades }
        ])
      ),
      gameOver: this.gameOver,
      winner: this.winner
    }
  }

  getState(): GameState {
    return {
      tick: this.tick,
      map: this.map,
      units: this.units,
      buildings: this.buildings,
      projectiles: this.projectiles,
      players: this.players,
      discoveredTiles: this.discoveredTiles,
      gameOver: this.gameOver,
      winner: this.winner,
      winnerReason: this.winnerReason
    }
  }

  isGameOver(): boolean {
    return this.gameOver
  }

  getWinner(): string | null {
    return this.winner
  }
}
