# Fix Plan: Multiplayer API 400 Bad Request Error

## Problem Summary

The application is receiving repeated 400 Bad Request errors when calling the `/api/multiplayer` endpoint:

```
POST https://openrts3000.netlify.app/api/multiplayer 400 (Bad Request)
```

## Root Cause Analysis

After examining the code, I found the bug in [`src/app/page.tsx`](src/app/page.tsx:631) in the `syncGameState` function:

### The Bug (Line 639)

```typescript
const syncGameState = useCallback(async (state: GameState) => {
  if (!state.isMultiplayer || !state.roomId) return
  
  try {
    await fetch('/api/multiplayer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'sync',  // ❌ INVALID ACTION!
        roomId: state.roomId,
        gameState: { ... }
      })
    })
  } catch (e) {
    console.error('Failed to sync state:', e)
  }
}, [])
```

### Valid API Actions

Looking at [`src/app/api/multiplayer/route.ts`](src/app/api/multiplayer/route.ts:84), the POST endpoint only accepts these actions:

| Action | Required Fields |
|--------|-----------------|
| `create` | playerId, playerName, roomName |
| `join` | roomId, playerId, playerName |
| `ready` | roomId, playerId |
| `start` | roomId, playerId |
| `syncPlayer` | roomId, playerId, playerState |
| `syncGame` | roomId, gameState |

The action `'sync'` is **not valid** - it should be `'syncGame'`.

## Solution

Change line 639 in [`src/app/page.tsx`](src/app/page.tsx:639) from:

```typescript
action: 'sync',
```

to:

```typescript
action: 'syncGame',
```

## Files to Modify

1. **`src/app/page.tsx`** - Line 639: Change action from `'sync'` to `'syncGame'`

## Impact

- This fix will resolve the 400 Bad Request errors
- The multiplayer game state synchronization will work correctly
- No other changes are needed as the request body structure already matches what `syncGame` expects
