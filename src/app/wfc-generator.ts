// Wave Function Collapse Map Generator

export type TerrainType = 'grass' | 'forest' | 'water' | 'mountain' | 'gold' | 'sand' | 'dirt'

export interface Tile {
  type: TerrainType
  x: number
  y: number
  passable: boolean
  resourceAmount?: number
}

export interface WFCTile {
  collapsed: boolean
  options: TerrainType[]
  entropy: number
}

// Adjacency rules - what tiles can be next to each other
const ADJACENCY_RULES: Record<TerrainType, { up: TerrainType[]; down: TerrainType[]; left: TerrainType[]; right: TerrainType[] }> = {
  grass: {
    up: ['grass', 'forest', 'water', 'gold', 'sand', 'dirt', 'mountain'],
    down: ['grass', 'forest', 'water', 'gold', 'sand', 'dirt', 'mountain'],
    left: ['grass', 'forest', 'water', 'gold', 'sand', 'dirt', 'mountain'],
    right: ['grass', 'forest', 'water', 'gold', 'sand', 'dirt', 'mountain']
  },
  forest: {
    up: ['grass', 'forest', 'mountain'],
    down: ['grass', 'forest', 'mountain'],
    left: ['grass', 'forest', 'mountain'],
    right: ['grass', 'forest', 'mountain']
  },
  water: {
    up: ['grass', 'water', 'sand'],
    down: ['grass', 'water', 'sand'],
    left: ['grass', 'water', 'sand'],
    right: ['grass', 'water', 'sand']
  },
  mountain: {
    up: ['grass', 'forest', 'mountain'],
    down: ['grass', 'forest', 'mountain'],
    left: ['grass', 'forest', 'mountain'],
    right: ['grass', 'forest', 'mountain']
  },
  gold: {
    up: ['grass', 'mountain', 'dirt'],
    down: ['grass', 'mountain', 'dirt'],
    left: ['grass', 'mountain', 'dirt'],
    right: ['grass', 'mountain', 'dirt']
  },
  sand: {
    up: ['grass', 'water', 'sand', 'dirt'],
    down: ['grass', 'water', 'sand', 'dirt'],
    left: ['grass', 'water', 'sand', 'dirt'],
    right: ['grass', 'water', 'sand', 'dirt']
  },
  dirt: {
    up: ['grass', 'dirt', 'gold', 'sand'],
    down: ['grass', 'dirt', 'gold', 'sand'],
    left: ['grass', 'dirt', 'gold', 'sand'],
    right: ['grass', 'dirt', 'gold', 'sand']
  }
}

// Tile weights (probability)
const TILE_WEIGHTS: Record<TerrainType, number> = {
  grass: 10,
  forest: 3,
  water: 2,
  mountain: 1.5,
  gold: 0.3,
  sand: 1,
  dirt: 1.5
}

// Tile properties
export const TILE_PROPERTIES: Record<TerrainType, { passable: boolean; color: string; resourceType?: 'gold' | 'tree' }> = {
  grass: { passable: true, color: '#3d6a37' },
  forest: { passable: true, color: '#228B22', resourceType: 'tree' },
  water: { passable: false, color: '#4169E1' },
  mountain: { passable: false, color: '#696969' },
  gold: { passable: true, color: '#FFD700', resourceType: 'gold' },
  sand: { passable: true, color: '#F4A460' },
  dirt: { passable: true, color: '#8B7355' }
}

function getAllTileTypes(): TerrainType[] {
  return ['grass', 'forest', 'water', 'mountain', 'gold', 'sand', 'dirt']
}

function calculateEntropy(options: TerrainType[]): number {
  if (options.length === 0) return 0
  if (options.length === 1) return 0
  
  let sum = 0
  let weightedSum = 0
  for (const option of options) {
    const weight = TILE_WEIGHTS[option]
    sum += weight
    weightedSum += weight * Math.log(weight)
  }
  
  return Math.log(sum) - weightedSum / sum
}

function getValidNeighbors(grid: WFCTile[][], x: number, y: number, width: number, height: number): { dir: string; x: number; y: number }[] {
  const neighbors: { dir: string; x: number; y: number }[] = []
  
  if (y > 0) neighbors.push({ dir: 'up', x, y: y - 1 })
  if (y < height - 1) neighbors.push({ dir: 'down', x, y: y + 1 })
  if (x > 0) neighbors.push({ dir: 'left', x: x - 1, y })
  if (x < width - 1) neighbors.push({ dir: 'right', x: x + 1, y })
  
  return neighbors
}

function collapseTile(tile: WFCTile): TerrainType {
  // Weighted random selection
  const weights = tile.options.map(o => TILE_WEIGHTS[o])
  const totalWeight = weights.reduce((a, b) => a + b, 0)
  
  let random = Math.random() * totalWeight
  for (let i = 0; i < tile.options.length; i++) {
    random -= weights[i]
    if (random <= 0) {
      return tile.options[i]
    }
  }
  
  return tile.options[tile.options.length - 1]
}

function propagate(grid: WFCTile[][], x: number, y: number, width: number, height: number): boolean {
  const stack: [number, number][] = [[x, y]]
  
  while (stack.length > 0) {
    const [cx, cy] = stack.pop()!
    const currentTile = grid[cy][cx]
    
    if (!currentTile.collapsed) continue
    
    const currentType = currentTile.options[0]
    const neighbors = getValidNeighbors(grid, cx, cy, width, height)
    
    for (const neighbor of neighbors) {
      const neighborTile = grid[neighbor.y][neighbor.x]
      if (neighborTile.collapsed) continue
      
      const validOptions = neighborTile.options.filter(option => {
        const oppositeDir = neighbor.dir === 'up' ? 'down' : 
                           neighbor.dir === 'down' ? 'up' :
                           neighbor.dir === 'left' ? 'right' : 'left'
        return ADJACENCY_RULES[option][oppositeDir as 'up' | 'down' | 'left' | 'right'].includes(currentType)
      })
      
      if (validOptions.length === 0) {
        return false // Contradiction
      }
      
      if (validOptions.length < neighborTile.options.length) {
        neighborTile.options = validOptions
        neighborTile.entropy = calculateEntropy(validOptions)
        stack.push([neighbor.x, neighbor.y])
      }
    }
  }
  
  return true
}

export function generateMapWFC(width: number, height: number, seed?: number): Tile[][] {
  // Seed random if provided
  if (seed !== undefined) {
    // Simple seeded random
    let s = seed
    Math.random = () => {
      s = (s * 9301 + 49297) % 233280
      return s / 233280
    }
  }
  
  // Initialize grid with all possibilities
  const grid: WFCTile[][] = []
  for (let y = 0; y < height; y++) {
    grid[y] = []
    for (let x = 0; x < width; x++) {
      const allTypes = getAllTileTypes()
      grid[y][x] = {
        collapsed: false,
        options: allTypes,
        entropy: calculateEntropy(allTypes)
      }
    }
  }
  
  // Pre-collapse some tiles to create variety
  // Player starting area - grass
  const playerStartX = Math.floor(width * 0.15)
  const playerStartY = Math.floor(height * 0.15)
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      const tx = playerStartX + dx
      const ty = playerStartY + dy
      if (tx >= 0 && tx < width && ty >= 0 && ty < height) {
        grid[ty][tx] = {
          collapsed: true,
          options: ['grass'],
          entropy: 0
        }
      }
    }
  }
  
  // Enemy starting area - grass
  const enemyStartX = Math.floor(width * 0.85)
  const enemyStartY = Math.floor(height * 0.85)
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      const tx = enemyStartX + dx
      const ty = enemyStartY + dy
      if (tx >= 0 && tx < width && ty >= 0 && ty < height) {
        grid[ty][tx] = {
          collapsed: true,
          options: ['grass'],
          entropy: 0
        }
      }
    }
  }
  
  // Main WFC loop
  let iterations = 0
  const maxIterations = width * height * 2
  
  while (iterations < maxIterations) {
    // Find lowest entropy uncollapsed tile
    let minEntropy = Infinity
    let minX = -1, minY = -1
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const tile = grid[y][x]
        if (!tile.collapsed && tile.options.length > 0) {
          // Add small random noise to break ties
          const noise = Math.random() * 0.01
          if (tile.entropy + noise < minEntropy) {
            minEntropy = tile.entropy + noise
            minX = x
            minY = y
          }
        }
      }
    }
    
    // All tiles collapsed
    if (minX === -1) break
    
    // Collapse the tile
    const tile = grid[minY][minX]
    const chosenType = collapseTile(tile)
    tile.collapsed = true
    tile.options = [chosenType]
    tile.entropy = 0
    
    // Propagate constraints
    if (!propagate(grid, minX, minY, width, height)) {
      // Contradiction - reset and try again
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (!grid[y][x].collapsed || (x >= playerStartX - 3 && x <= playerStartX + 3 && y >= playerStartY - 3 && y <= playerStartY + 3) ||
              (x >= enemyStartX - 3 && x <= enemyStartX + 3 && y >= enemyStartY - 3 && y <= enemyStartY + 3)) {
            const allTypes = getAllTileTypes()
            grid[y][x] = {
              collapsed: false,
              options: allTypes,
              entropy: calculateEntropy(allTypes)
            }
          }
        }
      }
      iterations++
      continue
    }
    
    iterations++
  }
  
  // Convert to final tile map
  const tileMap: Tile[][] = []
  for (let y = 0; y < height; y++) {
    tileMap[y] = []
    for (let x = 0; x < width; x++) {
      const type = grid[y][x].options[0] || 'grass'
      const props = TILE_PROPERTIES[type]
      tileMap[y][x] = {
        type,
        x,
        y,
        passable: props.passable,
        resourceAmount: props.resourceType ? (props.resourceType === 'gold' ? 1500 + Math.floor(Math.random() * 1500) : 800 + Math.floor(Math.random() * 700)) : undefined
      }
    }
  }
  
  return tileMap
}

export function findPassableArea(tileMap: Tile[][], centerX: number, centerY: number, radius: number): { x: number; y: number } | null {
  for (let r = 0; r < radius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = centerX + dx
        const y = centerY + dy
        if (y >= 0 && y < tileMap.length && x >= 0 && x < tileMap[0].length) {
          if (tileMap[y][x].passable) {
            return { x, y }
          }
        }
      }
    }
  }
  return null
}

export function countNearbyResources(tileMap: Tile[][], x: number, y: number, radius: number): { gold: number; trees: number } {
  let gold = 0
  let trees = 0
  
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const tx = x + dx
      const ty = y + dy
      if (ty >= 0 && ty < tileMap.length && tx >= 0 && tx < tileMap[0].length) {
        if (tileMap[ty][tx].type === 'gold') gold++
        if (tileMap[ty][tx].type === 'forest') trees++
      }
    }
  }
  
  return { gold, trees }
}
